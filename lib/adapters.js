/**
 * The first tier: the site's own documented, free interface. Every adapter
 * answers the same question — "given this page URL, what does the readable
 * document look like" — and none of them needs a paid key. GitHub accepts an
 * optional personal token through the bundle's credential page, which raises
 * the unauthenticated ceiling; everything else works anonymously.
 * @module @local/dsh-retrieval/lib/adapters
 */

import { httpJson, httpRequest, tryRequest } from './http.js'
import { fragmentText, tidyMarkdown } from './html.js'

/** GitHub's unauthenticated allowance, and the reserve kept for other calls. */
const GITHUB_HOURLY = 60
const GITHUB_RESERVE = 5

/** @returns a shared limiter for one GitHub budget. */
function createBudget(limit) {
  return { limit, used: 0, windowStart: Date.now(), remaining: undefined }
}

/** @param budget - the limiter to charge. @returns nothing; throws when spent. */
function chargeGitHub(budget) {
  const now = Date.now()
  if (now - budget.windowStart > 3_600_000) {
    budget.windowStart = now
    budget.used = 0
    budget.remaining = undefined
  }
  if (budget.used + 1 > budget.limit - GITHUB_RESERVE) {
    throw new Error(
      `GitHub's anonymous budget for this hour is spent (${budget.limit}/h). Authorize a token on the Web retrieval plugin page to raise it to 5,000/h, then retry.`,
    )
  }
  budget.used += 1
}

/** @returns the GitHub headers for this call, with a token when one is stored. */
function githubHeaders(context) {
  const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' }
  const token = context.secrets?.githubToken
  if (typeof token === 'string' && token !== '') headers.authorization = `Bearer ${token}`
  return headers
}

/** @returns the Markdown body of a README response. */
function decodeReadme(payload) {
  if (payload === null || typeof payload !== 'object' || typeof payload.content !== 'string') return ''
  if (payload.encoding === 'base64') return Buffer.from(payload.content, 'base64').toString('utf8')
  return payload.content
}

/** @returns a compact one-paragraph summary of a GitHub repository. */
async function fetchRepo(params, context) {
  const budget = context.githubBudget
  chargeGitHub(budget)
  const repo = await httpJson(`https://api.github.com/repos/${params.owner}/${params.repo}`, {
    signal: context.signal, headers: githubHeaders(context), timeoutMs: context.timeoutMs,
  }).catch((error) => { throw new Error(error.message) })
  const readme = await tryRequest(`https://api.github.com/repos/${params.owner}/${params.repo}/readme`, {
    signal: context.signal, headers: githubHeaders(context), timeoutMs: context.timeoutMs, maxBytes: 400_000,
  })
  let body = ''
  if (readme !== undefined && readme.ok) {
    try {
      body = decodeReadme(JSON.parse(readme.body))
    } catch {
      body = ''
    }
  }
  const data = repo.json
  const lines = [
    `# ${data.full_name}`,
    '',
    data.description ?? '_No description._',
    '',
    `- Stars: ${data.stargazers_count} · Forks: ${data.forks_count} · Open issues: ${data.open_issues_count}`,
    `- Language: ${data.language ?? 'unknown'} · License: ${data.license?.spdx_id ?? 'none declared'}`,
    `- Default branch: ${data.default_branch} · Updated: ${data.updated_at}`,
    `- Topics: ${(data.topics ?? []).join(', ') || 'none'}`,
  ]
  if (body !== '') lines.push('', '## README', '', tidyMarkdown(body).slice(0, 24_000))
  return {
    title: data.full_name,
    text: lines.join('\n'),
    url: data.html_url,
    notes: [body === '' ? 'README was not available through the API; only repository metadata is included.' : undefined]
      .filter(Boolean),
  }
}

