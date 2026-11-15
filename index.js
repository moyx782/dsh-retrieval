/**
 * Web retrieval for the model: one tool over a four-tier pipeline that spends
 * the cheapest free tier first and reports which one answered.
 * @module @local/dsh-retrieval
 */

import { createGitHubBudget } from './lib/adapters.js'
import { closeBrowserSession } from './lib/browser.js'
import { formatProbe, probe } from './lib/probe.js'
import { formatRetrieve, formatSearch, retrieve } from './lib/retrieve.js'
import { webSearch } from './lib/search.js'
import { allowsSiteAuth, headerFromValue, refForHost } from './lib/siteauth.js'
import { normalizeUrl } from './lib/url.js'

export const name = 'retrieval'

/** The tool registry is the only service this plugin needs to exist. */
export const inject = ['tools']

/** Credential names the bundle page can authorize; plain references, no records. */
const REFERENCES = { githubToken: 'GITHUB_TOKEN', jinaToken: 'JINA_API_KEY' }

/**
 * Resolve one stored credential, falling back to the environment exactly as the
 * credential store does. A missing credential is normal, not an error.
 * @param ctx - the plugin context.
 * @param reference - a POSIX-style credential name.
 * @returns the secret value, or undefined.
 */
async function readSecret(ctx, reference) {
  const credentials = ctx.get('credentials')
  if (credentials !== undefined) {
    try {
      const hit = await credentials.resolve(reference)
      if (hit !== undefined && typeof hit.value === 'string' && hit.value !== '') return hit.value
    } catch {
      // A store that cannot answer falls through to the environment.
    }
  }
  const ambient = process.env[reference]
  return typeof ambient === 'string' && ambient !== '' ? ambient : undefined
}

/**
 * Resolve the header a logged-in request for this host needs, if the user
 * stored one. Only https (or loopback) is allowed to carry it.
 * @param ctx - plugin context.
 * @param input - the URL as pasted.
 * @returns request headers, empty when none applies.
 */
async function siteAuthFor(ctx, input) {
  const url = normalizeUrl(input)
  if (url === undefined || !allowsSiteAuth(url)) return {}
  const raw = await readSecret(ctx, refForHost(url.hostname))
  return headerFromValue(raw) ?? {}
}

/** @returns the credentials this call may use. */
async function secretsOf(ctx) {
  const [githubToken, jinaToken] = await Promise.all([
    readSecret(ctx, REFERENCES.githubToken),
    readSecret(ctx, REFERENCES.jinaToken),
  ])
  return { githubToken, jinaToken }
}

/** The model-facing parameters. Only the JSON-Schema subset the registry accepts. */
const PARAMETERS = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['fetch', 'probe', 'search'],
      description: "fetch reads one page; probe surveys a site's allowances and rendering before a batch of reads; search finds pages by keyword.",
    },
    url: {
      type: 'string',
      description: 'fetch and probe: the page or host to read, as pasted.',
    },
    query: {
      type: 'string',
      description: 'search: the words to look for. A `site:` operator is understood and is the same as setting site.',
    },
    site: {
      type: 'string',
      description: 'search: scope results to one host, for example github.com or news.ycombinator.com. Use it whenever the question is about one site.',
    },
    layer: {
      type: 'string',
      enum: ['auto', 'api', 'http', 'reader', 'browser'],
      description: 'fetch: force one tier instead of the automatic chain. auto is the default and is almost always right; api fails rather than fall through.',
    },
    maxChars: {
      type: 'integer',
      description: 'fetch: body budget, 2,000 to 60,000. Defaults to 24,000; raise it only when a first read was visibly cut.',
    },
    limit: {
      type: 'integer',
      description: 'search: how many results, 1 to 20. Defaults to 8.',
    },
  },
  required: ['action'],
  additionalProperties: false,
}

/** @returns the clamped integer, or the fallback. */
function clampInteger(value, minimum, maximum, fallback) {
  if (!Number.isFinite(value)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)))
}

