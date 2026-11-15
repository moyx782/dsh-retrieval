/**
 * The reader tier: hand the URL to a service that renders it and returns
 * Markdown. It costs no browser download and no API key on the anonymous
 * allowance, so it sits between static extraction and Playwright. The URL does
 * leave the machine, which is why every result says so.
 * @module @local/dsh-retrieval/lib/reader
 */

/** The public endpoint, and the documented anonymous allowance. */
export const READER_ENDPOINT = 'https://r.jina.ai/'
const ANONYMOUS_PER_MINUTE = 18

/** Sliding window of recent call times, shared by every caller in this process. */
const recentCalls = []

/** @returns a promise that resolves when one more call fits the allowance. */
async function waitForSlot(signal) {
  for (;;) {
    const now = Date.now()
    while (recentCalls.length > 0 && now - recentCalls[0] > 60_000) recentCalls.shift()
    if (recentCalls.length < ANONYMOUS_PER_MINUTE) {
      recentCalls.push(now)
      return
    }
    const waitMs = Math.max(250, 60_000 - (now - recentCalls[0]))
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, waitMs)
      signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(new Error('cancelled while waiting for the reader service'))
      }, { once: true })
    })
  }
}

/** @returns the front-matter fields the service prints above the body. */
function parseReaderOutput(body) {
  const lines = body.split(/\r?\n/)
  const meta = {}
  let index = 0
  for (; index < lines.length && index < 12; index += 1) {
    const match = /^(Title|URL Source|Published Time|Warning|Markdown Content):\s*(.*)$/.exec(lines[index])
    if (match === null) {
      if (lines[index].trim() === '') continue
      break
    }
    meta[match[1]] = match[2]
  }
  const text = lines.slice(index).join('\n').trim()
  return { meta, text }
}

/**
 * Read one URL through the reader service.
 * @param url - absolute URL.
 * @param options - token, endpoint, signal, deadline.
 * @returns the Markdown body and its metadata.
 */
export async function readWithService(url, options = {}) {
  const { token, endpoint = READER_ENDPOINT, signal, timeoutMs = 30_000 } = options
  await waitForSlot(signal)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(`reader timed out after ${timeoutMs} ms`)), timeoutMs)
  const combined = signal === undefined ? controller.signal : AbortSignal.any([controller.signal, signal])
  try {
    const headers = {
      accept: 'text/plain',
      'user-agent': 'dsh-retrieval/0.1',
      'x-respond-with': 'markdown',
    }
    if (typeof token === 'string' && token !== '') headers.authorization = `Bearer ${token}`
    const response = await fetch(`${endpoint}${url}`, { headers, signal: combined })
    const body = await response.text()
    if (!response.ok) {
      throw new Error(`reader service answered HTTP ${response.status}: ${body.slice(0, 200)}`)
    }
    const parsed = parseReaderOutput(body)
    return { text: parsed.text, title: parsed.meta.Title ?? '', source: parsed.meta['URL Source'] ?? url }
  } finally {
    clearTimeout(timer)
  }
}