/** @returns an issue or pull request with its newest discussion. */
async function fetchIssue(params, context) {
  chargeGitHub(context.githubBudget)
  const kind = params.kind === 'pull' ? 'pulls' : 'issues'
  const base = `https://api.github.com/repos/${params.owner}/${params.repo}/${kind}/${params.number}`
  const item = await httpJson(base, {
    signal: context.signal, headers: githubHeaders(context), timeoutMs: context.timeoutMs,
  })
  const comments = await tryRequest(`${base}/comments?per_page=20`, {
    signal: context.signal, headers: githubHeaders(context), timeoutMs: context.timeoutMs, maxBytes: 500_000,
  })
  let thread = []
  if (comments !== undefined && comments.ok) {
    try {
      thread = (JSON.parse(comments.body) ?? []).map(comment => ({
        author: comment.user?.login ?? 'unknown',
        body: String(comment.body ?? '').trim(),
      }))
    } catch {
      thread = []
    }
  }
  const data = item.json
  const lines = [
    `# ${data.title} (#${data.number})`,
    '',
    `- State: ${data.state}${data.merged === true ? ' (merged)' : ''} · Author: ${data.user?.login ?? 'unknown'} · Created: ${data.created_at}`,
    `- Labels: ${(data.labels ?? []).map(label => label.name).join(', ') || 'none'}`,
    '',
    '## Body',
    '',
    String(data.body ?? '_Empty body._').slice(0, 12_000),
  ]
  if (thread.length > 0) {
    lines.push('', `## Comments (${thread.length} of ${data.comments ?? thread.length})`)
    for (const comment of thread) lines.push('', `**${comment.author}**`, '', comment.body.slice(0, 3_000))
  }
  return { title: data.title, text: lines.join('\n'), url: data.html_url }
}

/** @returns a repository file through the raw CDN. */
async function fetchFile(params, context) {
  const raw = `https://raw.githubusercontent.com/${params.owner}/${params.repo}/${params.ref}/${params.path}`
  const response = await httpRequest(raw, {
    signal: context.signal, timeoutMs: context.timeoutMs, maxBytes: 1_500_000,
    headers: githubHeaders(context),
  })
  if (!response.ok) throw new Error(`raw.githubusercontent.com answered HTTP ${response.status} for ${raw}`)
  return {
    title: `${params.owner}/${params.repo}/${params.path}`,
    text: `# ${params.path}\n\n\`\`\`\n${response.body}\n\`\`\``,
    url: `https://github.com/${params.owner}/${params.repo}/blob/${params.ref}/${params.path}`,
  }
}

/** @returns a directory listing through the contents API. */
async function fetchTree(params, context) {
  chargeGitHub(context.githubBudget)
  const suffix = params.path === '' ? '' : `/${params.path}`
  const target = `https://api.github.com/repos/${params.owner}/${params.repo}/contents${suffix}?ref=${encodeURIComponent(params.ref)}`
  const listing = await httpJson(target, {
    signal: context.signal, headers: githubHeaders(context), timeoutMs: context.timeoutMs,
  })
  const entries = Array.isArray(listing.json) ? listing.json : []
  const lines = [`# ${params.owner}/${params.repo}/${params.path || ''} @ ${params.ref}`, '']
  for (const entry of entries.slice(0, 500)) lines.push(`- ${entry.type === 'dir' ? 'dir ' : 'file'} \`${entry.name}\``)
  return { title: `${params.repo}/${params.path}`, text: lines.join('\n'), url: listing.response.url }
}

/** @returns a repository's releases. */
async function fetchReleases(params, context) {
  chargeGitHub(context.githubBudget)
  const target = `https://api.github.com/repos/${params.owner}/${params.repo}/releases?per_page=10`
  const listing = await httpJson(target, {
    signal: context.signal, headers: githubHeaders(context), timeoutMs: context.timeoutMs,
  })
  const releases = Array.isArray(listing.json) ? listing.json : []
  const lines = [`# ${params.owner}/${params.repo} releases`, '']
  for (const release of releases) {
    lines.push(`## ${release.tag_name} — ${release.name ?? ''}`.trim(), '', release.published_at ?? '', '',
      String(release.body ?? '').slice(0, 2_000), '')
  }
  if (releases.length === 0) lines.push('_No releases._')
  return { title: `${params.repo} releases`, text: lines.join('\n'), url: `https://github.com/${params.owner}/${params.repo}/releases` }
}

