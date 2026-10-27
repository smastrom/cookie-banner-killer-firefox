import { Request, fromWebRequestDetails } from '@ghostery/adblocker-webextension'
import {
  DEFAULT_SETTINGS,
  LIST_SOURCES,
  UPDATE_INTERVAL_MS,
  enabledForPage,
  hostnameOf,
  isPaused,
  supportedPage,
  validateSettings,
} from './shared/config.js'
import { buildEngine, downloadLists, engineCounts } from './shared/filters.js'
import { PAYWALL_STYLES, paywallPublisher, paywallSite } from './shared/paywalls.js'

const EMPTY = { active: false, scripts: [], styles: '', extended: [] }
const ALARM = 'refresh-cookie-lists'
let settings = { ...DEFAULT_SETTINGS }
let engine
let texts
let resources
let metadata
let updateError = ''
let startupError = ''
let updating = null
let mutationQueue = Promise.resolve()
const tabs = new Map()

function enqueue(operation) {
  const result = mutationQueue.then(operation)
  mutationQueue = result.catch(() => {})
  return result
}

function tabData(tabId, url) {
  if (!tabs.has(tabId)) tabs.set(tabId, { url: url || '', blocked: 0 })
  return tabs.get(tabId)
}

function badge(tabId) {
  const data = tabs.get(tabId)
  if (!data) return
  const active =
    (Boolean(engine) && enabledForPage(settings, data.url)) || canSupportPaywalls(data.url)
  void browser.browserAction.setBadgeText({ tabId, text: '' }).catch(() => {})
  void browser.browserAction
    .setTitle({ tabId, title: active ? 'Cookie Banner Killer' : 'Cookie Banner Killer · Paused' })
    .catch(() => {})
}

function canSupportPaywalls(url) {
  return (
    settings.paywallSupport && Boolean(paywallSite(url)) && !isPaused(url, settings.disabledSites)
  )
}

function canFilter(tabId, documentUrl) {
  if (tabId < 0 || !engine) return false
  const topUrl = tabs.get(tabId)?.url || documentUrl
  return (
    enabledForPage(settings, topUrl) &&
    (!hostnameOf(documentUrl) || !isPaused(documentUrl, settings.disabledSites))
  )
}

function blockRequest(details) {
  if (!canFilter(details.tabId, details.documentUrl || details.originUrl)) return {}
  const result = engine.match(fromWebRequestDetails(details))
  if (result.match || result.redirect) {
    tabData(details.tabId).blocked++
    badge(details.tabId)
  }
  if (result.redirect) return { redirectUrl: result.redirect.dataUrl }
  if (result.match) return { cancel: true }
  if (result.rewrite && result.rewrite !== details.url) return { redirectUrl: result.rewrite }
  return {}
}

browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return {} // Includes the extension's own bundled assets and updates.
    if (details.type === 'main_frame') {
      tabs.set(details.tabId, { url: details.url, blocked: 0 })
      badge(details.tabId)
      return {} // Never replace a user's top-level navigation with a blank error page.
    }
    return engine
      ? blockRequest(details)
      : ready.then(
          () => blockRequest(details),
          () => ({})
        )
  },
  { urls: ['http://*/*', 'https://*/*'] },
  ['blocking']
)

browser.webRequest.onHeadersReceived.addListener(
  (details) => {
    const apply = () => {
      if (!canFilter(details.tabId, details.documentUrl || details.url)) return {}
      const policy = engine.getCSPDirectives(fromWebRequestDetails(details))
      // An additional CSP can only restrict a page; existing policies remain intact.
      return policy
        ? {
            responseHeaders: [
              ...(details.responseHeaders || []),
              { name: 'Content-Security-Policy', value: policy },
            ],
          }
        : {}
    }
    return engine ? apply() : ready.then(apply, () => ({}))
  },
  { urls: ['http://*/*', 'https://*/*'], types: ['main_frame', 'sub_frame'] },
  ['blocking', 'responseHeaders']
)

browser.tabs.onRemoved.addListener((tabId) => tabs.delete(tabId))
browser.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.url) {
    const data = tabData(tabId)
    data.url = tab.url
    if (!hostnameOf(tab.url)) data.blocked = 0
  }
  badge(tabId)
})

