/**
 * The survey a caller runs before deciding how to read a site: what the site
 * allows, what it publishes for machines, whether the page is server-rendered,
 * and which documented API already covers this host.
 * @module @local/dsh-retrieval/lib/probe
 */

import { adapterFor } from './adapters.js'
import { BROWSERISH_HEADERS, tryRequest } from './http.js'
import { findAll, parseHtml, readHtml } from './html.js'
import { evaluateRobots, parseRobots } from './robots.js'
import { displayUrl, normalizeUrl } from './url.js'

/** Feed types worth reporting as a machine-readable alternative. */
const FEED_TYPES = ['application/rss+xml', 'application/atom+xml', 'application/feed+json', 'application/json']

/** @returns the link elements that name an alternate representation. */
function alternateLinks(html) {
  const parsed = parseHtml(html)
  const feeds = []
  let openSearch
  for (const link of findAll(parsed, 'link')) {
    const rel = (link.attrs.rel ?? '').toLowerCase()
    const type = (link.attrs.type ?? '').toLowerCase()
    const href = link.attrs.href ?? ''
    if (href === '') continue
    if (rel.includes('alternate') && FEED_TYPES.some(feedType => type.startsWith(feedType))) {
      feeds.push({ href, type, title: link.attrs.title ?? '' })
    }
    if (rel.includes('search') && type.includes('opensearchdescription')) openSearch = href
  }
  return { feeds, openSearch }
}