/** @returns the extracted Wikipedia article plaintext. */
async function fetchWikipedia(params, context) {
  const query = new URLSearchParams({
    action: 'query', format: 'json', prop: 'extracts', explaintext: '1', redirects: '1', titles: params.title,
  })
  const { json } = await httpJson(`https://${params.lang}.wikipedia.org/w/api.php?${query}`, {
    signal: context.signal, timeoutMs: context.timeoutMs,
  })
  const pages = Object.values(json.query?.pages ?? {})
  const page = pages[0]
  if (page === undefined || page.missing !== undefined || !page.extract) {
    throw new Error(`Wikipedia has no article named "${params.title}" on ${params.lang}.wikipedia.org`)
  }
  return {
    title: page.title,
    text: `# ${page.title}\n\n${page.extract}\n\n_Source: ${params.lang}.wikipedia.org, CC BY-SA 4.0._`,
    url: `https://${params.lang}.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
  }
}

/** @returns one Hacker News item with its top replies. */
async function fetchHackerNews(params, context) {
  const item = await httpJson(`https://hacker-news.firebaseio.com/v0/item/${params.id}.json`, {
    signal: context.signal, timeoutMs: context.timeoutMs,
  })
  const story = item.json
  if (story === null || typeof story !== 'object') throw new Error(`Hacker News has no item ${params.id}`)
  const lines = [
    `# ${story.title ?? '(comment)'}`,
    '',
    `- By ${story.by ?? 'unknown'} · ${new Date((story.time ?? 0) * 1000).toISOString()} · ${story.score ?? 0} points · ${story.descendants ?? 0} comments`,
    story.url === undefined ? '' : `- Link: ${story.url}`,
    '',
    fragmentText(story.text ?? ''),
  ]
  const kids = Array.isArray(story.kids) ? story.kids.slice(0, 12) : []
  for (const kid of kids) {
    const reply = await tryRequest(`https://hacker-news.firebaseio.com/v0/item/${kid}.json`, {
      signal: context.signal, timeoutMs: Math.min(context.timeoutMs, 8_000), maxBytes: 200_000,
    })
    if (reply === undefined || !reply.ok) continue
    try {
      const comment = JSON.parse(reply.body)
      const text = fragmentText(comment.text ?? '')
      if (text !== '') lines.push('', `> **${comment.by ?? 'unknown'}**: ${text.slice(0, 1_200)}`)
    } catch {
      // One unreadable reply is not worth failing the item.
    }
  }
  return {
    title: story.title ?? `HN item ${params.id}`,
    text: lines.join('\n'),
    url: `https://news.ycombinator.com/item?id=${params.id}`,
  }
}

/** @returns one arXiv paper's metadata and abstract. */
async function fetchArxiv(params, context) {
  const query = new URLSearchParams({ id_list: params.id, max_results: '1' })
  const response = await httpRequest(`https://export.arxiv.org/api/query?${query}`, {
    signal: context.signal, timeoutMs: context.timeoutMs,
    headers: { accept: 'application/atom+xml' },
  })
  if (!response.ok) throw new Error(`arXiv answered HTTP ${response.status}`)
  const entry = /<entry>([\s\S]*?)<\/entry>/.exec(response.body)?.[1] ?? ''
  if (entry === '') throw new Error(`arXiv has no entry ${params.id}`)
  const title = /<title>([\s\S]*?)<\/title>/.exec(entry)?.[1]?.replace(/\s+/g, ' ').trim() ?? params.id
  const summary = /<summary>([\s\S]*?)<\/summary>/.exec(entry)?.[1]?.replace(/\s+/g, ' ').trim() ?? ''
  const authors = [...entry.matchAll(/<name>([\s\S]*?)<\/name>/g)].map(match => match[1].trim())
  const published = /<published>([\s\S]*?)<\/published>/.exec(entry)?.[1] ?? ''
  return {
    title,
    text: [`# ${title}`, '', `- Authors: ${authors.join(', ') || 'unknown'}`, `- Published: ${published}`,
      `- arXiv: ${params.id}`, '', '## Abstract', '', summary].join('\n'),
    url: `https://arxiv.org/abs/${params.id}`,
  }
}