function scheduleUpdates() {
  if (settings.autoUpdate) browser.alarms.create(ALARM, { delayInMinutes: 5, periodInMinutes: 60 })
  else void browser.alarms.clear(ALARM)
}

async function initialize() {
  const stored = await browser.storage.local.get(['settings', 'filterCache', 'updateError'])
  try {
    settings = validateSettings(stored.settings || {})
  } catch {
    settings = { ...DEFAULT_SETTINGS }
  }
  const [bundledMetadata, resourceText, openTabs] = await Promise.all([
    fetch(browser.runtime.getURL('filters/metadata.json')).then((r) => r.json()),
    fetch(browser.runtime.getURL('vendor/resources.json')).then((r) => r.text()),
    browser.tabs.query({}),
  ])
  resources = resourceText
  for (const tab of openTabs) if (!tabs.has(tab.id)) tabData(tab.id, tab.url)
  if (stored.filterCache?.texts) {
    try {
      engine = buildEngine(stored.filterCache.texts, settings, resources)
      texts = stored.filterCache.texts
      metadata = stored.filterCache.metadata
    } catch {
      updateError = 'Saved filters could not be read; using the bundled lists.'
    }
  }
  if (!engine) {
    texts = Object.fromEntries(
      await Promise.all(
        LIST_SOURCES.map(async (source) => [
          source.id,
          await fetch(browser.runtime.getURL(`filters/${source.file}`)).then((r) => r.text()),
        ])
      )
    )
    engine = buildEngine(texts, settings, resources)
    metadata = bundledMetadata
  }
  updateError ||= stored.updateError || ''
  for (const tabId of tabs.keys()) badge(tabId)
  scheduleUpdates()
}

async function refreshFilters() {
  if (updating) return updating
  updating = (async () => {
    try {
      const nextTexts = await downloadLists()
      await enqueue(async () => {
        const nextEngine = buildEngine(nextTexts, settings, resources)
        const nextMetadata = { downloadedAt: new Date().toISOString() }
        await browser.storage.local.set({
          filterCache: { texts: nextTexts, metadata: nextMetadata },
          updateError: '',
        })
        texts = nextTexts
        engine = nextEngine
        metadata = nextMetadata
        updateError = ''
      })
      return { ok: true, state: await getState() }
    } catch (error) {
      updateError = `${error.message} Previous filters are still active.`
      await browser.storage.local.set({ updateError })
      return { ok: false, error: updateError }
    } finally {
      updating = null
    }
  })()
  return updating
}

browser.alarms.onAlarm.addListener(async (alarm) => {
  await ready
  if (
    alarm.name === ALARM &&
    settings.autoUpdate &&
    Date.now() - Date.parse(metadata?.downloadedAt || 0) >= UPDATE_INTERVAL_MS
  ) {
    await refreshFilters()
  }
})

async function cosmetics(message, sender) {
  await ready
  if (!sender.tab || sender.frameId === undefined) return EMPTY
  const pageUrl = hostnameOf(sender.url) ? sender.url : sender.tab.url
  tabData(sender.tab.id, sender.tab.url)
  const filterCookies = canFilter(sender.tab.id, pageUrl)
  const paywallSupport = sender.frameId === 0 && canSupportPaywalls(pageUrl)
  if (!filterCookies && !paywallSupport) return EMPTY
  const { hostname, domain } = Request.fromRawDetails({ url: pageUrl })
  const topPage = Request.fromRawDetails({ url: sender.tab.url || '' })
  const start = message.lifecycle === 'start'
  const features = (key) =>
    Array.isArray(message[key])
      ? message[key].filter((s) => typeof s === 'string' && s.length <= 4096).slice(0, 10000)
      : []
  const result = filterCookies
    ? engine.getCosmeticsFilters({
        url: pageUrl,
        hostname,
        domain,
        ancestors:
          sender.frameId === 0 ? [] : [{ hostname: topPage.hostname, domain: topPage.domain }],
        ids: features('ids'),
        classes: features('classes'),
        hrefs: features('hrefs'),
        getBaseRules: start,
        getInjectionRules: start,
        getExtendedRules: true,
        getRulesFromHostname: start,
        getRulesFromDOM: !start,
      })
    : { ...EMPTY }
  if (paywallSupport) {
    result.active = true
    result.styles += PAYWALL_STYLES
  }
  if (!result.active) return EMPTY
  if (result.styles) {
    try {
      await browser.tabs.insertCSS(sender.tab.id, {
        code: result.styles,
        cssOrigin: 'user',
        frameId: sender.frameId,
        matchAboutBlank: true,
        runAt: 'document_start',
      })
    } catch {
      return EMPTY
    } // The frame may have navigated or closed.
  }
  return { ...result, repairScroll: filterCookies && settings.repairScroll, paywallSupport }
}

