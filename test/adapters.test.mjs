import assert from 'node:assert/strict'
import test from 'node:test'
import { adapterFor } from '../lib/adapters.js'

const match = (href) => {
  const found = adapterFor(new URL(href))
  return found === undefined ? undefined : { id: found.adapter.id, ...found.params }
}

test('github pages map to the operation the URL names', () => {
  assert.deepEqual(match('https://github.com/microsoft/playwright'), { id: 'github', kind: 'repo', owner: 'microsoft', repo: 'playwright' })
  assert.deepEqual(match('https://github.com/o/r/issues/12'), { id: 'github', kind: 'issue', owner: 'o', repo: 'r', number: 12 })
  assert.deepEqual(match('https://github.com/o/r/pull/7'), { id: 'github', kind: 'pull', owner: 'o', repo: 'r', number: 7 })
  assert.deepEqual(match('https://github.com/o/r/blob/main/docs/a.md'), { id: 'github', kind: 'file', owner: 'o', repo: 'r', ref: 'main', path: 'docs/a.md' })
  assert.deepEqual(match('https://github.com/o/r/tree/main/src/lib'), { id: 'github', kind: 'tree', owner: 'o', repo: 'r', ref: 'main', path: 'src/lib' })
  assert.deepEqual(match('https://github.com/o/r/releases'), { id: 'github', kind: 'releases', owner: 'o', repo: 'r' })
})

test('github non-repository pages are left to the page tier', () => {
  assert.equal(match('https://github.com/orgs/acme'), undefined)
  assert.equal(match('https://github.com/topics/cli'), undefined)
  assert.equal(match('https://github.com/explore'), undefined)
})

test('raw githubusercontent resolves to a file read', () => {
  assert.deepEqual(match('https://raw.githubusercontent.com/o/r/main/README.md'),
    { id: 'github', kind: 'file', owner: 'o', repo: 'r', ref: 'main', path: 'README.md' })
})

test('wikipedia reads the article title out of the path', () => {
  assert.deepEqual(match('https://en.wikipedia.org/wiki/Web_scraping'), { id: 'wikipedia', lang: 'en', title: 'Web scraping' })
  assert.deepEqual(match('https://zh.wikipedia.org/wiki/%E7%88%AC%E8%99%AB'),
    { id: 'wikipedia', lang: 'zh', title: '爬虫' })
})

test('hacker news needs the item query', () => {
  assert.deepEqual(match('https://news.ycombinator.com/item?id=1'), { id: 'hacker-news', id: '1' })
  assert.equal(match('https://news.ycombinator.com/news'), undefined)
})

test('arxiv accepts abs and pdf links and drops the version suffix', () => {
  assert.deepEqual(match('https://arxiv.org/abs/1706.03762'), { id: 'arxiv', id: '1706.03762' })
  assert.deepEqual(match('https://arxiv.org/pdf/1706.03762v7'), { id: 'arxiv', id: '1706.03762' })
})

test('stack exchange keeps the site name', () => {
  assert.deepEqual(match('https://stackoverflow.com/questions/11227809/why'),
    { id: 'stack-exchange', id: '11227809', site: 'stackoverflow' })
})

test('package pages map to registries', () => {
  assert.deepEqual(match('https://www.npmjs.com/package/playwright'), { id: 'npm', name: 'playwright' })
  assert.deepEqual(match('https://www.npmjs.com/package/@scope/pkg'), { id: 'npm', name: '@scope/pkg' })
  assert.deepEqual(match('https://pypi.org/project/trafilatura/'), { id: 'pypi', name: 'trafilatura' })
})

test('an ordinary site matches no adapter', () => {
  assert.equal(match('https://example.com/blog/post'), undefined)
})
