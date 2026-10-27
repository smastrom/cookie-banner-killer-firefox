// Publisher selectors informed by Bypass Paywalls Clean (MIT, magnolia1234).
// See THIRD_PARTY_NOTICES.md. Only these verified adapters are enabled.
export const PAYWALL_PUBLISHERS = Object.freeze([
  {
    id: 'domani',
    hosts: ['editorialedomani.it', 'www.editorialedomani.it'],
    articlePath:
      /^\/(?:politica|idee|fatti|economia|ambiente|giustizia|cultura|sport)\/(?:[^/]+\/)*[a-z0-9-]+-[a-z0-9]{8}\/?$/i,
    testedAt: '2026-10-28',
    testURL:
      'https://www.editorialedomani.it/politica/mondo/elezioni-israele-tel-aviv-netanyahu-voto-parlamento-likud-gaza-cisgiordania-hwrm74f2',
  },
  {
    id: 'ilfoglio',
    hosts: ['ilfoglio.it', 'www.ilfoglio.it'],
    articlePath: /^\/[^/]+\/\d{4}\/\d{2}\/\d{2}\/news\/[^/]+-\d+\/?$/,
    testedAt: '2026-10-28',
    testURL:
      'https://www.ilfoglio.it/politica/2026/10/27/news/attacco-hacker-bucato-il-sito-della-camera-e-la-casella-di-meloni--411774',
  },
])

export function paywallSite(url) {
  try {
    const page = new URL(url)
    if (!/^https?:$/.test(page.protocol)) return null
    return PAYWALL_PUBLISHERS.find((publisher) => publisher.hosts.includes(page.hostname)) || null
  } catch {
    return null
  }
}

export function paywallPublisher(url) {
  const publisher = paywallSite(url)
  return publisher?.articlePath.test(new URL(url).pathname) ? publisher : null
}

function sameArticle(candidate, pageURL) {
  if (typeof candidate !== 'string') return false
  try {
    const a = new URL(candidate)
    const b = new URL(pageURL)
    return (
      /^https?:$/.test(a.protocol) &&
      a.hostname.replace(/^www\./, '') === b.hostname.replace(/^www\./, '') &&
      a.pathname.replace(/\/$/, '') === b.pathname.replace(/\/$/, '')
    )
  } catch {
    return false
  }
}

// Match the current article, never the body of a recommendation in the same JSON-LD.
export function articleBodyFromJSON(text, pageURL) {
  if (typeof text !== 'string' || text.length > 2 * 1024 * 1024) return ''
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return ''
  }
  const queue = [parsed]
  for (let visited = 0; queue.length && visited < 200; visited++) {
    const node = queue.shift()
    if (!node || typeof node !== 'object') continue
    if (Array.isArray(node)) {
      queue.push(...node.slice(0, 200))
      continue
    }
    const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']]
    const identity =
      node.mainEntityOfPage?.['@id'] || node.mainEntityOfPage || node.url || node['@id']
    if (
      types.some((type) =>
        ['Article', 'NewsArticle', 'OpinionNewsArticle', 'ReportageNewsArticle'].includes(type)
      ) &&
      sameArticle(identity, pageURL) &&
      typeof node.articleBody === 'string'
    )
      return node.articleBody.trim()
    if (node['@graph']) queue.push(node['@graph'])
    if (node.mainEntity) queue.push(node.mainEntity)
  }
  return ''
}

export function longerArticle(body, preview) {
  const normalize = (text) => text.replace(/\s+/g, ' ').trim()
  const full = normalize(body)
  const excerpt = normalize(preview)
  return (
    full.length > Math.max(300, excerpt.length + 120) &&
    excerpt.length >= 60 &&
    full.startsWith(excerpt.slice(0, 100))
  )
}

// Applied only after an adapter verifies that article content is present.
export const PAYWALL_STYLES = `
article .article-preview[data-cbk-readable],
article .paywall-wrapper__story-content[data-cbk-readable] {
  display: block !important;
  visibility: visible !important;
  height: auto !important;
  max-height: none !important;
  overflow: visible !important;
  filter: none !important;
}
article .article-preview[data-cbk-readable]::after { display: none !important; }
article [data-cbk-paywall-hidden] { display: none !important; }
`
