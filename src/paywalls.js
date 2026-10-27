import { articleBodyFromJSON, longerArticle, paywallPublisher } from './shared/paywalls.js'

export function createPaywallSupport() {
  let enabled = false
  let page = ''
  const changed = new Map()

  function restore() {
    for (const [node, original] of changed) {
      node.removeAttribute('data-cbk-readable')
      node.removeAttribute('data-cbk-paywall-hidden')
      // Do not overwrite an article the site's own router has replaced.
      if (original && node.firstChild === original.replacement && node.childNodes.length === 1)
        node.replaceChildren(...original.children)
    }
    changed.clear()
  }

  function mark(node, attribute) {
    if (!changed.has(node)) changed.set(node, null)
    if (!node.hasAttribute(attribute)) node.setAttribute(attribute, '')
  }

  return {
    configure(value) {
      enabled = Boolean(value)
      if (!enabled) restore()
    },
    run() {
      if (page !== location.href) {
        restore()
        page = location.href
      }
      if (!enabled) return null
      const publisher = paywallPublisher(page)
      if (!publisher) {
        restore()
        return null
      }
      for (const node of changed.keys()) if (!node.isConnected) changed.delete(node)
      let status = 'not-detected'
      if (publisher.id === 'domani') {
        const preview = document.querySelector('article .article-preview')
        const article = preview?.closest('article')
        const wall = article?.querySelector('.paywallbox')
        if (
          preview &&
          changed.has(preview) &&
          changed.get(preview)?.replacement !== preview.firstChild
        )
          restore()
        if (preview && wall) {
          status = 'unavailable'
          if (changed.get(preview)?.replacement === preview.firstChild) {
            mark(wall, 'data-cbk-paywall-hidden')
            status = 'restored'
          } else {
            for (const script of [
              ...document.querySelectorAll('script[type="application/ld+json"]'),
            ].slice(0, 64)) {
              const body = articleBodyFromJSON(script.textContent, page)
              if (!longerArticle(body, preview.textContent)) continue
              const replacement = document.createElement('div')
              for (const text of body.split(/\n+/).filter((part) => part.trim())) {
                const paragraph = document.createElement('p')
                paragraph.textContent = text
                replacement.append(paragraph)
              }
              changed.set(preview, { children: [...preview.childNodes], replacement })
              preview.replaceChildren(replacement)
              mark(preview, 'data-cbk-readable')
              mark(wall, 'data-cbk-paywall-hidden')
              status = 'restored'
              break
            }
          }
        }
      } else if (publisher.id === 'ilfoglio') {
        for (const content of document.querySelectorAll(
          'article .paywall-wrapper__story-content'
        )) {
          const wall = content.parentElement?.querySelector(':scope > .paywall')
          if (!wall) continue
          if (content.textContent.trim().length < 300) {
            content.removeAttribute('data-cbk-readable')
            wall.removeAttribute('data-cbk-paywall-hidden')
            changed.delete(content)
            changed.delete(wall)
            status = 'unavailable'
            continue
          }
          mark(content, 'data-cbk-readable')
          mark(wall, 'data-cbk-paywall-hidden')
          status = 'restored'
        }
      }
      return { publisher: publisher.id, status }
    },
  }
}
