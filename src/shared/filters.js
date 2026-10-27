import { FiltersEngine } from '@ghostery/adblocker-webextension'
import { LIST_SOURCES, MAX_LIST_BYTES } from './config.js'
import { BLOCK_AND_HIDE_FIXES, SITE_FIXES } from './fallbacks.js'

// Default mode only permits scriptlets that remove layout-related attributes/classes.
// Consent-writing/clicking and other page scriptlets require explicit opt-in.
const LAYOUT_SCRIPTLETS = new Set(['rc', 'rmclass', 'remove-class', 'ra', 'rmattr', 'remove-attr'])

export const FILTER_ENV = Object.freeze({
  env_firefox: true,
  env_desktop: true,
  env_mobile: false,
  ext_ublock: true,
  ext_ubol: false,
  env_safari: false,
  cap_html_filtering: false,
})

export function prepareFilters(text, compatibilityMode = false) {
  return text
    .split(/\r?\n/)
    .map((line) => {
      // EasyList also uses the ABP procedural separator. The selector evaluator
      // supports these expressions, while the engine's list classifier expects ##.
      return line.replace(/^([^!#]*?)#(@?)\?#/, '$1#$2#')
    })
    .filter((line) => {
      if (line.startsWith('!#include')) return false // Expanded from the fixed source manifest.
      const scriptlet = line.match(/#(?:@)?#\+js\(\s*([^,\s)]+)/)
      if (!scriptlet || compatibilityMode) return true
      return LAYOUT_SCRIPTLETS.has(scriptlet[1].replace(/\.js$/, ''))
    })
    .join('\n')
}

export function validateList(text, source) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_LIST_BYTES) {
    throw new Error(`${source.name}: the download is too large or invalid.`)
  }
  if (/<(?:!doctype|html|head|body)(?:\s|>)/i.test(text.slice(0, 1000))) {
    throw new Error(`${source.name}: received a web page instead of a filter list.`)
  }
  const lines = text.split(/\r?\n/)
  const rules = lines.filter((line) => line.trim() && !/^[![]/.test(line.trim())).length
  if (rules < source.minRules || lines.some((line) => line.length > 65536)) {
    throw new Error(`${source.name}: incomplete or malformed filter list.`)
  }
  for (const line of lines) {
    if (
      line.startsWith('!#include ') &&
      !(
        source.id === 'easylist-cookie' &&
        line.trim() === '!#include easylist_cookie_specific_uBO.txt'
      )
    ) {
      throw new Error(`${source.name}: an unfamiliar include requires an extension update.`)
    }
  }
  return rules
}

export function buildEngine(texts, settings, resources) {
  for (const source of LIST_SOURCES) validateList(texts[source.id], source)
  const combined = [
    ...LIST_SOURCES.map((source) => texts[source.id]),
    SITE_FIXES,
    settings.compatibilityMode ? '' : BLOCK_AND_HIDE_FIXES,
    settings.customFilters,
  ].join('\n')
  const engine = FiltersEngine.parse(prepareFilters(combined, settings.compatibilityMode), {
    loadExtendedSelectors: true,
    loadPreprocessors: true,
    enableHtmlFiltering: false,
    enableCompression: true,
    loadCSPFilters: true,
  })
  engine.updateEnv(new Map(Object.entries(FILTER_ENV)))
  // Bundled, version-pinned code only. Network updates never replace these resources.
  engine.updateResources(resources, 'ghostery-2.20.1')
  return engine
}

export function engineCounts(engine) {
  const { networkFilters, cosmeticFilters } = engine.getFilters()
  return { network: networkFilters.length, cosmetic: cosmeticFilters.length }
}

export async function downloadLists(fetcher = fetch) {
  const entries = await Promise.all(
    LIST_SOURCES.map(async (source) => {
      const response = await fetcher(source.url, {
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-cache',
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
      })
      if (!response.ok) throw new Error(`${source.name}: HTTP ${response.status}`)
      if (Number(response.headers.get('content-length')) > MAX_LIST_BYTES)
        throw new Error(`${source.name}: download too large.`)
      // Limit streamed downloads too, even if a server omits Content-Length.
      const reader = response.body.getReader()
      const chunks = []
      let bytes = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          bytes += value.byteLength
          if (bytes > MAX_LIST_BYTES) throw new Error(`${source.name}: download too large.`)
          chunks.push(value)
        }
      } finally {
        await reader.cancel().catch(() => {})
      }
      const text = await new Blob(chunks).text()
      validateList(text, source)
      return [source.id, text]
    })
  )
  return Object.fromEntries(entries)
}
