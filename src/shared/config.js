export const LIST_SOURCES = Object.freeze([
  {
    id: 'easylist-cookie',
    name: 'EasyList Cookie',
    file: 'easylist-cookie.txt',
    url: 'https://secure.fanboy.co.nz/fanboy-cookiemonster_ubo.txt',
    minRules: 10000,
  },
  {
    id: 'easylist-cookie-specific',
    name: 'EasyList Cookie · site fixes',
    file: 'easylist-cookie-specific.txt',
    url: 'https://secure.fanboy.co.nz/easylist_cookie_specific_uBO.txt',
    minRules: 100,
  },
  {
    id: 'ublock-cookies',
    name: 'uBlock Cookie Notices',
    file: 'ublock-cookies.txt',
    url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/annoyances-cookies.txt',
    minRules: 1000,
  },
  {
    id: 'brave-cookies',
    name: 'Brave cookie additions',
    file: 'brave-cookies.txt',
    url: 'https://raw.githubusercontent.com/brave/adblock-lists/master/brave-lists/brave-cookie-specific.txt',
    minRules: 30,
  },
])

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  autoUpdate: true,
  compatibilityMode: false,
  paywallSupport: false,
  repairScroll: true,
  disabledSites: [],
  customFilters: '',
})

export const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000
export const MAX_LIST_BYTES = 6 * 1024 * 1024
const RESTRICTED_HOSTS = new Set([
  'addons.mozilla.org',
  'accounts.firefox.com',
  'support.mozilla.org',
  'accounts-static.cdn.mozilla.net',
  'addons.cdn.mozilla.net',
  'api.accounts.firefox.com',
  'content.cdn.mozilla.net',
  'discovery.addons.mozilla.org',
  'install.mozilla.org',
  'oauth.accounts.firefox.com',
  'profile.accounts.firefox.com',
  'sync.services.mozilla.com',
])

export function hostnameOf(url) {
  try {
    const parsed = new URL(url)
    return /^https?:$/.test(parsed.protocol) ? parsed.hostname.toLowerCase().replace(/\.$/, '') : ''
  } catch {
    return ''
  }
}

export function normalizeSite(input) {
  const value = input.trim()
  if (!value || /[\s*]/.test(value)) throw new Error('Enter a hostname, such as example.com.')
  const url = new URL(value.includes('://') ? value : `https://${value}`)
  const host = hostnameOf(url.href)
  if (!host || url.username || url.password)
    throw new Error('Enter a valid HTTP or HTTPS hostname.')
  return host
}

export function isPaused(url, disabledSites) {
  const host = hostnameOf(url)
  return disabledSites.some((site) => host === site || host.endsWith(`.${site}`))
}

export function enabledForPage(settings, url) {
  return settings.enabled && supportedPage(url) && !isPaused(url, settings.disabledSites)
}

export function supportedPage(url) {
  const hostname = hostnameOf(url)
  return Boolean(hostname) && !RESTRICTED_HOSTS.has(hostname)
}

export function validateSettings(input) {
  const settings = { ...DEFAULT_SETTINGS }
  for (const key of [
    'enabled',
    'autoUpdate',
    'compatibilityMode',
    'repairScroll',
    'paywallSupport',
  ]) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'boolean') throw new Error(`Invalid setting: ${key}`)
      settings[key] = input[key]
    }
  }
  if (input.disabledSites !== undefined) {
    if (
      !Array.isArray(input.disabledSites) ||
      input.disabledSites.length > 1000 ||
      input.disabledSites.some((v) => typeof v !== 'string')
    ) {
      throw new Error('The exception list must contain no more than 1,000 hostnames.')
    }
    settings.disabledSites = [...new Set(input.disabledSites.map(normalizeSite))].sort()
  }
  if (input.customFilters !== undefined) {
    if (typeof input.customFilters !== 'string' || input.customFilters.length > 128000) {
      throw new Error('Custom filters must be text, under 128 KB.')
    }
    settings.customFilters = input.customFilters
  }
  return settings
}