/** @returns a readable failure that still tells the model what to try next. */
function failure(error) {
  const message = error instanceof Error ? error.message : String(error)
  return `Web retrieval failed: ${message}`
}

/**
 * Build the tool definition for one plugin instance, closing over the context
 * that resolves credentials and the shared GitHub budget.
 * @param ctx - plugin context.
 * @param githubBudget - the process-wide GitHub allowance.
 * @returns the registered tool definition.
 */
function createTool(ctx, githubBudget) {
  return {
  name: 'web_retrieve',
  description: 'Read or search a web page through a free-first chain: the site\'s own documented API (GitHub, Wikipedia, Hacker News, arXiv, Stack Exchange, npm, PyPI), then a static fetch with article extraction, then the r.jina.ai reader service, then a headless browser when one is installed. action="fetch" returns one page as Markdown and names the tier that produced it; action="probe" reports robots.txt, sitemaps, feeds, client-rendering signals and which API covers the host, which is worth one call before reading many pages from the same site; action="search" returns titles, URLs and snippets, using the site\'s own search API when site names a supported host. The static tier honours robots.txt; a sign-in cookie or Authorization header you store for a host on the plugin page is sent only to that host and only over https, and no tier defeats a paywall, signs in on its own, or invents content when every tier is blocked. A 401 or 403 says which host needs a stored sign-in. Cite the returned URL.',
  parameters: PARAMETERS,
  output: {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: value }],
  },
  timeoutMs: 180_000,
  async execute(args, exec) {
    const input = args !== null && typeof args === 'object' ? args : {}
    const signal = exec?.signal
    const secrets = await secretsOf(ctx)
    try {
      if (input.action === 'probe') {
        if (typeof input.url !== 'string' || input.url.trim() === '') return 'probe needs a url.'
        const report = await probe(input.url, { signal, timeoutMs: 20_000 })
        const siteAuth = await siteAuthFor(ctx, input.url)
        const configured = Object.keys(siteAuth).length > 0
        return `${formatProbe(report)}\n\n**站点凭证：** ${configured ? '已为该域名保存，抓取时会自动附加。' : '未配置。若该站需要登录，可在「网页检索」面板按域名添加 Cookie 或 Authorization。'}`
      }
      if (input.action === 'search') {
        if (typeof input.query !== 'string' || input.query.trim() === '') return 'search needs a query.'
        const outcome = await webSearch(input.query, {
          site: typeof input.site === 'string' ? input.site : undefined,
          limit: clampInteger(input.limit, 1, 20, 8),
          signal,
          timeoutMs: 16_000,
          secrets,
          githubBudget,
        })
        return formatSearch(input.query, outcome)
      }
      if (input.action !== 'fetch') return 'action must be "fetch", "probe" or "search".'
      if (typeof input.url !== 'string' || input.url.trim() === '') return 'fetch needs a url.'
      const result = await retrieve(input.url, {
        layer: typeof input.layer === 'string' ? input.layer : 'auto',
        maxChars: clampInteger(input.maxChars, 2_000, 60_000, 24_000),
        signal,
        timeoutMs: 20_000,
        secrets,
        githubBudget,
        headers: await siteAuthFor(ctx, input.url),
      })
      return formatRetrieve(result)
    } catch (error) {
      return failure(error)
    }
  },
  }
}

/**
 * Register the retrieval tool for this plugin instance.
 * @param ctx - plugin context with the tool registry.
 */
export function apply(ctx) {
  const tool = createTool(ctx, createGitHubBudget(60))
  ctx.effect(() => ctx.tools.register(tool), 'retrieval: web_retrieve tool')
  // The browser tier holds a Chromium; release it with the plugin so the
  // profile is flushed and no orphan process is left behind.
  ctx.effect(() => () => { void closeBrowserSession() }, 'retrieval: browser session')
}
