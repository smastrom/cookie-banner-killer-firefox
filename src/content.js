import { DOMMonitor, extractFeaturesFromDOM, injectScript } from '@ghostery/adblocker-content'
import { handlePseudoDirective, querySelectorAll } from '@ghostery/adblocker-extended-selectors'
import { createScrollRepair } from './scroll-repair.js'
import { createPaywallSupport } from './paywalls.js'

const EMPTY = { active: false, styles: '', scripts: [], extended: [] }
const extended = new Map()
const marked = new Map()
const styleTexts = new Set()
const shadows = new Map()
const scrollRepair = createScrollRepair()
const paywalls = createPaywallSupport()
let lastPaywallStatus = ''
let active = true
let observer
let monitor
let timer
let shadowTimer
let generation = 0
let started = false

async function request(features) {
  const currentGeneration = generation
  const result = await browser.runtime
    .sendMessage({ action: 'getCosmeticsFilters', ...features })
    .catch(() => EMPTY)
  if (currentGeneration !== generation) return
  active = Boolean(result?.active)
  paywalls.configure(result?.paywallSupport)
  if (!active) {
    stop()
    return
  }
  if (result.styles && !styleTexts.has(result.styles)) {
    styleTexts.add(result.styles)
    for (const { sheet } of shadows.values()) sheet.textContent += `\n${result.styles}`
  }
  for (const script of result.scripts || []) injectScript(script, document)
  for (const rule of result.extended || []) extended.set(rule.id, rule)
  scrollRepair.enabled = result.repairScroll
  schedule()
}

function schedule() {
  if (!active || timer) return
  timer = setTimeout(() => {
    timer = undefined
    updateExtended()
    scrollRepair.run()
    const paywall = paywalls.run()
    const statusKey = JSON.stringify([location.href, paywall])
    if (paywall && statusKey !== lastPaywallStatus) {
      lastPaywallStatus = statusKey
      void browser.runtime.sendMessage({ action: 'paywallStatus', ...paywall }).catch(() => {})
    }
    for (const [root, { watcher }] of shadows) {
      if (!root.host.isConnected) {
        watcher.disconnect()
        shadows.delete(root)
      }
    }
  }, 180)
}

function updateExtended() {
  if (!document.documentElement) return
  for (const rule of extended.values()) {
    try {
      const nodes = new Set(querySelectorAll(document.documentElement, rule.ast))
      if (rule.directive) {
        for (const node of nodes) handlePseudoDirective(node, rule.directive)
      } else if (rule.attribute) {
        const previous = marked.get(rule.id) || new Set()
        for (const node of nodes)
          if (!node.hasAttribute(rule.attribute)) node.setAttribute(rule.attribute, '')
        for (const node of previous) if (!nodes.has(node)) node.removeAttribute(rule.attribute)
        marked.set(rule.id, nodes)
      }
    } catch {
      /* Unsupported selectors must not disable the other rules. */
    }
  }
}

function discoverShadows(root) {
  const candidates =
    root instanceof Element
      ? [root, ...root.querySelectorAll('*')]
      : [...root.querySelectorAll('*')]
  for (const element of candidates) {
    if (!element.shadowRoot || shadows.has(element.shadowRoot)) continue
    const shadow = element.shadowRoot
    const sheet = document.createElement('style')
    sheet.textContent = [...styleTexts].join('\n')
    shadow.appendChild(sheet)
    const collect = () => {
      void request({
        lifecycle: 'dom-update',
        ...extractFeaturesFromDOM([...shadow.children].filter((node) => node !== sheet)),
      })
      discoverShadows(shadow)
      schedule()
    }
    const watcher = new MutationObserver((mutations) => {
      if (mutations.some((m) => m.target !== sheet && !sheet.contains(m.target))) collect()
    })
    watcher.observe(shadow, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'id', 'href'],
    })
    shadows.set(shadow, { sheet, watcher })
    collect()
  }
}

function observe() {
  if (started || !active) return
  started = true
  monitor = new DOMMonitor((update) => {
    if (update.type === 'features') void request({ ...update, lifecycle: 'dom-update' })
    else {
      for (const node of update.elements) discoverShadows(node)
      schedule()
    }
  })
  monitor.queryAll(window)
  monitor.start(window)
  observer = new MutationObserver(schedule)
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['style', 'class', 'open', 'aria-hidden', 'aria-modal'],
  })
  discoverShadows(document)
  // Web components may attach a shadow root after insertion without a DOM mutation.
  let passes = 0
  shadowTimer = setInterval(() => {
    discoverShadows(document)
    if (++passes === 10) clearInterval(shadowTimer)
  }, 2000)
  schedule()
}

function stop() {
  monitor?.stop()
  observer?.disconnect()
  for (const { watcher } of shadows.values()) watcher.disconnect()
  clearTimeout(timer)
  clearInterval(shadowTimer)
  timer = undefined
  started = false
}

function start() {
  generation++
  active = true
  void request({ lifecycle: 'start', ids: [], classes: [], hrefs: [] })
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', observe, { once: true })
  else observe()
}

window.addEventListener('pagehide', () => {
  generation++
  stop()
})
window.addEventListener('popstate', schedule)
window.addEventListener('hashchange', schedule)
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    shadows.clear()
    start()
  }
})
start()
