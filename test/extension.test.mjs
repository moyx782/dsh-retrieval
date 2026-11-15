import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import test from 'node:test'
import { formatCookieHeader, hostOf, isTracker, panelUrl } from '../extension/lib/cookies.js'

const COOKIES = [
  { name: 'session_id', value: 'abc123' },
  { name: '_ga', value: 'GA1.2.3' },
  { name: 'csrf', value: 'zzz' },
  { name: 'session_id', value: 'duplicate' },
  { name: '', value: 'nameless' },
]

test('keeps the session cookies and sorts them', () => {
  assert.equal(formatCookieHeader(COOKIES), 'csrf=zzz; session_id=abc123')
})

test('drops measurement cookies by default and keeps them on request', () => {
  assert.equal(formatCookieHeader([{ name: '_ga', value: '1' }, { name: 'a', value: '2' }]), 'a=2')
  assert.equal(formatCookieHeader([{ name: '_ga', value: '1' }, { name: 'a', value: '2' }], { excludeTrackers: false }),
    '_ga=1; a=2')
})

test('a caller may narrow the set further', () => {
  const header = formatCookieHeader(COOKIES, { keepOnly: name => name === 'csrf' })
  assert.equal(header, 'csrf=zzz')
})

test('an empty or malformed list yields an empty header', () => {
  assert.equal(formatCookieHeader([]), '')
  assert.equal(formatCookieHeader(undefined), '')
  assert.equal(formatCookieHeader([{ name: '_ga', value: '1' }]), '')
})

test('tracker names are recognised', () => {
  assert.equal(isTracker('_gid'), true)
  assert.equal(isTracker('__utmz'), true)
  assert.equal(isTracker('session'), false)
  assert.equal(isTracker(''), false)
})

test('hostOf reads a page host and rejects other schemes', () => {
  assert.equal(hostOf('https://example.com/a?b=1'), 'example.com')
  assert.equal(hostOf('http://127.0.0.1:8898/'), '127.0.0.1')
  assert.equal(hostOf('about:blank'), '')
  assert.equal(hostOf('not a url'), '')
})

test('panelUrl normalises a configured origin', () => {
  assert.equal(panelUrl('192.168.1.19:3080'), 'http://192.168.1.19:3080')
  assert.equal(panelUrl('http://192.168.1.19:3080/'), 'http://192.168.1.19:3080')
  assert.equal(panelUrl(' https://dsh.local '), 'https://dsh.local')
})

test('the manifest is a valid MV3 extension that asks for what it uses', () => {
  const path = new URL('../extension/manifest.json', import.meta.url)
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  assert.equal(manifest.manifest_version, 3)
  for (const permission of ['cookies', 'tabs', 'scripting', 'storage']) {
    assert.ok(manifest.permissions.includes(permission), `missing ${permission}`)
  }
  assert.equal(manifest.action.default_popup, 'popup.html')
  assert.ok(Array.isArray(manifest.host_permissions) && manifest.host_permissions.includes('<all_urls>'))
  for (const icon of Object.values(manifest.icons)) {
    assert.ok(existsSync(new URL(`../extension/${icon}`, import.meta.url)), `missing icon ${icon}`)
  }
})
