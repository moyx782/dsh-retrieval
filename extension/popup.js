/**
 * The popup: read the active tab's cookies, show the header this browser would
 * send, and hand it to the DSH retrieval panel.
 *
 * Nothing leaves the machine. "Send" only posts a message into the DSH page
 * that is already open in this browser, which then pre-fills its own form and
 * still asks the person to confirm before storing anything.
 * @module dsh-retrieval-extension/popup
 */

import { formatCookieHeader, hostOf, panelUrl } from './lib/cookies.js'

/** Firefox exposes `browser`, Chromium exposes `chrome`; both answer promises here. */
const api = globalThis.browser ?? globalThis.chrome

/** Where the DSH page usually lives; editable and remembered in the popup. */
const DEFAULT_BASE = 'http://192.168.1.19:3080'

/** The message the DSH page listens for. */
const MESSAGE_TYPE = 'dsh-retrieval-site-auth'

const elements = {
  host: document.getElementById('host'),
  exclude: document.getElementById('exclude'),
  header: document.getElementById('header'),
  copy: document.getElementById('copy'),
  send: document.getElementById('send'),
  base: document.getElementById('base'),
  status: document.getElementById('status'),
}

/** @returns a status line and its tone. */
function say(message, tone = '') {
  elements.status.textContent = message
  elements.status.className = `status${tone === '' ? '' : ` ${tone}`}`
}

/** @returns the active tab, or undefined when the popup cannot see one. */
async function activeTab() {
  const tabs = await api.tabs.query({ active: true, currentWindow: true })
  return tabs[0]
}

/** @returns the cookie records for one tab, or [] when the API refuses. */
async function cookiesFor(url) {
  try {
    return await api.cookies.getAll({ url })
  } catch {
    return []
  }
}

/** Rebuild the header from the cookies this tab carries. */
async function refreshHeader(tab) {
  const url = tab?.url ?? ''
  const host = hostOf(url)
  elements.host.textContent = host === '' ? '这个标签页不是网页' : host
  if (host === '') {
    elements.header.value = ''
    elements.copy.disabled = true
    elements.send.disabled = true
    return
  }
  const cookies = await cookiesFor(url)
  const header = formatCookieHeader(cookies, { excludeTrackers: elements.exclude.checked })
  elements.header.value = header
  elements.copy.disabled = header === ''
  elements.send.disabled = header === ''
  say(cookies.length === 0
    ? '这个标签页没有可用的 cookie，或者当前站点尚未授权给本插件。'
    : `${cookies.length} 个 cookie，保留 ${header === '' ? 0 : header.split('; ').length} 个。`)
}

/** Copy the current header text to the clipboard. */
async function copyHeader() {
  const text = elements.header.value.trim()
  if (text === '') return
  try {
    await navigator.clipboard.writeText(text)
    say('已复制，粘贴到「需要登录的站点」里即可。', 'ok')
  } catch {
    // Older engines refuse the async clipboard in a popup; select and copy instead.
    elements.header.focus()
    elements.header.select()
    const copied = typeof document.execCommand === 'function' && document.execCommand('copy')
    say(copied ? '已复制，粘贴到「需要登录的站点」里即可。' : '复制失败，请手动选中文本复制。', copied ? 'ok' : 'error')
  }
}

/**
 * Post the header into the DSH page, which pre-fills its own form. The value
 * travels through the page's own message channel and nowhere else.
 */
async function sendToPanel() {
  const host = hostOf((await activeTab())?.url ?? '')
  const value = elements.header.value.trim()
  if (host === '' || value === '') return
  const base = panelUrl(elements.base.value || DEFAULT_BASE)
  try {
    await api.storage.local.set({ base })
  } catch {
    // A browser without storage still works for this click.
  }
  let tabs = []
  try {
    tabs = await api.tabs.query({ url: `${base}/*` })
  } catch {
    tabs = []
  }
  const target = tabs[0]
  if (target === undefined) {
    say(`没有找到打开的 DSH 页面，先打开 ${base}。`, 'error')
    return
  }
  try {
    await api.scripting.executeScript({
      target: { tabId: target.id },
      func: (message) => {
        window.postMessage(message, window.location.origin)
      },
      args: [{ type: MESSAGE_TYPE, host, value }],
    })
    await api.tabs.update(target.id, { active: true })
    if (target.windowId !== undefined) await api.windows?.update?.(target.windowId, { focused: true })
    say('已发送到面板：确认范围后点「允许并保存」。', 'ok')
  } catch (error) {
    say(`发送失败：${error instanceof Error ? error.message : String(error)}`, 'error')
  }
}

/** Wire the popup to the active tab. */
async function main() {
  try {
    const stored = await api.storage.local.get({ base: DEFAULT_BASE })
    elements.base.value = stored.base ?? DEFAULT_BASE
  } catch {
    elements.base.value = DEFAULT_BASE
  }
  const tab = await activeTab()
  await refreshHeader(tab)

  elements.exclude.addEventListener('change', () => { refreshHeader(tab) })
  elements.copy.addEventListener('click', copyHeader)
  elements.send.addEventListener('click', sendToPanel)
  elements.base.addEventListener('change', () => {
    api.storage.local.set({ base: elements.base.value.trim() }).catch(() => {})
  })
}

main().catch((error) => {
  say(`插件初始化失败：${error instanceof Error ? error.message : String(error)}`, 'error')
})
