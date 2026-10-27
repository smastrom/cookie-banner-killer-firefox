import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Builder, By, until } from 'selenium-webdriver'
import firefox from 'selenium-webdriver/firefox.js'

const UUID = '5fd4e322-495e-44d4-85c8-7661fbcbb330'
const ID = 'cookie-banner-killer@local.extension'
const optionsURL = `moz-extension://${UUID}/ui/options.html`
const results = []
let port
let blockedScriptHits = 0
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/app.js')) {
    res.setHeader('Content-Type', 'application/javascript')
    res.end(`
      window.appLoaded = true;
      const host = document.querySelector('#shadow-host');
      if (host) { const shadow = host.attachShadow({ mode: 'open' }); shadow.innerHTML = '<div id="cookie-banner">Shadow cookie notice</div><p>Shadow content</p>'; }
      setTimeout(() => { const late = document.createElement('div'); late.id = 'cookie-banner-1'; late.textContent = 'A delayed cookie notice'; document.body.append(late); }, 300);
      window.openNormalDialog = () => { document.querySelector('#normal-dialog').showModal(); document.body.style.overflow = 'hidden'; };
    `)
  } else if (req.url.startsWith('/site-cookie-banner.js')) {
    blockedScriptHits++
    res.setHeader('Content-Type', 'application/javascript')
    res.end('window.networkBannerLoaded = true;')
  } else {
    res.setHeader('Content-Type', 'text/html')
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; frame-src http://localhost:* http://127.0.0.1:*"
    )
    const child = req.url.startsWith('/child')
    res.end(
      `<!doctype html><html><head><title>Cookie blocker fixture</title><style>body{font-family:system-ui;overflow:hidden}main{min-height:180vh}.banner{position:fixed;bottom:0;background:#eee;padding:25px}dialog{border:1px solid #aaa}#normal-dialog:not([open]){display:none}</style></head><body><main id="main-content">Real page content remains visible.</main><div id="cookie-banner" class="banner">Cookies <button id="accept">Accept</button></div><dialog id="normal-dialog" aria-modal="true">A normal account dialog</dialog><div class="procedural">Cookie procedural notice</div><div class="ordinary">A normal notification</div><div id="shadow-host"></div>${child ? '' : `<iframe id="child" src="http://localhost:${port}/child" title="Embedded content"></iframe>`}<script src="/app.js"></script><script src="/site-cookie-banner.js"></script></body></html>`
    )
  }
})
await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
port = server.address().port
const fixtureURL = `http://127.0.0.1:${port}/fixture`

const options = new firefox.Options()
  .addArguments('-headless')
  .setPreference('extensions.webextensions.uuids', JSON.stringify({ [ID]: UUID }))
  .setPreference('browser.shell.checkDefaultBrowser', false)
  .setPreference('browser.startup.page', 0)
