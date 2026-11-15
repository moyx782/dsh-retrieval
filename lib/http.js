/**
 * One HTTP call with the parts a retrieval pipeline actually needs: a caller
 * signal, a hard deadline, a byte ceiling, charset decoding, and a header bag
 * the pipeline can read instead of re-deriving.
 * @module @local/dsh-retrieval/lib/http
 */

/** Identifies this reader. Sites rank requests by a descriptive UA above a fake browser one. */
export const USER_AGENT = 'dsh-retrieval/0.1 (assistive page reader; +https://deepseek-harness.local)'

/** Headers that make a plain GET look like a normal document navigation. */
export const BROWSERISH_HEADERS = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.5',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'upgrade-insecure-requests': '1',
}

/**
 * The response of one request, already decoded.
 * @typedef {{ url: string, status: number, ok: boolean, headers: Record<string, string>, body: string,
 *   contentType: string, bytes: number, truncated: boolean, ms: number }} HttpResponse
 */

/**
 * Join a caller's signal with a deadline so either one aborts the request.
 * @param signal - the tool call's signal, when there is one.
 * @param timeoutMs - the hard deadline.
 * @returns the combined signal and a disposer that clears the timer.
 */
function withDeadline(signal, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs)
  const signals = signal === undefined ? [controller.signal] : [controller.signal, signal]
  const combined = typeof AbortSignal.any === 'function' ? AbortSignal.any(signals) : controller.signal
  return { signal: combined, done: () => clearTimeout(timer) }
}

/**
 * Pull a charset from the `Content-Type` header or, failing that, from a byte
 * prefix of the document itself, which is where an HTML `<meta>` declares it.
 * @param contentType - the header value, possibly empty.
 * @param head - the first bytes of the body.
 * @returns a charset label TextDecoder accepts.
 */
export function detectCharset(contentType, head) {
  const fromHeader = /charset\s*=\s*"?([\w-]+)/i.exec(contentType ?? '')
  if (fromHeader !== null) return fromHeader[1].toLowerCase()
  const prefix = new TextDecoder('latin1').decode(head.subarray(0, 2048))
  const fromMeta = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(prefix)
  if (fromMeta !== null) return fromMeta[1].toLowerCase()
  const declared = /<meta[^>]+content\s*=\s*["'][^"']*charset\s*=\s*([\w-]+)/i.exec(prefix)
  if (declared !== null) return declared[1].toLowerCase()
  return 'utf-8'
}

/**
 * Decode bytes with the detected charset, falling back to UTF-8 rather than
 * throwing on a label the runtime does not know.
 * @param bytes - the raw body.
 * @param contentType - the response's `Content-Type`.
 * @returns the decoded text.
 */
export function decodeBody(bytes, contentType) {
  const head = bytes.length > 4096 ? bytes.subarray(0, 4096) : bytes
  let charset = detectCharset(contentType, head)
  // GB2312 is a strict subset of GBK; decoders implement the wider one.
  if (charset === 'gb2312' || charset === 'gb_2312-80') charset = 'gbk'
  try {
    return new TextDecoder(charset).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

/**
 * Read a response body under a byte ceiling.
 * @param response - the fetch response.
 * @param maxBytes - stop early past this many bytes.
 * @returns the bytes read and whether the body was cut.
 */
async function readCapped(response, maxBytes) {
  if (response.body === null) return { bytes: new Uint8Array(0), truncated: false }
  const chunks = []
  let total = 0
  let truncated = false
  for await (const chunk of response.body) {
    const view = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
    if (total + view.byteLength > maxBytes) {
      chunks.push(view.subarray(0, maxBytes - total))
      total = maxBytes
      truncated = true
      break
    }
    chunks.push(view)
    total += view.byteLength
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { bytes, truncated }
}

/**
 * Perform one request.
 * @param url - absolute http(s) URL.
 * @param options - method, headers, body, deadline, ceiling, signal.
 * @returns the decoded response.
 */
export async function httpRequest(url, options = {}) {
  const {
    method = 'GET',
    headers = {},
    body,
    timeoutMs = 15_000,
    maxBytes = 2_000_000,
    signal,
    redirect = 'follow',
  } = options
  const started = Date.now()
  const deadline = withDeadline(signal, timeoutMs)
  try {
    const response = await fetch(url, {
      method,
      body,
      redirect,
      signal: deadline.signal,
      headers: { 'user-agent': USER_AGENT, ...headers },
    })
    const { bytes, truncated } = await readCapped(response, maxBytes)
    const headerBag = {}
    for (const [key, value] of response.headers) headerBag[key.toLowerCase()] = value
    const contentType = headerBag['content-type'] ?? ''
    return {
      url: response.url === '' ? url : response.url,
      status: response.status,
      ok: response.ok,
      headers: headerBag,
      body: decodeBody(bytes, contentType),
      contentType,
      bytes: bytes.byteLength,
      truncated,
      ms: Date.now() - started,
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`${method} ${url} failed: ${reason}`)
  } finally {
    deadline.done()
  }
}

/**
 * Ask for JSON and parse it, keeping the failure readable.
 * @param url - absolute http(s) URL.
 * @param options - as {@link httpRequest}.
 * @returns the parsed value.
 */
export async function httpJson(url, options = {}) {
  const response = await httpRequest(url, {
    ...options,
    headers: { accept: 'application/json', ...options.headers },
  })
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`)
  try {
    return { json: JSON.parse(response.body), response }
  } catch {
    throw new Error(`${url} did not answer JSON (${response.contentType || 'no content type'})`)
  }
}

/**
 * Read a problem response as readable text without throwing, for adapters that
 * want to fall through to the next layer instead of failing the whole call.
 * @param url - absolute http(s) URL.
 * @param options - as {@link httpRequest}.
 * @returns the response, or undefined when the request could not complete.
 */
export async function tryRequest(url, options = {}) {
  try {
    return await httpRequest(url, options)
  } catch {
    return undefined
  }
}
