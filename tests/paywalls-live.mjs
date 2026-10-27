// Optional regression check against the live web. Publishers can change independently.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Builder } from 'selenium-webdriver'
import firefox from 'selenium-webdriver/firefox.js'
import { PAYWALL_PUBLISHERS, paywallPublisher } from '../src/shared/paywalls.js'

const urls =
  process.argv.length > 2 ? process.argv.slice(2) : PAYWALL_PUBLISHERS.map((p) => p.testURL)
for (const url of urls) assert.ok(paywallPublisher(url), `No adapter for ${url}`)
const uuid = 'e099590e-91a2-4117-88d8-1b186d002073'
const observations = []
await mkdir('test-results/paywalls', { recursive: true })

async function run(enabled) {
  const options = new firefox.Options()
    .addArguments('-headless')
    .setPageLoadStrategy('eager')
    .setBinary(
      process.env.FIREFOX_BINARY ||
        '/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox'
    )
    .setPreference(
      'extensions.webextensions.uuids',
      JSON.stringify({ 'cookie-banner-killer@local.extension': uuid })
    )
  const driver = await new Builder()
    .forBrowser('firefox')
    .setFirefoxOptions(options)
    .setFirefoxService(new firefox.ServiceBuilder().addArguments('--allow-system-access'))
    .build()
  try {
    await driver.manage().setTimeouts({ pageLoad: 25000, script: 15000 })
    await driver.manage().window().setRect({ width: 1280, height: 1000 })
    await driver.installAddon(resolve('dist'), true)
    await driver.get(`moz-extension://${uuid}/ui/options.html`)
    const configured = await driver.executeAsyncScript(
      `const done=arguments[arguments.length-1];browser.runtime.sendMessage({action:'saveSettings',settings:{autoUpdate:false,paywallSupport:arguments[0]}}).then(done)`,
      enabled
    )
    assert.equal(configured.ok, true, configured.error)
    for (const [index, url] of urls.entries()) {
      let navigationError = ''
      await driver.get(url).catch((error) => {
        navigationError = error.message.slice(0, 160)
      })
      await driver.sleep(6000)
      const metrics = await driver.executeScript(`
        const article=document.querySelector('article .article-preview,article .paywall-wrapper__story-content');
        const wall=document.querySelector('article .paywallbox,article .paywall-wrapper > .paywall');
        if(article) article.scrollIntoView({block:'start'});
        return {url:location.href,articleFound:Boolean(article),articleLength:article?.textContent.trim().length || 0,
          articleHeight:article?.clientHeight || 0,articleScrollHeight:article?.scrollHeight || 0,
          restored:Boolean(article?.hasAttribute('data-cbk-readable')),
          wallFound:Boolean(wall),wallHidden:wall ? getComputedStyle(wall).display==='none' : false,
          htmlOverflow:getComputedStyle(document.documentElement).overflowY,bodyOverflow:getComputedStyle(document.body).overflowY};
      `)
      const row = {
        publisher: paywallPublisher(url).id,
        mode: enabled ? 'on' : 'off',
        requestedURL: url,
        navigationError,
        ...metrics,
      }
      observations.push(row)
      console.log(JSON.stringify(row))
      await writeFile(
        `test-results/paywalls/${row.publisher}-${index}-${row.mode}.png`,
        await driver.takeScreenshot(),
        'base64'
      )
    }
  } finally {
    await driver.quit()
  }
}

try {
  const runs = await Promise.allSettled([run(false), run(true)])
  for (const result of runs) if (result.status === 'rejected') throw result.reason
  for (const url of urls) {
    const off = observations.find((r) => r.requestedURL === url && r.mode === 'off')
    const on = observations.find((r) => r.requestedURL === url && r.mode === 'on')
    assert.ok(off?.articleFound && on?.articleFound, `Article markup missing: ${url}`)
    assert.equal(on.restored, true, `Adapter did not restore article: ${url}`)
    assert.equal(on.wallHidden, true, `Subscription prompt remains visible: ${url}`)
    assert.ok(
      on.articleHeight > 100 && on.articleHeight >= on.articleScrollHeight - 2,
      `Article remains clipped: ${url}`
    )
    if (on.publisher === 'domani')
      assert.ok(on.articleLength > off.articleLength + 120, `No additional text restored: ${url}`)
    if (on.publisher === 'ilfoglio')
      assert.ok(on.articleHeight > off.articleHeight, `Article was not expanded: ${url}`)
  }
  console.log(`PASS ${urls.length} live publisher articles`)
} finally {
  await writeFile(
    'test-results/paywalls/observations.json',
    JSON.stringify({ observedAt: new Date().toISOString(), observations }, null, 2) + '\n'
  )
}