/** @returns a Stack Exchange question with its highest-voted answers. */
async function fetchStackExchange(params, context) {
  const query = new URLSearchParams({ site: params.site, filter: 'withbody' })
  const question = await httpJson(`https://api.stackexchange.com/2.3/questions/${params.id}?${query}`, {
    signal: context.signal, timeoutMs: context.timeoutMs,
  })
  const item = (question.json.items ?? [])[0]
  if (item === undefined) throw new Error(`Stack Exchange has no question ${params.id} on ${params.site}`)
  const answers = await httpJson(
    `https://api.stackexchange.com/2.3/questions/${params.id}/answers?${query}&sort=votes&order=desc&pagesize=5`,
    { signal: context.signal, timeoutMs: context.timeoutMs },
  )
  const lines = [
    `# ${fragmentText(item.title)}`,
    '',
    `- Score: ${item.score} · Answers: ${item.answer_count} · Asked: ${new Date(item.creation_date * 1000).toISOString()}`,
    '',
    fragmentText(item.body),
  ]
  for (const answer of answers.json.items ?? []) {
    lines.push('', `## Answer (score ${answer.score}${answer.is_accepted ? ', accepted' : ''})`, '',
      fragmentText(answer.body ?? '').slice(0, 4_000))
  }
  return { title: fragmentText(item.title), text: lines.join('\n'), url: item.link }
}

/** @returns an npm package's registry metadata and README. */
async function fetchNpm(params, context) {
  const name = encodeURIComponent(params.name)
  // The full packument can reach tens of megabytes, so read the small version
  // document and fetch the README from the free CDN the ecosystem uses.
  const latest = await httpJson(`https://registry.npmjs.org/${name}/latest`, {
    signal: context.signal, timeoutMs: context.timeoutMs, maxBytes: 1_000_000,
  })
  const version = latest.json
  const versionNumber = version.version
  const readme = await tryRequest(`https://unpkg.com/${name}@${encodeURIComponent(versionNumber)}/README.md`, {
    signal: context.signal, timeoutMs: Math.min(context.timeoutMs, 12_000), maxBytes: 400_000,
  })
  const lines = [
    `# ${version.name}@${versionNumber}`,
    '',
    String(version.description ?? ''),
    '',
    `- License: ${version.license ?? 'unknown'} · Repository: ${version.repository?.url ?? version.repository ?? 'unknown'}`,
    `- Homepage: ${version.homepage ?? 'unknown'} · Node: ${version.engines?.node ?? 'unspecified'}`,
    `- Dependencies: ${Object.keys(version.dependencies ?? {}).length} · Keywords: ${(version.keywords ?? []).slice(0, 8).join(', ') || 'none'}`,
  ]
  if (readme !== undefined && readme.ok && readme.body.trim() !== '') {
    lines.push('', '## README', '', tidyMarkdown(readme.body).slice(0, 20_000))
  }
  return { title: `${version.name}@${versionNumber}`, text: lines.join('\n'), url: `https://www.npmjs.com/package/${version.name}` }
}

/** @returns a PyPI project's metadata and description. */
async function fetchPypi(params, context) {
  const { json } = await httpJson(`https://pypi.org/pypi/${encodeURIComponent(params.name)}/json`, {
    signal: context.signal, timeoutMs: context.timeoutMs, maxBytes: 3_000_000,
  })
  const info = json.info ?? {}
  const lines = [
    `# ${info.name} ${info.version}`,
    '',
    String(info.summary ?? ''),
    '',
    `- License: ${info.license ?? 'unknown'} · Home: ${info.home_page ?? info.project_url ?? 'unknown'}`,
    `- Requires Python: ${info.requires_python ?? 'unspecified'}`,
  ]
  if (typeof info.description === 'string' && info.description.trim() !== '') {
    lines.push('', '## Description', '', tidyMarkdown(info.description).slice(0, 20_000))
  }
  return { title: `${info.name} ${info.version}`, text: lines.join('\n'), url: `https://pypi.org/project/${info.name}/` }
}

/**
 * Split a GitHub URL into the operation it names.
 * @param path - URL pathname.
 * @returns the matched parameters, or undefined.
 */
