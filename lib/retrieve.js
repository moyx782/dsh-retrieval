/**
 * The pipeline: try the documented API, then a static read, then a reader
 * service, then a browser. Each tier returns as soon as its answer is good
 * enough, so a supported site never pays for a renderer, and every hop that was
 * skipped or used is recorded as a note.
 * @module @local/dsh-retrieval/lib/retrieve
 */

import { adapterFor, createGitHubBudget } from './adapters.js'
import { BROWSERISH_HEADERS, tryRequest } from './http.js'
import { readHtml, tidyMarkdown } from './html.js'
import { evaluateRobots, parseRobots } from './robots.js'
import { clientRenderingSignals } from './probe.js'
import { normalizeUrl } from './url.js'
import { readWithService } from './reader.js'
import { renderWithBrowser } from './browser.js'

/** An API answer below this is a stub, not a document. */
const MIN_API = 180

/** A static read below this is treated as a failed read. */
const MIN_STATIC = 400

/** A static read this small is only accepted when nothing suggests client rendering. */
const MIN_STATIC_NO_SIGNALS = 120

const CACHE_TTL = 10 * 60_000
const CACHE_LIMIT = 40

/** Robots verdicts are reused for ten minutes; they change rarely. */
const robotsCache = new Map()
const documentCache = new Map()

/** @returns the parsed robots file for an origin, cached. */
async function robotsFor(origin, context) {
  const cached = robotsCache.get(origin)
  if (cached !== undefined && Date.now() - cached.at < CACHE_TTL) return cached.parsed
  const response = await tryRequest(`${origin}/robots.txt`, {
    signal: context.signal,
    timeoutMs: Math.min(context.timeoutMs, 8_000),
    maxBytes: 256_000,
    headers: { accept: 'text/plain' },
  })
  const parsed = response !== undefined && response.ok ? parseRobots(response.body) : parseRobots('')
  robotsCache.set(origin, { parsed, at: Date.now() })
  return parsed
}

/** @returns a pretty JSON rendering. */
function formatJson(body) {
  try {
    return JSON.stringify(JSON.parse(body), null, 2)
  } catch {
    return body
  }
}

/** @returns the longest non-empty candidate, used only when ranks tie. */
function longest(candidates) {
  let best
  for (const candidate of candidates) {
    if (candidate === undefined || candidate.text.trim() === '') continue
    if (best === undefined || candidate.text.length > best.text.length) best = candidate
  }
  return best
}

/**
 * Read one URL through the tier chain.
 * @param input - URL or host.
 * @param options - layer, cap, signal, deadline, credentials.
 * @returns the document and its provenance.
 */
