import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { FiltersEngine, Request } from '@ghostery/adblocker-webextension'
import {
  DEFAULT_SETTINGS,
  LIST_SOURCES,
  enabledForPage,
  hostnameOf,
  isPaused,
  normalizeSite,
  validateSettings,
} from '../src/shared/config.js'
import {
  buildEngine,
  downloadLists,
  engineCounts,
  prepareFilters,
  validateList,
} from '../src/shared/filters.js'

const texts = Object.fromEntries(
  await Promise.all(
    LIST_SOURCES.map(async (s) => [s.id, await readFile(`filters/${s.file}`, 'utf8')])
  )
)
const resources = await readFile('vendor/resources.json', 'utf8')
const engine = buildEngine(texts, DEFAULT_SETTINGS, resources)

test('site pauses use hostname boundaries and cover subdomains', () => {
  assert.equal(isPaused('https://shop.example.com/cart', ['example.com']), true)
  assert.equal(isPaused('https://notexample.com/', ['example.com']), false)
  assert.equal(isPaused('https://example.com.attacker.test/', ['example.com']), false)
  assert.equal(hostnameOf('about:addons'), '')
  assert.equal(normalizeSite('https://EXAMPLE.com./path'), 'example.com')
  assert.equal(normalizeSite('münchen.de'), 'xn--mnchen-3ya.de')
  assert.throws(() => normalizeSite('*.example.com'))
  assert.throws(() => normalizeSite('javascript:alert(1)'))
  assert.equal(
    enabledForPage({ ...DEFAULT_SETTINGS, enabled: false }, 'https://example.com'),
    false
  )
  assert.equal(enabledForPage(DEFAULT_SETTINGS, 'https://addons.mozilla.org'), false)
})

test('settings reject malformed data and preserve only supported keys', () => {
  assert.throws(() => validateSettings({ enabled: 'false' }))
  assert.throws(() => validateSettings({ disabledSites: [1] }))
  assert.throws(() => validateSettings({ customFilters: 'a'.repeat(128001) }))
  const settings = validateSettings({
    disabledSites: ['EXAMPLE.com', 'example.com'],
    unknown: true,
  })
  assert.deepEqual(settings.disabledSites, ['example.com'])
  assert.equal(settings.unknown, undefined)
  assert.equal(settings.compatibilityMode, false)
})

test('all four bundled lists validate and produce broad network and cosmetic coverage', () => {
  for (const s of LIST_SOURCES) assert.ok(validateList(texts[s.id], s) >= s.minRules)
  const counts = engineCounts(engine)
  assert.ok(counts.cosmetic > 20000)
  assert.ok(counts.network > 1000)
  console.log('Bundled default-mode rules:', counts)
})