function matchGitHub(path) {
  const parts = path.split('/').filter(part => part !== '')
  if (parts.length < 2) return undefined
  const [owner, repo, ...rest] = parts
  if (['orgs', 'topics', 'collections', 'sponsors', 'settings', 'marketplace', 'features', 'login'].includes(owner)) {
    return undefined
  }
  if (rest.length === 0) return { kind: 'repo', owner, repo }
  if (rest[0] === 'issues' && /^\d+$/.test(rest[1] ?? '')) return { kind: 'issue', owner, repo, number: Number(rest[1]) }
  if (rest[0] === 'pull' && /^\d+$/.test(rest[1] ?? '')) return { kind: 'pull', owner, repo, number: Number(rest[1]) }
  if (rest[0] === 'releases') return { kind: 'releases', owner, repo }
  if (rest[0] === 'blob' && rest.length >= 3) {
    return { kind: 'file', owner, repo, ref: rest[1], path: rest.slice(2).join('/') }
  }
  if (rest[0] === 'tree' && rest.length >= 2) {
    return { kind: 'tree', owner, repo, ref: rest[1], path: rest.slice(2).join('/') }
  }
  return { kind: 'repo', owner, repo }
}

/** The adapter table, tried in order; the first match wins. */
export const ADAPTERS = [
  {
    id: 'github',
    label: 'GitHub REST',
    hosts: ['github.com', 'raw.githubusercontent.com', 'gist.github.com'],
    match(url) {
      if (url.hostname === 'raw.githubusercontent.com') {
        const parts = url.pathname.split('/').filter(part => part !== '')
        if (parts.length >= 3) return { kind: 'file', owner: parts[0], repo: parts[1], ref: parts[2], path: parts.slice(3).join('/') }
        return undefined
      }
      if (url.hostname === 'gist.github.com') {
        const parts = url.pathname.split('/').filter(part => part !== '')
        if (parts.length >= 2) return { kind: 'gist', owner: parts[0], repo: 'gist' }
      }
      if (url.hostname !== 'github.com') return undefined
      return matchGitHub(url.pathname)
    },
    async fetch(params, context) {
      switch (params.kind) {
        case 'issue':
        case 'pull': return fetchIssue(params, context)
        case 'file': return fetchFile(params, context)
        case 'tree': return fetchTree(params, context)
        case 'releases': return fetchReleases(params, context)
        case 'gist': throw new Error('Gists are not covered yet; the page tier reads them instead.')
        default: return fetchRepo(params, context)
      }
    },
    async search(query, context) {
      chargeGitHub(context.githubBudget)
      const query1 = new URLSearchParams({ q: query, per_page: String(context.limit ?? 8) })
      const { json } = await httpJson(`https://api.github.com/search/repositories?${query1}`, {
        signal: context.signal, headers: githubHeaders(context), timeoutMs: context.timeoutMs,
      })
      return (json.items ?? []).map(item => ({
        title: `${item.full_name} ★${item.stargazers_count}`,
        url: item.html_url,
        snippet: item.description ?? '',
        engine: 'github',
      }))
    },
  },
  {
    id: 'wikipedia',
    label: 'Wikipedia API',
    hosts: ['wikipedia.org', 'wiktionary.org'],
    match(url) {
      if (!/\.wikipedia\.org$/.test(url.hostname)) return undefined
      const lang = url.hostname.split('.')[0]
      if (url.pathname.startsWith('/wiki/')) {
        const title = decodeURIComponent(url.pathname.slice('/wiki/'.length)).replace(/_/g, ' ')
        return title === '' ? undefined : { lang, title }
      }
      const title = url.searchParams.get('title')
      if (title !== null && title !== '') return { lang, title }
      return undefined
    },
    async fetch(params, context) { return fetchWikipedia(params, context) },
    async search(query, context) {
      const search = new URLSearchParams({ action: 'opensearch', format: 'json', search: query, limit: String(context.limit ?? 8) })
      const { json } = await httpJson(`https://en.wikipedia.org/w/api.php?${search}`, {
        signal: context.signal, timeoutMs: context.timeoutMs,
      })
      const titles = json[1] ?? []
      const urls = json[3] ?? []
      return titles.map((title, index) => ({
        title, url: urls[index] ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
        snippet: 'Wikipedia article', engine: 'wikipedia',
      }))
    },
  },
  {
    id: 'hacker-news',
    label: 'Hacker News API',
    hosts: ['news.ycombinator.com'],
    match(url) {
      if (url.hostname !== 'news.ycombinator.com') return undefined
      if (url.pathname !== '/item') return undefined
      const id = url.searchParams.get('id')
      return id !== null && /^\d+$/.test(id) ? { id } : undefined
    },
    async fetch(params, context) { return fetchHackerNews(params, context) },
    async search(query, context) {
      const search = new URLSearchParams({ query, tags: 'story', hitsPerPage: String(context.limit ?? 8) })
      const { json } = await httpJson(`https://hn.algolia.com/api/v1/search?${search}`, {
        signal: context.signal, timeoutMs: context.timeoutMs,
      })
      return (json.hits ?? []).map(hit => ({
        title: hit.title ?? hit.story_title ?? '(untitled)',
        url: hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`,
        snippet: `${hit.points ?? 0} points · ${hit.num_comments ?? 0} comments`,
        engine: 'hn-algolia',
      }))
    },
  },
  {
    id: 'arxiv',
    label: 'arXiv API',
    hosts: ['arxiv.org', 'export.arxiv.org'],
    match(url) {
      if (!/(^|\.)arxiv\.org$/.test(url.hostname)) return undefined
      const match = /\/(?:abs|pdf)\/([^/?#]+?)(?:v\d+)?(?:\.pdf)?$/.exec(url.pathname)
      return match === null ? undefined : { id: match[1] }
    },
    async fetch(params, context) { return fetchArxiv(params, context) },
    async search(query, context) {
      const search = new URLSearchParams({ search_query: `all:${query}`, max_results: String(context.limit ?? 8) })
      const response = await httpRequest(`https://export.arxiv.org/api/query?${search}`, {
        signal: context.signal, timeoutMs: context.timeoutMs, headers: { accept: 'application/atom+xml' },
      })
      return [...response.body.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((match) => {
        const title = /<title>([\s\S]*?)<\/title>/.exec(match[1])?.[1]?.replace(/\s+/g, ' ').trim() ?? ''
        const id = /<id>([\s\S]*?)<\/id>/.exec(match[1])?.[1]?.trim() ?? ''
        const summary = /<summary>([\s\S]*?)<\/summary>/.exec(match[1])?.[1]?.replace(/\s+/g, ' ').trim() ?? ''
        return { title, url: id, snippet: summary.slice(0, 240), engine: 'arxiv' }
      })
    },
  },
  {
    id: 'stack-exchange',
    label: 'Stack Exchange API',
    hosts: ['stackoverflow.com', 'superuser.com', 'serverfault.com', 'askubuntu.com', 'math.stackexchange.com'],
    match(url) {
      const question = /\/(?:questions|q)\/(\d+)/.exec(url.pathname)
      if (question === null) return undefined
      const site = url.hostname === 'stackoverflow.com' ? 'stackoverflow' : url.hostname.replace(/\.stackexchange\.com$/, '')
      return { id: question[1], site }
    },
    async fetch(params, context) { return fetchStackExchange(params, context) },
  },
  {
    id: 'npm',
    label: 'npm registry',
    hosts: ['npmjs.com', 'www.npmjs.com'],
    match(url) {
      const match = /^\/package\/(@[^/]+\/[^/]+|[^/]+)/.exec(url.pathname)
      return match === null ? undefined : { name: decodeURIComponent(match[1]) }
    },
    async fetch(params, context) { return fetchNpm(params, context) },
  },
  {
    id: 'pypi',
    label: 'PyPI JSON API',
    hosts: ['pypi.org', 'www.pypi.org'],
    match(url) {
      const match = /^\/project\/([^/]+)/.exec(url.pathname)
      return match === null ? undefined : { name: decodeURIComponent(match[1]) }
    },
    async fetch(params, context) { return fetchPypi(params, context) },
  },
]

/**
 * Find the adapter that owns one URL.
 * @param url - a parsed URL.
 * @returns the adapter and its parameters, or undefined.
 */
export function adapterFor(url) {
  for (const adapter of ADAPTERS) {
    if (!adapter.hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) continue
    const params = adapter.match(url)
    if (params !== undefined) return { adapter, params }
  }
  return undefined
}

/** @returns every adapter that offers search. */
export function searchAdapters() {
  return ADAPTERS.filter(adapter => typeof adapter.search === 'function')
}

export { createBudget as createGitHubBudget }
