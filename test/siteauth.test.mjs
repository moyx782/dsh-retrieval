import assert from 'node:assert/strict'
import test from 'node:test'
import { allowsSiteAuth, headerFromValue, refForHost } from '../lib/siteauth.js'

test('the reference name is derived from the host', () => {
  assert.equal(refForHost('example.com'), 'RETRIEVAL_AUTH_EXAMPLE_COM')
  assert.equal(refForHost('API.Example.COM'), 'RETRIEVAL_AUTH_API_EXAMPLE_COM')
  assert.equal(refForHost('127.0.0.1'), 'RETRIEVAL_AUTH_127_0_0_1')
  assert.equal(refForHost('a-b.example'), 'RETRIEVAL_AUTH_A_B_EXAMPLE')
})

test('a named header is used as that header', () => {
  assert.deepEqual(headerFromValue('Cookie: session=abc; theme=dark'), { cookie: 'session=abc; theme=dark' })
  assert.deepEqual(headerFromValue('Authorization: Bearer xyz'), { authorization: 'Bearer xyz' })
  assert.deepEqual(headerFromValue('X-Api-Key: k1'), { 'x-api-key': 'k1' })
})

test('a bare value is treated as a cookie string', () => {
  assert.deepEqual(headerFromValue('session=abc'), { cookie: 'session=abc' })
  assert.deepEqual(headerFromValue('  a=b; c=d  '), { cookie: 'a=b; c=d' })
})

test('an empty value yields no headers', () => {
  assert.equal(headerFromValue(''), undefined)
  assert.equal(headerFromValue('   '), undefined)
  assert.equal(headerFromValue(undefined), undefined)
})

test('https always may carry the header; http only on loopback', () => {
  assert.equal(allowsSiteAuth(new URL('https://example.com/a')), true)
  assert.equal(allowsSiteAuth(new URL('http://example.com/a')), false)
  assert.equal(allowsSiteAuth(new URL('http://127.0.0.1:8898/')), true)
  assert.equal(allowsSiteAuth(new URL('http://localhost:8898/')), true)
  assert.equal(allowsSiteAuth(new URL('ftp://example.com/')), false)
})
