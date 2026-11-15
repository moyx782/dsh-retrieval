import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeUrl, displayUrl, linkScore } from '../lib/url.js'

test('adds https to a bare host and keeps the path', () => {
  assert.equal(normalizeUrl('example.com/docs').toString(), 'https://example.com/docs')
  assert.equal(normalizeUrl('  example.com  ').toString(), 'https://example.com/')
})

test('keeps http and drops unsupported schemes', () => {
  assert.equal(normalizeUrl('http://example.com/').protocol, 'http:')
  assert.equal(normalizeUrl('javascript:alert(1)'), undefined)
  assert.equal(normalizeUrl('file:///etc/passwd'), undefined)
  assert.equal(normalizeUrl(''), undefined)
})

test('strips the fragment and campaign parameters, sorts the rest', () => {
  const url = normalizeUrl('https://example.com/a?utm_source=x&b=2&a=1#frag')
  assert.equal(url.hash, '')
  assert.equal(url.search, '?a=1&b=2')
})

test('displayUrl keeps the root slash', () => {
  const url = normalizeUrl('https://example.com')
  assert.equal(displayUrl(url), 'https://example.com/')
})

test('linkScore prefers documents, penalises list pages and anchors', () => {
  const base = 'https://example.com/posts/one'
  assert.ok(linkScore('https://example.com/posts/two', base) > linkScore('https://example.com/tags/x', base))
  assert.equal(linkScore('https://example.com/posts/one#section', base), 0)
  assert.ok(linkScore('https://example.com/doc.md', base) > linkScore('https://example.com/', base))
  assert.ok(linkScore('https://other.example/x', base) > 0)
})
