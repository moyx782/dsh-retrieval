import assert from 'node:assert/strict'
import test from 'node:test'
import { retrieve } from '../lib/retrieve.js'

/** Replace global fetch with a routing stub; returns the calls it saw. */
function stubFetch(routes) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url
    calls.push(url)
    for (const [pattern, handler] of routes) {
      if (pattern.test(url)) return handler(url, init)
    }
    return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } })
  }
  return { calls, restore: () => { globalThis.fetch = original } }
}

const html = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } })
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

const ARTICLE = `<!doctype html><html><head><title>Long form</title></head><body>
<article><h1>Long form</h1>${'<p>This paragraph exists to carry enough prose that the static tier is trusted without any renderer. </p>'.repeat(8)}</article>
</body></html>`

const SHELL = `<!doctype html><html><head><title>Shell</title></head><body>
<div id="root"></div><script src="/app.js"></script></body></html>`

test('a server-rendered page answers from the static tier and never calls a renderer', async () => {
  const stub = stubFetch([
    [/robots\.txt$/, () => new Response('User-agent: *\nDisallow:\n', { headers: { 'content-type': 'text/plain' } })],
    [/^https:\/\/plain\.example\//, () => html(ARTICLE)],
  ])
  try {
    const result = await retrieve('https://plain.example/post', { cache: false })
    assert.equal(result.layer, 'http')
    assert.match(result.text, /Long form/)
    assert.equal(stub.calls.some(url => url.includes('r.jina.ai')), false)
  } finally {
    stub.restore()
  }
})

test('a client-rendered shell escalates to the reader tier', async () => {
  const readerBody = `Title: Shell\nURL Source: https://shell.example/\n\nMarkdown Content:\n# Shell\n\n${'Rendered prose from the reader service. '.repeat(20)}`
  const stub = stubFetch([
    [/robots\.txt$/, () => new Response('', { status: 404 })],
    [/^https:\/\/r\.jina\.ai\//, () => new Response(readerBody, { headers: { 'content-type': 'text/plain' } })],
    [/^https:\/\/shell\.example\//, () => html(SHELL)],
  ])
  try {
    const result = await retrieve('https://shell.example/', { cache: false })
    assert.equal(result.layer, 'reader')
    assert.match(result.text, /Rendered prose/)
    assert.ok(result.notes.some(note => note.includes('r.jina.ai')))
  } finally {
    stub.restore()
  }
})

test('a documented API is used before the page, and the page is never fetched', async () => {
  const stub = stubFetch([
    [/robots\.txt$/, () => new Response('', { status: 404 })],
    [/api\.github\.com\/repos\/o\/r\/readme$/, () => json({ content: Buffer.from('# Title\n\nREADME body that is long enough to count as a document.').toString('base64'), encoding: 'base64' })],
    [/api\.github\.com\/repos\/o\/r$/, () => json({
      full_name: 'o/r', description: 'A project used to prove that the API tier answers first and the page tier is skipped.',
      stargazers_count: 10, forks_count: 2, open_issues_count: 1, language: 'JavaScript', license: { spdx_id: 'MIT' },
      default_branch: 'main', updated_at: '2026-01-01T00:00:00Z', topics: ['x'], html_url: 'https://github.com/o/r',
    })],
  ])
  try {
    const result = await retrieve('https://github.com/o/r', { cache: false })
    assert.equal(result.layer, 'api')
    assert.match(result.text, /o\/r/)
    assert.equal(stub.calls.some(url => url === 'https://github.com/o/r'), false)
  } finally {
    stub.restore()
  }
})

test('robots.txt disallow stops the static tier instead of bypassing it', async () => {
  const stub = stubFetch([
    [/robots\.txt$/, () => new Response('User-agent: *\nDisallow: /\n', { headers: { 'content-type': 'text/plain' } })],
    [/^https:\/\/blocked\.example\//, () => html(ARTICLE)],
  ])
  try {
    await assert.rejects(() => retrieve('https://blocked.example/x', { cache: false, layer: 'http' }), /robots/)
  } finally {
    stub.restore()
  }
})

test('a JSON endpoint is returned as formatted JSON', async () => {
  const stub = stubFetch([
    [/robots\.txt$/, () => new Response('', { status: 404 })],
    [/^https:\/\/api\.example\/data/, () => json({ hello: 'world' })],
  ])
  try {
    const result = await retrieve('https://api.example/data', { cache: false })
    assert.equal(result.layer, 'http-json')
    assert.match(result.text, /"hello": "world"/)
  } finally {
    stub.restore()
  }
})

test('maxChars truncates and says so', async () => {
  const stub = stubFetch([
    [/robots\.txt$/, () => new Response('', { status: 404 })],
    [/^https:\/\/plain\.example\//, () => html(ARTICLE)],
  ])
  try {
    const result = await retrieve('https://plain.example/post', { cache: false, maxChars: 400 })
    assert.equal(result.truncated, true)
    assert.match(result.text, /truncated at 400/)
  } finally {
    stub.restore()
  }
})
