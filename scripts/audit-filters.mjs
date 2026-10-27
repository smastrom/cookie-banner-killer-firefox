// Checks filter compatibility, not whether every live website is covered.
import { evaluatePreprocessor, parseFilters, Resources } from '@ghostery/adblocker-webextension'
import { LIST_SOURCES } from '../src/shared/config.js'
import { FILTER_ENV, prepareFilters, validateList } from '../src/shared/filters.js'

const catalogURL =
  'https://raw.githubusercontent.com/brave/adblock-resources/master/filter_lists/list_catalog.json'
const env = new Map(Object.entries(FILTER_ENV))
const resourceText = await Bun.file('vendor/resources.json').text()
const resources = Resources.parse(resourceText, {
  checksum: 'audit',
})
const redirectNames = new Set(
  JSON.parse(resourceText).redirects.flatMap(({ name, aliases }) => [name, ...aliases])
)

function activeLines(text) {
  const stack = []
  const lines = text.split('\n').map((line) => {
    if (line.startsWith('!#if ')) {
      stack.push(evaluatePreprocessor(line.slice(5).replace(/\s/g, ''), env))
    } else if (line === '!#else') {
      if (!stack.length) throw new Error('Unmatched !#else')
      stack.push(!stack.pop())
    } else if (line === '!#endif') {
      if (!stack.length) throw new Error('Unmatched !#endif')
      stack.pop()
    } else if (line.startsWith('!#')) {
      throw new Error(`Unknown directive: ${line}`)
    } else if (stack.every(Boolean)) return line
    return '' // Preserve source line numbers in unsupported-rule diagnostics.
  })
  if (stack.length) throw new Error('Unclosed !#if')
  return lines.join('\n')
}

const report = { checkedAt: new Date().toISOString(), sources: [] }
let failures = 0
if (process.argv.includes('--online')) {
  const response = await fetch(catalogURL, {
    credentials: 'omit',
    signal: AbortSignal.timeout(30000),
  })
  if (!response.ok) throw new Error(`Brave catalog: HTTP ${response.status}`)
  const catalog = await response.json()
  const cookie = catalog.find((entry) => entry.title === 'Cookie notice blocker')
  if (!cookie?.sources?.length) throw new Error('Cookie list not found in Brave catalog')
  const localURLs = new Set(LIST_SOURCES.map((source) => source.url))
  const missingSources = cookie.sources.filter((source) => !localURLs.has(source.url))
  report.braveCatalog = { url: catalogURL, sources: cookie.sources, missingSources }
  failures += missingSources.length
}

for (const source of LIST_SOURCES) {
  const text = await Bun.file(`filters/${source.file}`).text()
  validateList(text, source)
  const modes = {}
  for (const compatibilityMode of [false, true]) {
    const parsed = parseFilters(activeLines(prepareFilters(text, compatibilityMode)), {
      loadExtendedSelectors: true,
      loadPreprocessors: true,
    })
    const scripts = parsed.cosmeticFilters.filter((rule) => rule.isScriptInject())
    const missingScriptlets = [
      ...new Set(
        scripts
          .map((rule) => rule.parseScript()?.name)
          .filter((name) => name && !resources.getScriptlet(name))
      ),
    ]
    const invalidSelectors = parsed.cosmeticFilters
      .filter((rule) => rule.isExtended() && !rule.getASTComponents())
      .map((rule) => rule.getSelector())
    const missingRedirects = [
      ...new Set(
        parsed.networkFilters
          .filter((rule) => rule.isRedirect() || rule.isRedirectRule())
          .map((rule) => rule.getRedirectResource())
          .filter((name) => name && !redirectNames.has(name))
      ),
    ]
    failures +=
      parsed.notSupportedFilters.length +
      missingScriptlets.length +
      invalidSelectors.length +
      missingRedirects.length
    modes[compatibilityMode ? 'withConsentActions' : 'default'] = {
      network: parsed.networkFilters.length,
      cosmetic: parsed.cosmeticFilters.length,
      scriptlets: scripts.length,
      unsupported: parsed.notSupportedFilters,
      missingScriptlets,
      invalidSelectors,
      missingRedirects,
    }
  }
  report.sources.push({ id: source.id, ...modes })
}
report.failures = failures
await Bun.write('test-results/filter-audit.json', JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
if (failures) process.exitCode = 1
