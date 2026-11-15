/**
 * Pure cookie helpers for the browser extension. Kept away from the popup so
 * they can be tested without a browser.
 * @module dsh-retrieval-extension/lib/cookies
 */

/** Cookie names that analytics and ad SDKs set; excluded by default. */
const TRACKER_PATTERNS = [
  /^_ga/i, /^_gid$/, /^_gat/, /^__utm/, /^_gcl/, /^_fbp$/, /^_fbc$/, /^fr$/, /^ide$/i, /^nid$/i,
  /^muid$/i, /^_clck$/, /^_clsk$/, /^ajs_/, /^sentry/, /^amplitude/, /^mixpanel/, /^intercom/,
  /^_hj/, /^__hs/, /^hubspot/i, /^mp_/, /^ab_/, /^optimizely/, /^vwo/, /^_pin_unauth$/,
  /^_ttp$/, /^ttclid$/, /^li_sugr$/, /^bcookie$/, /^lidc$/, /^usermatchhistory$/,
]

/**
 * Whether a cookie belongs to measurement or advertising rather than to the
 * site's own session.
 * @param name - cookie name.
 * @returns true when the name matches a known tracker.
 */
export function isTracker(name) {
  const value = String(name ?? '')
  return TRACKER_PATTERNS.some(pattern => pattern.test(value))
}

/**
 * Build the header value a request would carry.
 * @param cookies - `{ name, value }` records, usually from the cookies API.
 * @param options - `excludeTrackers` (default true) and an optional name filter.
 * @returns the `Cookie` header value, or '' when nothing remains.
 */
export function formatCookieHeader(cookies, options = {}) {
  const { excludeTrackers = true, keepOnly } = options
  const seen = new Set()
  const parts = []
  for (const cookie of Array.isArray(cookies) ? cookies : []) {
    const name = String(cookie?.name ?? '')
    const value = String(cookie?.value ?? '')
    if (name === '' || seen.has(name)) continue
    if (excludeTrackers && isTracker(name)) continue
    if (typeof keepOnly === 'function' && !keepOnly(name)) continue
    seen.add(name)
    parts.push(`${name}=${value}`)
  }
  parts.sort()
  return parts.join('; ')
}

/**
 * The host a page's cookies belong to, without a port.
 * @param rawUrl - tab URL.
 * @returns the hostname, or '' for a non-http(s) tab.
 */
export function hostOf(rawUrl) {
  try {
    const url = new URL(String(rawUrl))
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    return url.hostname
  } catch {
    return ''
  }
}

/**
 * The DSH panel page that this popup can talk to.
 * @param base - configured origin, with or without a trailing slash.
 * @returns the page URL.
 */
export function panelUrl(base) {
  const trimmed = String(base ?? '').trim().replace(/\/+$/, '')
  return /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`
}
