/**
 * robots.txt, read the way a single polite client needs it: which group applies
 * to this reader, whether one path is allowed, and what the group asks about
 * crawling speed.
 * @module @local/dsh-retrieval/lib/robots
 */

/** The product token this reader presents, lower-cased for matching. */
export const ROBOTS_AGENT = 'dsh-retrieval'

/** @returns the longest matching group for one user agent. */
function groupsFor(groups, userAgent) {
  const agent = userAgent.toLowerCase()
  const specific = groups.filter(group => group.agents.some(name => name !== '*' && agent.includes(name)))
  if (specific.length > 0) return specific
  return groups.filter(group => group.agents.includes('*'))
}

/**
 * Parse the file into groups. Consecutive `User-agent` lines share one group,
 * and rules before any user agent are ignored, as the specification says.
 * @param text - robots.txt source.
 * @returns the parsed directives.
 */
export function parseRobots(text) {
  const groups = []
  const sitemaps = []
  let current
  let inRules = false
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (line === '') continue
    const separator = line.indexOf(':')
    if (separator === -1) continue
    const field = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim()
    if (field === 'user-agent') {
      if (current === undefined || inRules) {
        current = { agents: [], rules: [], crawlDelay: undefined }
        groups.push(current)
        inRules = false
      }
      current.agents.push(value.toLowerCase())
      continue
    }
    if (field === 'sitemap') {
      sitemaps.push(value)
      continue
    }
    if (current === undefined) continue
    inRules = true
    if (field === 'disallow' || field === 'allow') {
      if (value !== '') current.rules.push({ allow: field === 'allow', path: value })
      continue
    }
    if (field === 'crawl-delay') {
      const delay = Number(value)
      if (Number.isFinite(delay) && delay >= 0) current.crawlDelay = delay
    }
  }
  return { groups, sitemaps }
}

/** @returns a RegExp for one robots path pattern. */
function patternFor(path) {
  const anchored = path.endsWith('$')
  const body = anchored ? path.slice(0, -1) : path
  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}${anchored ? '$' : ''}`)
}

/**
 * Decide one path. The longest matching rule wins, and an allow beats a
 * disallow of the same length, which is the convention every major crawler
 * follows even though the older specification was ambiguous.
 * @param parsed - the output of {@link parseRobots}.
 * @param path - request path plus query.
 * @param userAgent - the product token.
 * @returns the verdict and the rule that produced it.
 */
export function evaluateRobots(parsed, path, userAgent = ROBOTS_AGENT) {
  const groups = groupsFor(parsed.groups, userAgent)
  if (groups.length === 0) return { allowed: true, rule: undefined, crawlDelay: undefined }
  let best
  for (const group of groups) {
    for (const rule of group.rules) {
      if (!patternFor(rule.path).test(path)) continue
      const length = rule.path.length
      if (best === undefined || length > best.length || (length === best.length && rule.allow)) {
        best = { ...rule, length }
      }
    }
  }
  const crawlDelay = groups.find(group => group.crawlDelay !== undefined)?.crawlDelay
  if (best === undefined) return { allowed: true, rule: undefined, crawlDelay }
  return { allowed: best.allow, rule: `${best.allow ? 'Allow' : 'Disallow'}: ${best.path}`, crawlDelay }
}
