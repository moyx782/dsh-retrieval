/**
 * Search without a paid key: a site's own search API when it has one, then the
 * HTML endpoints that still answer a plain GET. Every backend is tried in a
 * fixed order and each failure is reported rather than hidden, because "no
 * results" and "blocked" are different answers.
 * @module @local/dsh-retrieval/lib/search
 */

import { searchAdapters } from './adapters.js'
import { BROWSERISH_HEADERS, httpRequest } from './http.js'
import { fragmentText } from './html.js'

/** Unwrap DuckDuckGo's redirect links. */
function unwrapDuckDuckGo(href) {
  try {
    const url = new URL(href, 'https://duckduckgo.com')
    const target = url.searchParams.get('uddg')
    return target === null ? url.toString() : decodeURIComponent(target)
  } catch {
    return href
  }
}

/** @returns parsed results from the DuckDuckGo HTML endpoint. */
function parseDuckDuckGo(html) {
  const links = [...html.matchAll(/<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
  const snippets = [...html.matchAll(/<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g)]
  return links.map((match, index) => ({
    url: unwrapDuckDuckGo(match[1]),
    title: fragmentText(match[2]),
    snippet: fragmentText(snippets[index]?.[1] ?? ''),
  }))
}

/** @returns parsed results from the DuckDuckGo Lite endpoint. */
function parseDuckDuckGoLite(html) {
  const links = [...html.matchAll(/<a[^>]+class=['"]result-link['"][^>]*href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/g)]
  const snippets = [...html.matchAll(/<td[^>]+class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/g)]
  return links.map((match, index) => ({
    url: unwrapDuckDuckGo(match[1]),
    title: fragmentText(match[2]),
    snippet: fragmentText(snippets[index]?.[1] ?? ''),
  }))
}

/** @returns best-effort results from Marginalia, which renders plain anchors. */
function parseMarginalia(html) {
  const links = [...html.matchAll(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
  const seen = new Set()
  const results = []
  for (const match of links) {
    const url = match[1]
    const title = fragmentText(match[2])
    if (title.length < 15) continue
    if (url.includes('marginalia-search.com')) continue
    if (seen.has(url)) continue
    seen.add(url)
    results.push({ url, title, snippet: '' })
    if (results.length >= 12) break
  }
  return results
}

/** @returns parsed results from a SearXNG instance. */
function parseSearx(html) {
  const articles = [...html.matchAll(/<article[^>]+class="[^"]*result[^"]*"[\s\S]*?<\/article>/g)]
  const results = []
  for (const article of articles) {
    const href = /<a[^>]+href="(https?:\/\/[^"]+)"/.exec(article[0])?.[1]
    if (href === undefined) continue
    const title = /<h3[^>]*>([\s\S]*?)<\/h3>/.exec(article[0])?.[1] ?? ''
    const snippet = /<p[^>]+class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/p>/.exec(article[0])?.[1] ?? ''
    results.push({ url: href, title: fragmentText(title), snippet: fragmentText(snippet) })
  }
  return results
}

/** The HTML backends, in the order they are tried. */
const HTML_ENGINES = [
  {
    id: 'duckduckgo',
    url: query => `https://html.duckduckgo.com/html/?${new URLSearchParams({ q: query })}`,
    headers: { ...BROWSERISH_HEADERS, referer: 'https://html.duckduckgo.com/' },
    parse: parseDuckDuckGo,
  },
  {
    id: 'duckduckgo-lite',
    url: query => `https://lite.duckduckgo.com/lite/?${new URLSearchParams({ q: query })}`,
    headers: { ...BROWSERISH_HEADERS, referer: 'https://lite.duckduckgo.com/' },
    parse: parseDuckDuckGoLite,
  },
  {
    id: 'marginalia',
    url: query => `https://marginalia-search.com/search?${new URLSearchParams({ query })}`,
    headers: BROWSERISH_HEADERS,
    parse: parseMarginalia,
  },
  {
    id: 'searx-be',
    url: query => `https://searx.be/search?${new URLSearchParams({ q: query })}`,
    headers: BROWSERISH_HEADERS,
    parse: parseSearx,
  },
  {
    id: 'searx-inetol',
    url: query => `https://search.inetol.net/search?${new URLSearchParams({ q: query })}`,
    headers: BROWSERISH_HEADERS,
    parse: parseSearx,
  },
]

/**
 * Search one site through its own documented endpoint when it has one.
 * @param query - the search terms.
 * @param host - the host the caller scoped to.
 * @returns results and the engine name, or undefined when no adapter covers it.
 */
async function officialSearch(query, host, context) {
  const adapters = searchAdapters()
  for (const adapter of adapters) {
    const owns = adapter.hosts.some(candidate => host === candidate || host.endsWith(`.${candidate}`))
    if (!owns) continue
    const results = await adapter.search(query, { ...context, limit: context.limit })
    return { engine: adapter.id, results: results.map(result => ({ ...result, engine: adapter.id })) }
  }
  return undefined
}

/**
 * Run a search across the free backends.
 * @param query - the search terms; a `site:` operator is understood.
 * @param options - site scope, limit, deadline, signal, credentials.
 * @returns results, the engine that answered, and what was skipped.
 */
export async function webSearch(query, options = {}) {
  const { limit = 8, signal, timeoutMs = 14_000 } = options
  const notes = []
  let text = String(query ?? '').trim()
  let site = options.site
  const siteOperator = /\bsite:(\S+)/i.exec(text)
  if (siteOperator !== null) {
    site = siteOperator[1]
    text = text.replace(siteOperator[0], '').trim()
  }
  if (text === '') throw new Error('A search needs some words besides the site filter.')

  if (site !== undefined && site !== '') {
    const host = site.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    try {
      const official = await officialSearch(text, host, {
        signal, timeoutMs, limit, secrets: options.secrets ?? {}, githubBudget: options.githubBudget,
      })
      if (official !== undefined && official.results.length > 0) {
        return { engine: official.engine, results: official.results.slice(0, limit), notes }
      }
      if (official !== undefined) notes.push(`${official.engine} answered with no results.`)
    } catch (error) {
      notes.push(`${host}'s own search failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const scoped = site === undefined || site === '' ? text : `${text} site:${site}`
  for (const engine of HTML_ENGINES) {
    try {
      const response = await httpRequest(engine.url(scoped), {
        signal, timeoutMs, maxBytes: 500_000, headers: engine.headers,
      })
      if (!response.ok) {
        notes.push(`${engine.id} answered HTTP ${response.status}`)
        continue
      }
      const results = engine.parse(response.body)
      if (results.length === 0) {
        notes.push(`${engine.id} returned no parseable results`)
        continue
      }
      const seen = new Set()
      const unique = []
      for (const result of results) {
        if (seen.has(result.url)) continue
        seen.add(result.url)
        unique.push({ ...result, engine: engine.id })
        if (unique.length >= limit) break
      }
      return { engine: engine.id, results: unique, notes }
    } catch (error) {
      notes.push(`${engine.id} could not be reached: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { engine: undefined, results: [], notes }
}