export async function retrieve(input, options = {}) {
  const {
    layer = 'auto', maxChars = 24_000, signal, timeoutMs = 20_000, secrets = {},
    githubBudget = createGitHubBudget(60), cache = true, headers = {},
  } = options
  const url = normalizeUrl(input)
  if (url === undefined) throw new Error(`"${input}" is not an http(s) address`)

  const started = Date.now()
  const notes = []
  const attempts = []
  const context = { signal, timeoutMs, secrets, githubBudget }
  const hasSiteAuth = Object.keys(headers).length > 0
  // A credentialed read is never served from the cache and never fills it: the
  // answer depends on a secret the cache key cannot see, so a stale miss would
  // outlive the very credential that fixed it.
  const cacheEnabled = cache && !hasSiteAuth
  const cacheKey = `${url.toString()}|${layer}|${maxChars}`
  if (cacheEnabled) {
    const hit = documentCache.get(cacheKey)
    if (hit !== undefined && Date.now() - hit.at < CACHE_TTL) return { ...hit.value, cached: true }
  }

  const matched = adapterFor(url)
  const robots = await robotsFor(url.origin, context)
  const verdict = evaluateRobots(robots, `${url.pathname}${url.search}`)
  const done = (attempt, tier) => finish(attempt, tier, started, notes, cacheKey, cacheEnabled, maxChars)
  if (hasSiteAuth) notes.push(`已附加为 ${url.hostname} 保存的登录凭证。`)

  // A documented API is a published contract and outranks robots.txt, which is
  // exactly the case arXiv presents: its robots file disallows everything while
  // its API is offered to the public.
  if (matched !== undefined && (layer === 'auto' || layer === 'api')) {
    try {
      const apiResult = await matched.adapter.fetch(matched.params, context)
      for (const note of apiResult.notes ?? []) notes.push(note)
      if (layer === 'api' || apiResult.text.trim().length >= MIN_API) {
        return done(
          { text: apiResult.text, title: apiResult.title, url: apiResult.url ?? url.toString() },
          'api',
        )
      }
      notes.push(`${matched.adapter.label} answered with ${apiResult.text.trim().length} characters; the page tiers will be tried.`)
      attempts.push({ text: apiResult.text, title: apiResult.title, url: apiResult.url ?? url.toString(), tier: 'api' })
    } catch (error) {
      notes.push(`The ${matched.adapter.label} tier failed: ${error instanceof Error ? error.message : String(error)}`)
      if (layer === 'api') throw error
    }
  }

  if (layer === 'auto' || layer === 'http') {
    if (!verdict.allowed) {
      notes.push(`robots.txt disallows ${url.pathname} for this reader (${verdict.rule}); no automated tier will fetch it.`)
      if (layer === 'http') throw new Error(notes.join(' '))
    } else {
      const response = await tryRequest(url.toString(), {
        signal, timeoutMs, maxBytes: 2_000_000, headers: { ...BROWSERISH_HEADERS, ...headers },
      })
      if (response === undefined) {
        notes.push('The static tier could not complete a request.')
      } else if (!response.ok) {
        notes.push(`The page answered HTTP ${response.status}.`)
        if (response.status === 401 || response.status === 403) {
          notes.push(`这个站可能需要登录：在「网页检索」面板为 ${url.hostname} 添加 Cookie 或 Authorization 头后重试。`)
        }
      } else if (/json/.test(response.contentType)) {
        return done({ text: formatJson(response.body), title: lastSegment(url), url: response.url }, 'http-json')
      } else if (/html|xml/.test(response.contentType) || response.body.trimStart().startsWith('<')) {
        const read = readHtml(response.body, response.url)
        const signals = clientRenderingSignals(response.body, read.visibleLength)
        const enough = read.markdown.length >= MIN_STATIC
          || (read.markdown.length >= MIN_STATIC_NO_SIGNALS && signals.length === 0)
        if (enough) return done({ text: read.markdown, title: read.title, url: response.url }, 'http')
        notes.push(
          `The static read produced ${read.markdown.length} characters`
          + `${signals.length === 0 ? '' : ` with ${signals.join(', ')}`}; escalating.`,
        )
        attempts.push({ text: read.markdown, title: read.title, url: response.url, tier: 'http' })
      } else if (/application\/pdf/.test(response.contentType)) {
        throw new Error('This is a PDF; the pipeline does not parse binary documents. Fetch the file itself instead.')
      } else if (/^text\//.test(response.contentType) || response.contentType === '') {
        return done({ text: response.body, title: lastSegment(url), url: response.url }, 'http-text')
      } else {
        notes.push(`Unsupported content type ${response.contentType}; not parsed.`)
      }
      if (layer === 'http') {
        const only = longest(attempts)
        if (only === undefined) throw new Error(notes.join(' ') || 'The static tier read nothing.')
        return done(only, only.tier ?? 'http')
      }
    }
  }

  if (layer === 'auto' || layer === 'reader' || layer === 'browser') {
    if (layer !== 'browser') {
      try {
        const service = await readWithService(url.toString(), { token: secrets.jinaToken, signal, timeoutMs: 30_000 })
        notes.push('The body came from the r.jina.ai reader service, so this URL was sent to that third party.')
        if (layer === 'reader' || service.text.trim().length >= MIN_API) {
          return done({ text: service.text, title: service.title, url: url.toString() }, 'reader')
        }
        attempts.push({ text: service.text, title: service.title, url: url.toString(), tier: 'reader' })
      } catch (error) {
        notes.push(`The reader service failed: ${error instanceof Error ? error.message : String(error)}`)
        if (layer === 'reader') throw error
      }
    }
    if (layer === 'browser' || layer === 'auto') {
      const rendered = await renderWithBrowser(url.toString(), { signal, timeoutMs: Math.max(timeoutMs, 30_000), headers })
      if (rendered.installed === false) {
        notes.push(rendered.message)
      } else if (rendered.html !== undefined) {
        const read = readHtml(rendered.html, url.toString())
        return done({ text: read.markdown, title: read.title || rendered.title, url: url.toString() }, 'browser')
      }
    }
  }

  const best = longest(attempts)
  if (best === undefined) {
    throw new Error(notes.length > 0 ? notes.join(' ') : 'No tier produced readable content for this URL.')
  }
  return done(best, best.tier ?? 'http')
}

/** @returns the last path segment, or the host, as a fallback title. */
function lastSegment(url) {
  const parts = url.pathname.split('/').filter(part => part !== '')
  return parts.length === 0 ? url.hostname : parts[parts.length - 1]
}

/** Truncate, annotate, and cache one finished result. */
function finish(attempt, tier, started, notes, cacheKey, cache, maxChars) {
  let text = tidyMarkdown(attempt.text ?? '')
  const cap = typeof maxChars === 'number' && maxChars > 0 ? maxChars : 24_000
  let truncated = false
  if (text.length > cap) {
    text = `${text.slice(0, cap)}\n\n_[truncated at ${cap} characters]_`
    truncated = true
  }
  const value = {
    url: attempt.url,
    title: attempt.title ?? '',
    text,
    layer: tier,
    ms: Date.now() - started,
    notes: [...new Set(notes)],
    truncated,
  }
  if (cache) {
    if (documentCache.size >= CACHE_LIMIT) documentCache.delete(documentCache.keys().next().value)
    documentCache.set(cacheKey, { value, at: Date.now() })
  }
  return value
}

/**
 * Render a retrieved document for the model: provenance first, body after.
 * @param result - the retrieve output.
 * @returns Markdown.
 */
export function formatRetrieve(result) {
  const header = [
    `# ${result.title === '' ? result.url : result.title}`,
    `${result.url} · tier: ${result.layer} · ${(result.ms / 1000).toFixed(1)}s · ${result.text.length} chars${result.truncated ? ' (truncated)' : ''}`,
  ]
  if (result.notes.length > 0) header.push('', ...result.notes.map(note => `> ${note}`))
  return `${header.join('\n')}\n\n---\n\n${result.text}`
}

/** @returns a Markdown listing of search results. */
export function formatSearch(query, outcome) {
  const lines = [`# Search · ${query}`]
  if (outcome.engine !== undefined) lines.push(`engine: ${outcome.engine} · ${outcome.results.length} results`)
  if (outcome.notes.length > 0) lines.push('', ...outcome.notes.map(note => `> ${note}`))
  lines.push('')
  outcome.results.forEach((result, index) => {
    lines.push(`${index + 1}. [${result.title || result.url}](${result.url})`)
    if (result.snippet !== undefined && result.snippet !== '') {
      lines.push(`   ${result.snippet.replace(/\s+/g, ' ').slice(0, 300)}`)
    }
  })
  if (outcome.results.length === 0) lines.push('_No results._')
  return lines.join('\n')
}

export { formatJson }