test('real EasyList network and generic banner rules match', () => {
  assert.equal(
    engine.match(
      Request.fromRawDetails({
        url: 'https://site.test/assets/site-cookie-banner.js',
        sourceUrl: 'https://site.test',
        type: 'script',
      })
    ).match,
    true
  )
  assert.equal(
    engine.match(
      Request.fromRawDetails({
        url: 'https://site.test/application.js',
        sourceUrl: 'https://site.test',
        type: 'script',
      })
    ).match,
    false
  )
  const result = engine.getCosmeticsFilters({
    url: 'https://site.test',
    hostname: 'site.test',
    domain: 'site.test',
    ids: ['cookie-banner'],
    getRulesFromDOM: true,
  })
  assert.match(result.styles, /#cookie-banner/)
})

test('default mode provides a targeted no-consent alternative for the Guardian wall', () => {
  const result = engine.getCosmeticsFilters({
    url: 'https://www.theguardian.com/international',
    hostname: 'www.theguardian.com',
    domain: 'theguardian.com',
  })
  assert.match(result.styles, /sp_message_container_/)
  assert.equal(result.scripts.length, 0)
})

test('Corriere blocks its Firefox-specific Piano loader in both modes, scoped to article sites', () => {
  const full = buildEngine(texts, { ...DEFAULT_SETTINGS, compatibilityMode: true }, resources)
  const loader = 'https://cdn.ith9ueyuhu.it/api/tinypass.min.js'
  for (const current of [engine, full]) {
    const blocked = (url, sourceUrl, type = 'script') =>
      current.match(Request.fromRawDetails({ url, sourceUrl, type })).match
    assert.equal(blocked(loader, 'https://www.corriere.it/tecnologia/article.shtml'), true)
    assert.equal(blocked(`${loader}?v=2`, 'https://milano.corriere.it/'), true)
    assert.equal(blocked(loader, 'https://abbonamenti.corriere.it/login/'), false)
    assert.equal(blocked(loader, 'https://another-publisher.test/'), false)
    assert.equal(blocked(loader, 'https://corriere.it.another-publisher.test/'), false)
    assert.equal(blocked(loader, 'https://www.corriere.it/', 'main_frame'), false)
    assert.equal(
      blocked('https://cdn.ith9ueyuhu.it/api/other.js', 'https://www.corriere.it/'),
      false
    )
  }
})

test('Corriere hides its separate cookie wall without a consent click in default mode', () => {
  const stylesFor = (hostname) =>
    engine.getCosmeticsFilters({
      url: `https://${hostname}/`,
      hostname,
      domain: hostname.endsWith('corriere.it') ? 'corriere.it' : hostname,
      getInjectionRules: true,
    })
  const article = stylesFor('www.corriere.it')
  assert.match(article.styles, /\.privacy-cp-wall/)
  assert.equal(article.scripts.length, 0)
  assert.doesNotMatch(stylesFor('abbonamenti.corriere.it').styles, /\.privacy-cp-wall/)
  assert.doesNotMatch(stylesFor('another-publisher.test').styles, /\.privacy-cp-wall/)
})

test('default mode excludes consent-writing and click scriptlets but keeps layout repairs', () => {
  const input =
    'test.com##+js(set-cookie, consent, true)\ntest.com##+js(trusted-click-element, .accept)\ntest.com##+js(rc, locked, body)\ntest.com###cookie-banner'
  const filtered = prepareFilters(input)
  assert.doesNotMatch(filtered, /set-cookie|trusted-click/)
  assert.match(filtered, /\+js\(rc/)
  assert.equal(prepareFilters(input, true), input)
  const full = buildEngine(
    texts,
    {
      ...DEFAULT_SETTINGS,
      compatibilityMode: true,
      customFilters: 'compat.test##+js(set-cookie, cbk_test, 1)',
    },
    resources
  )
  const result = full.getCosmeticsFilters({
    url: 'https://compat.test',
    hostname: 'compat.test',
    domain: 'compat.test',
    getInjectionRules: true,
  })
  assert.ok(result.scripts.length > 0, 'bundled scriptlets are actually available')
})

test('exceptions, domain-scoped selectors, extended selectors and conditional rules work', () => {
  const e = FiltersEngine.parse(
    prepareFilters(
      '||cmp.test^$script\n@@||cmp.test/allowed.js$script\nfoo.test###banner\nfoo.test#@#.safe\nfoo.test#?#.notice:has-text(cookie)\n!#if ext_ubol\n||disabled.test^\n!#endif'
    ),
    { loadExtendedSelectors: true, loadPreprocessors: true }
  )
  e.updateEnv(new Map([['ext_ubol', false]]))
  const match = (url) =>
    e.match(Request.fromRawDetails({ url, sourceUrl: 'https://foo.test', type: 'script' })).match
  assert.equal(match('https://cmp.test/banner.js'), true)
  assert.equal(match('https://cmp.test/allowed.js'), false)
  assert.equal(match('https://disabled.test/script.js'), false)
  const scoped = e.getCosmeticsFilters({
    url: 'https://foo.test',
    hostname: 'foo.test',
    domain: 'foo.test',
    getExtendedRules: true,
  })
  assert.match(scoped.styles, /#banner/)
  assert.ok(scoped.extended.length > 0)
  const other = e.getCosmeticsFilters({
    url: 'https://bar.test',
    hostname: 'bar.test',
    domain: 'bar.test',
  })
  assert.doesNotMatch(other.styles, /#banner/)
})

test('updates reject HTML, truncation and unknown includes', () => {
  assert.throws(() => validateList('<!doctype html><html>Error</html>', LIST_SOURCES[0]))
  assert.throws(() => validateList('! Title: truncated\n##.banner', LIST_SOURCES[0]))
  assert.throws(() =>
    validateList(`${texts['easylist-cookie']}\n!#include https://untrusted.test/x`, LIST_SOURCES[0])
  )
})

test('list downloader is all-or-nothing and omits credentials and referrers', async () => {
  const result = await downloadLists(async (url, options) => {
    assert.equal(options.credentials, 'omit')
    assert.equal(options.referrerPolicy, 'no-referrer')
    assert.equal(options.redirect, 'error')
    const source = LIST_SOURCES.find((s) => s.url === url)
    return new Response(texts[source.id])
  })
  assert.equal(Object.keys(result).length, 4)
  await assert.rejects(
    downloadLists(
      async (url) =>
        new Response(
          url.includes('uAssets')
            ? 'Unavailable'
            : texts[LIST_SOURCES.find((s) => s.url === url).id],
          { status: url.includes('uAssets') ? 503 : 200 }
        )
    ),
    /HTTP 503/
  )
})
