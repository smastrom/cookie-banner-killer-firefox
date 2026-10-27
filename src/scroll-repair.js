const COOKIE_UI = [
  '#onetrust-consent-sdk',
  '#onetrust-banner-sdk',
  '#CybotCookiebotDialog',
  '#didomi-host',
  '#iubenda-cs-banner',
  '.iubenda-cs-overlay',
  '.qc-cmp2-container',
  '[id^="sp_message_container_"]',
  '#cookie-law-info-bar',
  '#moove_gdpr_cookie_info_bar',
  '.cmplz-cookiebanner',
  '.cc-window',
  '#cookie-banner',
  '#cookie-consent',
  '[data-testid="cookie-banner"]',
  'dialog[id*="cookie"]',
].join(',')

function isShown(node) {
  return node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden'
}

export function createScrollRepair() {
  const changes = new Map()
  let evidence = false
  function restore() {
    for (const [element, properties] of changes) {
      for (const [name, value] of properties) {
        if (element.style.getPropertyValue(name) === value.applied) {
          if (value.original) element.style.setProperty(name, value.original, value.priority)
          else element.style.removeProperty(name)
        }
      }
    }
    changes.clear()
  }
  function set(element, name, value) {
    if (
      element.style.getPropertyValue(name) === value &&
      element.style.getPropertyPriority(name) === 'important'
    )
      return
    let properties = changes.get(element)
    if (!properties) changes.set(element, (properties = new Map()))
    if (!properties.has(name))
      properties.set(name, {
        original: element.style.getPropertyValue(name),
        priority: element.style.getPropertyPriority(name),
        applied: value,
      })
    element.style.setProperty(name, value, 'important')
  }
  return {
    enabled: true,
    run() {
      if (!this.enabled || !document.body) return
      const cookieElements = [...document.querySelectorAll(COOKIE_UI)]
      evidence ||= cookieElements.some((node) => !isShown(node))
      if (!evidence) return
      // A regular dialog opened later must retain its own scroll lock.
      const modalOpen = [
        ...document.querySelectorAll(
          'dialog[open], [role="dialog"][aria-modal="true"], .modal.show'
        ),
      ].some((node) => isShown(node) && !node.matches(COOKIE_UI) && !node.closest(COOKIE_UI))
      if (modalOpen) {
        restore()
        return
      }
      for (const element of [document.documentElement, document.body]) {
        const style = getComputedStyle(element)
        if (style.overflowY === 'hidden' || style.overflowY === 'clip')
          set(element, 'overflow-y', 'auto')
      }
      const style = getComputedStyle(document.body)
      if (style.position === 'fixed') {
        const offset = Number.parseFloat(style.top)
        set(document.body, 'position', 'static')
        if (offset < 0) window.scrollTo(0, -offset)
      }
    },
    restore,
  }
}
