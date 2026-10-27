const $ = (id) => document.getElementById(id)
let tab
let state
async function send(message) {
  const result = await browser.runtime.sendMessage(message)
  if (result?.ok === false) throw new Error(result.error)
  return result
}
function showError(error) {
  $('message').textContent = error.message
  $('message').className = 'message error'
}
async function render() {
  state = await send({ action: 'getState', tabId: tab?.id })
  $('enabled').checked = state.settings.enabled
  $('enabled').disabled = false
  $('hostname').textContent = state.tab?.hostname || 'No website selected'
  $('status').textContent = !state.tab?.supported
    ? 'Unavailable'
    : state.tab.active
      ? 'Active'
      : 'Paused'
  $('site-description').textContent = !state.tab?.hostname
    ? 'Open a website to use this control.'
    : !state.tab.supported
      ? 'Firefox protects this page from extensions.'
      : !state.settings.enabled
        ? 'Blocking is paused everywhere.'
        : state.tab.paused
          ? 'This website and its subdomains are paused.'
          : ''
  $('site-description').hidden = !$('site-description').textContent
  $('site-toggle').disabled = !state.tab?.supported || !state.settings.enabled
  $('site-toggle').textContent = state.tab?.paused ? 'Enable here & reload' : 'Pause here & reload'
  $('blocked').textContent = String(state.tab?.blocked || 0)
  $('rules').textContent = (state.counts.network + state.counts.cosmetic).toLocaleString()
  if (state.startupError || state.updateError)
    showError(new Error(state.startupError || state.updateError))
}
$('enabled').addEventListener('change', async () => {
  try {
    await send({ action: 'saveSettings', settings: { enabled: $('enabled').checked } })
    if (state.tab?.hostname) await browser.tabs.reload(tab.id)
    await render()
  } catch (error) {
    showError(error)
  }
})
$('site-toggle').addEventListener('click', async () => {
  $('site-toggle').disabled = true
  try {
    await send({ action: 'setSiteEnabled', tabId: tab.id, enabled: state.tab.paused })
    await browser.tabs.reload(tab.id)
    window.close()
  } catch (error) {
    showError(error)
    $('site-toggle').disabled = false
  }
})
$('settings').addEventListener('click', () => browser.runtime.openOptionsPage())
$('version').textContent = `v${browser.runtime.getManifest().version}`
;(async () => {
  ;[tab] = await browser.tabs.query({ active: true, currentWindow: true })
  await render()
})().catch(showError)