/** @returns the signs that this document needs JavaScript to show its content. */
export function clientRenderingSignals(html, visibleLength) {
  const signals = []
  if (/<div[^>]+id=["'](root|app|__next|__nuxt)["'][^>]*>\s*<\/div>/i.test(html)) signals.push('empty mount point')
  if (/__NEXT_DATA__/.test(html)) signals.push('Next.js payload')
  if (/window\.__NUXT__/.test(html)) signals.push('Nuxt payload')
  if (/ng-version=/.test(html)) signals.push('Angular root')
  if (/data-reactroot/.test(html)) signals.push('React root')
  if (/window\.__INITIAL_STATE__/.test(html)) signals.push('serialized state')
  if (visibleLength < 120 && html.length > 15_000) signals.push('tiny text in a large document')
  return signals
}

/**
 * Survey one address.
 * @param input - URL or host.
 * @param options - signal and deadline.
 * @returns the report the tool prints and the pipeline reads.
 */
export async function probe(input, options = {}) {
  const { signal, timeoutMs = 15_000 } = options
  const url = normalizeUrl(input)
  if (url === undefined) throw new Error(`"${input}" is not an http(s) address`)
  const origin = url.origin
  const notes = []

  const matched = adapterFor(url)
  const adapter = matched === undefined
    ? undefined
    : { id: matched.adapter.id, label: matched.adapter.label, operation: matched.params.kind ?? 'page', search: typeof matched.adapter.search === 'function' }

  let robots = { status: 'missing', allowed: true, rule: undefined, crawlDelay: undefined, sitemaps: [] }
  const robotsResponse = await tryRequest(`${origin}/robots.txt`, {
    signal, timeoutMs: Math.min(timeoutMs, 8_000), maxBytes: 256_000, headers: { accept: 'text/plain' },
  })
  if (robotsResponse !== undefined && robotsResponse.ok && robotsResponse.body.trim() !== '') {
    const parsed = parseRobots(robotsResponse.body)
    const verdict = evaluateRobots(parsed, `${url.pathname}${url.search}`)
    robots = {
      status: 'found',
      allowed: verdict.allowed,
      rule: verdict.rule,
      crawlDelay: verdict.crawlDelay,
      sitemaps: parsed.sitemaps,
    }
  } else if (robotsResponse !== undefined) {
    notes.push(`robots.txt answered HTTP ${robotsResponse.status}; treated as no restriction.`)
  }

  let sitemaps = robots.sitemaps.slice(0, 5)
  if (sitemaps.length === 0) {
    const sitemap = await tryRequest(`${origin}/sitemap.xml`, {
      signal, timeoutMs: Math.min(timeoutMs, 8_000), maxBytes: 200_000, headers: { accept: 'application/xml' },
    })
    if (sitemap !== undefined && sitemap.ok && /<sitemapindex|<urlset/i.test(sitemap.body)) sitemaps = [`${origin}/sitemap.xml`]
  }

  const document = await tryRequest(url.toString(), {
    signal, timeoutMs, maxBytes: 600_000, headers: BROWSERISH_HEADERS,
  })

  const report = {
    url: displayUrl(url),
    host: url.hostname,
    adapter,
    robots,
    sitemaps,
    feeds: [],
    openSearch: undefined,
    title: '',
    description: '',
    visibleLength: 0,
    contentType: '',
    status: 0,
    rendering: 'server',
    signals: [],
    recommendation: 'http',
    notes,
  }

  if (document === undefined) {
    report.rendering = 'unknown'
    report.recommendation = adapter === undefined ? 'reader' : 'api'
    notes.push('The first request did not complete; the pipeline will retry and fall through the tiers.')
    return report
  }

  report.status = document.status
  report.contentType = document.contentType
  if (!document.ok) {
    notes.push(`The page answered HTTP ${document.status}.`)
  } else if (/html/.test(document.contentType) || document.body.trimStart().startsWith('<')) {
    const read = readHtml(document.body, url.toString())
    report.title = read.title
    report.description = read.description
    report.visibleLength = read.visibleLength
    const alternates = alternateLinks(document.body)
    report.feeds = alternates.feeds
    report.openSearch = alternates.openSearch
    report.signals = clientRenderingSignals(document.body, read.visibleLength)
    if (report.signals.length > 0 && read.visibleLength < 500) report.rendering = 'client'
  } else if (/json/.test(document.contentType)) {
    report.rendering = 'json'
  }

  if (adapter !== undefined) report.recommendation = 'api'
  else if (!robots.allowed) report.recommendation = 'blocked'
  else if (report.rendering === 'client') report.recommendation = 'reader'
  else if (report.visibleLength < 120) report.recommendation = 'reader'
  else report.recommendation = 'http'

  if (report.recommendation === 'blocked') {
    notes.push('robots.txt disallows this path for this reader; no automated tier will fetch it.')
  }
  if (report.rendering === 'client') {
    notes.push('The document ships little text before JavaScript runs; the reader tier or a browser is needed.')
  }
  return report
}

/**
 * Render a probe report for the model: answer first, evidence after.
 * @param report - the probe result.
 * @returns Markdown.
 */
export function formatProbe(report) {
  const lines = [
    `# Probe · ${report.url}`,
    '',
    `**Recommended tier:** ${report.recommendation}${report.adapter === undefined ? '' : ` (official API: ${report.adapter.label})`}`,
    '',
  ]
  const facts = []
  if (report.status !== 0) facts.push(`HTTP ${report.status}${report.contentType === '' ? '' : ` · ${report.contentType}`}`)
  if (report.title !== '') facts.push(`title: ${report.title}`)
  if (report.visibleLength > 0) facts.push(`server-rendered text: ${report.visibleLength} chars`)
  facts.push(`robots.txt: ${report.robots.status === 'found' ? (report.robots.allowed ? 'allows this path' : 'disallows this path') : 'absent'}`)
  if (report.robots.rule !== undefined) facts.push(`rule: \`${report.robots.rule}\``)
  if (report.robots.crawlDelay !== undefined) facts.push(`crawl-delay: ${report.robots.crawlDelay}s`)
  if (report.adapter !== undefined) facts.push(`adapter: ${report.adapter.id} → ${report.adapter.operation}`)
  for (const fact of facts) lines.push(`- ${fact}`)
  if (report.signals.length > 0) lines.push('', `**Client rendering signals:** ${report.signals.join(', ')}`)
  if (report.feeds.length > 0) {
    lines.push('', '**Feeds**')
    for (const feed of report.feeds.slice(0, 6)) lines.push(`- ${feed.type || 'feed'}: ${feed.href}`)
  }
  if (report.openSearch !== undefined) lines.push('', `**OpenSearch description:** ${report.openSearch}`)
  if (report.sitemaps.length > 0) {
    lines.push('', '**Sitemaps**')
    for (const sitemap of report.sitemaps) lines.push(`- ${sitemap}`)
  }
  if (report.notes.length > 0) {
    lines.push('', '**Notes**')
    for (const note of report.notes) lines.push(`- ${note}`)
  }
  return lines.join('\n')
}
