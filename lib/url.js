/**
 * One place to turn whatever a human or a model pasted into a URL the
 * pipeline may request: a bare host, a protocol-relative path, an anchor, a
 * link with campaign parameters.
 * @module @local/dsh-retrieval/lib/url
 */

/** Query parameters that never change which document is served. */
const TRACKERS = [/^utm_/i, /^fbclid$/i, /^gclid$/i, /^yclid$/i, /^msclkid$/i, /^spm$/i, /^ref_src$/i,
  /^igshid$/i, /^share_source$/i, /^from$/i, /^share_token$/i, /^si$/i]

/**
 * Normalize an address for fetching, or explain why it cannot be fetched.
 * @param input - raw text.
 * @returns the absolute URL, or undefined when it is not an http(s) address.
 */
export function normalizeUrl(input) {
  const raw = String(input ?? '').trim()
  if (raw === '') return undefined
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, '')}`
  let url
  try {
    url = new URL(withScheme)
  } catch {
    return undefined
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
  url.hash = ''
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKERS.some(pattern => pattern.test(key))) url.searchParams.delete(key)
  }
  // Sort surviving parameters so the same document normalizes to one cache key.
  const sorted = [...url.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  url.search = ''
  for (const [key, value] of sorted) url.searchParams.append(key, value)
  return url
}

/**
 * The form shown to a reader: no trailing slash on a bare host, no empty query.
 * @param url - a parsed URL.
 * @returns the display address.
 */
export function displayUrl(url) {
  const copy = new URL(url.toString())
  if (copy.pathname === '/' && copy.search === '') return `${copy.origin}/`
  return copy.toString()
}

/**
 * Score a link's likely value as a follow-up read: a document beats a folder,
 * and an anchor into the current page is worthless.
 * @param linkUrl - candidate link.
 * @param baseUrl - the page it was found on.
 * @returns a score from 0 upward.
 */
export function linkScore(linkUrl, baseUrl) {
  let url
  try {
    url = new URL(linkUrl, baseUrl)
  } catch {
    return 0
  }
  if (url.hostname !== new URL(baseUrl).hostname) return 1
  if (url.hash !== '') return 0
  if (/\.(pdf|zip|png|jpe?g|gif|svg|mp4|mp3)$/i.test(url.pathname)) return 0.5
  if (/\/(tag|tags|category|categories|author|page|search|login|signin|signup|account|cart)\b/.test(url.pathname)) return 0.2
  const segments = url.pathname.split('/').filter(part => part !== '')
  if (segments.length === 0) return 0.2
  if (/\.(html?|md|txt)$/.test(url.pathname)) return 3
  if (segments.length >= 2) return 2.5
  return 1.5
}