async function getState(tabId) {
  let tab
  if (Number.isInteger(tabId)) {
    try {
      tab = await browser.tabs.get(tabId)
    } catch {
      /* closed tab */
    }
  }
  const url = tab?.url || ''
  return {
    settings,
    counts: engine ? engineCounts(engine) : { network: 0, cosmetic: 0 },
    updatedAt: metadata?.downloadedAt,
    updateError,
    startupError,
    updating: Boolean(updating),
    sources: LIST_SOURCES.map(({ name, url }) => ({ name, url })),
    tab: tab
      ? {
          id: tab.id,
          hostname: hostnameOf(url),
          supported: supportedPage(url),
          active: (Boolean(engine) && enabledForPage(settings, url)) || canSupportPaywalls(url),
          paused: isPaused(url, settings.disabledSites),
          blocked: tabs.get(tab.id)?.blocked || 0,
          paywall:
            canSupportPaywalls(url) && paywallPublisher(url)
              ? {
                  status:
                    tabs.get(tab.id)?.paywall?.url === url
                      ? tabs.get(tab.id).paywall.status
                      : 'checking',
                }
              : null,
        }
      : null,
  }
}

async function saveSettings(patch) {
  return enqueue(async () => {
    const next = validateSettings({ ...settings, ...patch })
    const rebuild =
      next.compatibilityMode !== settings.compatibilityMode ||
      next.customFilters !== settings.customFilters
    const nextEngine = rebuild ? buildEngine(texts, next, resources) : engine
    await browser.storage.local.set({ settings: next })
    settings = next
    engine = nextEngine
    scheduleUpdates()
    for (const tabId of tabs.keys()) badge(tabId)
    return { ok: true }
  })
}

browser.runtime.onMessage.addListener((message, sender) => {
  if (!message || typeof message !== 'object') return undefined
  if (message.action === 'getCosmeticsFilters') return cosmetics(message, sender).catch(() => EMPTY)
  if (message.action === 'paywallStatus') {
    const publisher = paywallPublisher(sender.url)
    if (
      sender.tab &&
      sender.frameId === 0 &&
      canSupportPaywalls(sender.url) &&
      publisher?.id === message.publisher &&
      ['restored', 'unavailable', 'not-detected'].includes(message.status)
    ) {
      const data = tabData(sender.tab.id, sender.tab.url)
      data.paywall = { url: sender.url, status: message.status }
    }
    return undefined
  }
  // Settings and list updates can only be requested by our own extension pages.
  if (!sender.url?.startsWith(browser.runtime.getURL('ui/'))) return undefined
  return (async () => {
    await ready
    switch (message.action) {
      case 'getState':
        return getState(message.tabId)
      case 'saveSettings':
        return saveSettings(message.settings || {})
      case 'refreshFilters':
        return refreshFilters()
      case 'setSiteEnabled': {
        const tab = await browser.tabs.get(message.tabId)
        const host = hostnameOf(tab.url)
        if (!host) throw new Error('Open a website to use this control.')
        const disabledSites = message.enabled
          ? settings.disabledSites.filter((site) => host !== site && !host.endsWith(`.${site}`))
          : [...settings.disabledSites, host]
        return saveSettings({ disabledSites })
      }
      default:
        throw new Error('Unknown request.')
    }
  })().catch((error) => ({ ok: false, error: error.message }))
})

const ready = initialize().catch((error) => {
  startupError = `Could not load filters: ${error.message}`
  console.error('Cookie Banner Killer:', startupError)
  for (const tabId of tabs.keys()) badge(tabId)
})
