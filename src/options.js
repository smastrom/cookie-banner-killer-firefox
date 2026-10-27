const $ = (id) => document.getElementById(id)
const booleanFields = [
  'enabled',
  'repairScroll',
  'autoUpdate',
  'compatibilityMode',
  'paywallSupport',
]
async function send(message) {
  const result = await browser.runtime.sendMessage(message)
  if (result?.ok === false) throw new Error(result.error)
  return result
}
function message(text, error = false) {
  $('message').textContent = text
  $('message').className = `message${error ? ' error' : ''}`
}
async function render(populateForm = true) {
  const state = await send({ action: 'getState' })
  if (populateForm) {
    for (const id of booleanFields) $(id).checked = state.settings[id]
    $('disabledSites').value = state.settings.disabledSites.join('\n')
    $('customFilters').value = state.settings.customFilters
  }
  const count = state.counts.network + state.counts.cosmetic
  const updated = state.updatedAt ? new Date(state.updatedAt).toLocaleString() : 'unknown'
  $('filter-status').textContent = `${count.toLocaleString()} rules · Updated ${updated}`
  $('sources').replaceChildren(
    ...state.sources.map((source) => {
      const item = document.createElement('li')
      const link = document.createElement('a')
      link.textContent = source.name
      link.href = source.url
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      item.append(link)
      return item
    })
  )
  $('save').disabled = Boolean(state.startupError)
  if (state.startupError || state.updateError)
    message(state.startupError || state.updateError, true)
}
$('settings-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  $('save').disabled = true
  try {
    const settings = Object.fromEntries(booleanFields.map((id) => [id, $(id).checked]))
    settings.disabledSites = $('disabledSites')
      .value.split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
    settings.customFilters = $('customFilters').value
    await send({ action: 'saveSettings', settings })
    await render()
    message('Saved. Reload open pages to apply your settings.')
  } catch (error) {
    message(error.message, true)
  } finally {
    $('save').disabled = false
  }
})
$('update').addEventListener('click', async () => {
  $('update').disabled = true
  $('update').textContent = 'Updating…'
  try {
    await send({ action: 'refreshFilters' })
    await render(false)
    message('Filters updated. Reload open pages to use the latest rules.')
  } catch (error) {
    message(error.message, true)
  } finally {
    $('update').disabled = false
    $('update').textContent = 'Update now'
  }
})
$('version').textContent = `v${browser.runtime.getManifest().version}`
render().catch((error) => message(error.message, true))