options.setBinary(
  process.env.FIREFOX_BINARY || '/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox'
)
let driver
async function check(name, operation) {
  await operation()
  results.push({ name, passed: true })
  console.log(`PASS ${name}`)
}
async function api(message) {
  return driver.executeAsyncScript(
    `const done = arguments[arguments.length - 1]; browser.runtime.sendMessage(arguments[0]).then(done, e => done({ok:false,error:e.message}));`,
    message
  )
}
async function openSettings() {
  await extensionPage(optionsURL)
  await driver.wait(until.elementIsEnabled(await driver.findElement(By.id('save'))), 15000)
}
async function extensionPage(url) {
  // Recent Firefox versions restrict direct WebDriver navigation to extension URLs.
  // Only this isolated test profile grants system access; user profiles are untouched.
  await driver.get(url)
}
async function configure(settings) {
  await openSettings()
  const result = await api({ action: 'saveSettings', settings })
  assert.equal(result.ok, true, result.error)
}
async function hidden(selector) {
  return driver.executeScript(
    'const e=document.querySelector(arguments[0]); return Boolean(e) && getComputedStyle(e).display === "none";',
    selector
  )
}
try {
  driver = await new Builder()
    .forBrowser('firefox')
    .setFirefoxOptions(options)
    .setFirefoxService(new firefox.ServiceBuilder().addArguments('--allow-system-access'))
    .build()
  await driver.manage().setTimeouts({ script: 15000, pageLoad: 20000 })
  await driver.manage().window().setRect({ width: 1050, height: 950 })
  await driver.installAddon(resolve('dist'), true)
  await check('extension starts offline from bundled lists', async () => {
    await openSettings()
    const state = await api({ action: 'getState' })
    assert.equal(state.startupError, '')
    assert.ok(state.counts.cosmetic > 20000)
    await api({ action: 'saveSettings', settings: { autoUpdate: false } })
  })
  await check('blocks real EasyList network rules and static banners under CSP', async () => {
    await driver.get(fixtureURL)
    await driver.wait(() => hidden('#cookie-banner'), 10000)
    assert.equal(await driver.executeScript('return window.appLoaded'), true)
    assert.equal(await driver.executeScript('return window.networkBannerLoaded || false'), false)
    assert.equal(blockedScriptHits, 0)
    assert.equal(await driver.findElement(By.id('main-content')).isDisplayed(), true)
    assert.equal(await driver.executeScript('return document.cookie'), '')
  })
  await check('hides delayed banners, open shadow DOM banners and iframe banners', async () => {
    await driver.wait(() => hidden('#cookie-banner-1'), 10000, 'delayed banner')
    await driver.wait(
      () =>
        driver.executeScript(
          'return getComputedStyle(document.querySelector("#shadow-host").shadowRoot.querySelector("#cookie-banner")).display === "none"'
        ),
      10000,
      'shadow banner'
    )
    await driver.switchTo().frame(await driver.findElement(By.id('child')))
    await driver.wait(() => hidden('#cookie-banner'), 10000, 'iframe banner')
    await driver.switchTo().defaultContent()
  })
  await check(
    'restores scroll after hiding cookies and preserves normal modal scroll locks',
    async () => {
      await driver.wait(
        () => driver.executeScript('return getComputedStyle(document.body).overflowY === "auto"'),
        10000
      )
      await driver.executeScript('window.openNormalDialog()')
      await driver.wait(
        () => driver.executeScript('return getComputedStyle(document.body).overflowY === "hidden"'),
        5000
      )
      assert.equal(await driver.findElement(By.id('normal-dialog')).isDisplayed(), true)
      await driver.executeScript('document.querySelector("#normal-dialog").close()')
    }
  )
  await check('pausing a top-level site also pauses its cross-origin iframe', async () => {
    await configure({ disabledSites: ['127.0.0.1'] })
    await driver.get(fixtureURL)
    assert.equal(await driver.findElement(By.id('cookie-banner')).isDisplayed(), true)
    assert.equal(await driver.executeScript('return window.networkBannerLoaded'), true)
    await driver.switchTo().frame(await driver.findElement(By.id('child')))
    assert.equal(await driver.findElement(By.id('cookie-banner')).isDisplayed(), true)
    await driver.switchTo().defaultContent()
  })
  await check('extended selectors apply only to matching content', async () => {
    await configure({
      disabledSites: [],
      customFilters: '127.0.0.1#?#.procedural:has-text(Cookie)',
    })
    await driver.get(fixtureURL)
    await driver.wait(() => hidden('.procedural'), 10000)
    assert.equal(await driver.findElement(By.className('ordinary')).isDisplayed(), true)
  })
  await check('consent scriptlets require explicit compatibility opt-in', async () => {
    await configure({ customFilters: '127.0.0.1##+js(set-cookie, cbk_test, 1)' })
    await driver.get(fixtureURL)
    await driver.wait(() => hidden('#cookie-banner'), 10000)
    assert.doesNotMatch(await driver.executeScript('return document.cookie'), /cbk_test/)
    await configure({ compatibilityMode: true })
    await driver.get(fixtureURL)
    await driver.wait(
      async () => /cbk_test=1/.test(await driver.executeScript('return document.cookie')),
      10000
    )
  })
  await check('global disable stops network and cosmetic filtering', async () => {
    await configure({ enabled: false, compatibilityMode: false, customFilters: '' })
    await driver.get(fixtureURL)
    assert.equal(await driver.findElement(By.id('cookie-banner')).isDisplayed(), true)
    assert.equal(await driver.executeScript('return window.networkBannerLoaded'), true)
  })
  await check('failed updates retain the working filter set', async () => {
    await configure({ enabled: true })
    const before = await api({ action: 'getState' })
    await driver.executeAsyncScript(
      `const done=arguments[arguments.length-1]; browser.runtime.getBackgroundPage().then(bg => { bg.__originalFetch=bg.fetch; bg.fetch=()=>Promise.reject(new Error('Simulated offline test')); done(); });`
    )
    const result = await api({ action: 'refreshFilters' })
    assert.equal(result.ok, false)
    const after = await api({ action: 'getState' })
    assert.deepEqual(after.counts, before.counts)
    assert.equal(after.updatedAt, before.updatedAt)
    await driver.executeAsyncScript(
      `const done=arguments[arguments.length-1]; browser.runtime.getBackgroundPage().then(bg => { bg.fetch=bg.__originalFetch; delete bg.__originalFetch; browser.storage.local.set({updateError:''}).then(done); });`
    )
    await driver.get(fixtureURL)
    await driver.wait(() => hidden('#cookie-banner'), 10000)
  })
  await check('settings form saves exceptions and normalizes hostnames', async () => {
    await openSettings()
    const field = await driver.findElement(By.id('disabledSites'))
    await field.clear()
    await field.sendKeys('EXAMPLE.com\nexample.com')
    await driver.findElement(By.id('save')).click()
    await driver.wait(
      until.elementTextContains(await driver.findElement(By.id('message')), 'Saved.'),
      5000
    )
    assert.deepEqual((await api({ action: 'getState' })).settings.disabledSites, ['example.com'])
  })
  await mkdir('test-results', { recursive: true })
  await driver.executeScript('window.scrollTo(0, 0)')
  await writeFile('test-results/options.png', await driver.takeScreenshot(), 'base64')
  await extensionPage(`moz-extension://${UUID}/ui/popup.html`)
  await driver.wait(until.elementIsEnabled(await driver.findElement(By.id('enabled'))), 5000)
  await writeFile(
    'test-results/popup.png',
    await driver.findElement(By.css('body')).takeScreenshot(),
    'base64'
  )
} catch (error) {
  await mkdir('test-results', { recursive: true })
  if (driver)
    await writeFile('test-results/failure.png', await driver.takeScreenshot(), 'base64').catch(
      () => {}
    )
  console.error(error)
  process.exitCode = 1
} finally {
  await writeFile(
    'test-results/firefox-results.json',
    JSON.stringify({ testedAt: new Date().toISOString(), results }, null, 2)
  ).catch(() => {})
  if (driver) await driver.quit()
  await new Promise((done) => server.close(done))
}
