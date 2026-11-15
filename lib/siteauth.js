/**
 * Per-site credentials: the header a logged-in request needs, stored under a
 * reference name derived from the host. The panel writes the same reference, so
 * the two halves agree without a second transport.
 * @module @local/dsh-retrieval/lib/siteauth
 */

/** Every site credential reference starts with this. */
export const SITE_AUTH_PREFIX = 'RETRIEVAL_AUTH_'

/** Hosts allowed to receive a stored header over plain http (loopback only). */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/**
 * The reference name for one host. Non-alphanumerics collapse to `_`, so
 * `api.example.com` becomes `RETRIEVAL_AUTH_API_EXAMPLE_COM`.
 * @param host - a hostname.
 * @returns the credential reference.
 */
export function refForHost(host) {
  return `${SITE_AUTH_PREFIX}${String(host).toLowerCase().replace(/[^a-z0-9]+/g, '_').toUpperCase()}`
}

/**
 * Read a stored value back into request headers. A value that starts with a
 * header name is used as that header; anything else is treated as a cookie
 * string, because that is what people copy out of developer tools.
 * @param raw - the stored credential value.
 * @returns the headers to send, or undefined when the value is unusable.
 */
export function headerFromValue(raw) {
  const value = String(raw ?? '').trim()
  if (value === '') return undefined
  const named = /^([A-Za-z][A-Za-z0-9-]{1,40}):\s*([\s\S]+)$/.exec(value)
  if (named !== null) return { [named[1].toLowerCase()]: named[2].trim() }
  return { cookie: value }
}

/**
 * Whether this URL may carry a stored header. Loopback is exempt so a local
 * fixture can be tested; everything else must be https, because a cookie sent
 * over plain http is readable by anyone on the path.
 * @param url - the parsed target.
 * @returns true when the header may be attached.
 */
export function allowsSiteAuth(url) {
  if (url.protocol === 'https:') return true
  if (url.protocol !== 'http:') return false
  return LOOPBACK.has(url.hostname)
}
