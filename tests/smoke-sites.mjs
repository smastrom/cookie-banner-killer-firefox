// Optional live-web observation, not a deterministic test or a coverage benchmark.
import { Builder } from 'selenium-webdriver'
import firefox from 'selenium-webdriver/firefox.js'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const sites =
  process.argv.length > 2
    ? process.argv.slice(2)
    : [
        'https://www.bbc.com/',
        'https://www.theguardian.com/international',
        'https://www.ikea.com/it/it/',
        'https://developer.mozilla.org/en-US/',
      ]
const uuid = '8b65b3b9-3669-49b4-bfa4-bbca439ec800'
const observations = []
await mkdir('test-results/live', { recursive: true })

async function run(mode) {
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
    await driver.manage().setTimeouts({ pageLoad: 20000, script: 10000 })
    await driver.manage().window().setRect({ width: 1360, height: 980 })
    if (mode === 'enabled') {
      await driver.installAddon(resolve('dist'), true)
      await driver.get(`moz-extension://${uuid}/ui/options.html`)
      await driver.executeAsyncScript(
        `const done=arguments[arguments.length-1]; browser.runtime.sendMessage({action:'saveSettings',settings:{autoUpdate:false}}).then(done);`
      )
    }
    for (const url of sites) {
      let navigationError = ''
      try {
        await driver.get(url)
      } catch (error) {
        navigationError = error.message.slice(0, 180)
      }
      // Give delayed consent managers time to appear, identically in each profile.
      await driver.sleep(5000)
      const page = await driver.executeScript(`
        const candidates = [...document.querySelectorAll('[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],[id^="sp_message"],[role="dialog"],.privacy-cp-wall,.tp-modal,.tp-backdrop')];
        return { title: document.title, url: location.href, textLength: document.body.innerText.length, bodyOverflow: getComputedStyle(document.body).overflowY, htmlOverflow: getComputedStyle(document.documentElement).overflowY,
          scripts: [...document.scripts].map(e => e.src).filter(Boolean),
          subscriptionFrames: [...document.querySelectorAll('iframe[id^="offer_"]')].map(e => ({ id: e.id, src: e.src })),
          visibleCandidates: candidates.filter(e => { const r=e.getBoundingClientRect(); const s=getComputedStyle(e); return r.width>180 && r.height>60 && s.display!=='none' && s.visibility!=='hidden' && Number(s.opacity)>0 && r.top<innerHeight && r.bottom>0; })
            .slice(0,12).map(e => ({tag:e.tagName,id:e.id,className:String(e.className).slice(0,120),text:e.innerText.slice(0,220)})) };
      `)
      const hostname = new URL(url).hostname
      await writeFile(
        `test-results/live/${hostname}-${mode}.png`,
        await driver.takeScreenshot(),
        'base64'
      )
      observations.push({ mode, url, navigationError, ...page })
      console.log(
        JSON.stringify({
          mode,
          hostname,
          title: page.title,
          textLength: page.textLength,
          candidates: page.visibleCandidates.length,
          navigationError,
        })
      )
    }
  } finally {
    await driver.quit()
  }
}
await Promise.all([run('baseline'), run('enabled')])
await writeFile(
  'test-results/live/observations.json',
  JSON.stringify({ observedAt: new Date().toISOString(), observations }, null, 2)
)
