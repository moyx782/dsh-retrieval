import assert from 'node:assert/strict'
import test from 'node:test'
import { parseRobots, evaluateRobots } from '../lib/robots.js'

const SAMPLE = `
# comment
User-agent: *
Disallow: /private/
Allow: /private/public/
Crawl-delay: 2

User-agent: dsh-retrieval
Disallow: /no-bots
Allow: /no-bots/ok

Sitemap: https://example.com/sitemap.xml
Sitemap: https://example.com/sitemap-2.xml
`

test('parses groups, rules and sitemaps', () => {
  const parsed = parseRobots(SAMPLE)
  assert.equal(parsed.groups.length, 2)
  assert.deepEqual(parsed.groups[0].agents, ['*'])
  assert.equal(parsed.groups[0].crawlDelay, 2)
  assert.deepEqual(parsed.sitemaps, ['https://example.com/sitemap.xml', 'https://example.com/sitemap-2.xml'])
})

test('prefers the group that names this reader', () => {
  const parsed = parseRobots(SAMPLE)
  assert.equal(evaluateRobots(parsed, '/no-bots').allowed, false)
  assert.equal(evaluateRobots(parsed, '/no-bots/ok').allowed, true)
  // The wildcard group no longer applies once a specific group exists.
  assert.equal(evaluateRobots(parsed, '/private/secret').allowed, true)
})

test('an empty file allows everything', () => {
  assert.equal(evaluateRobots(parseRobots(''), '/anything').allowed, true)
})

test('the longest rule wins, and an allow beats a disallow of equal length', () => {
  const parsed = parseRobots('User-agent: *\nDisallow: /a\nAllow: /a/b\n')
  assert.equal(evaluateRobots(parsed, '/a/b/c').allowed, true)
  assert.equal(evaluateRobots(parsed, '/a/c').allowed, false)

  const tied = parseRobots('User-agent: *\nDisallow: /x\nAllow: /x\n')
  assert.equal(evaluateRobots(tied, '/x').allowed, true)
})

test('supports wildcards and end anchors', () => {
  const parsed = parseRobots('User-agent: *\nDisallow: /*.pdf$\nDisallow: /search*\n')
  assert.equal(evaluateRobots(parsed, '/docs/a.pdf').allowed, false)
  assert.equal(evaluateRobots(parsed, '/docs/a.pdf?x=1').allowed, true)
  assert.equal(evaluateRobots(parsed, '/search?q=1').allowed, false)
})

test('a disallow of the whole site blocks every path', () => {
  const parsed = parseRobots('User-agent: *\nDisallow: /\n')
  const verdict = evaluateRobots(parsed, '/x')
  assert.equal(verdict.allowed, false)
  assert.match(verdict.rule, /Disallow: \//)
})
