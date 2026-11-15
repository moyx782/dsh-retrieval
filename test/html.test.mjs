import assert from 'node:assert/strict'
import test from 'node:test'
import { readHtml, findFirst, parseHtml, textContent } from '../lib/html.js'

const PAGE = `<!doctype html><html><head>
<title>Charge curves — Battery notes</title>
<meta property="og:title" content="Charge curves">
<meta name="description" content="How lithium cells take charge.">
<meta name="author" content="Lin Wei">
<link rel="canonical" href="/notes/charge">
</head><body>
<header><nav><a href="/">Home</a> <a href="/notes">Notes</a> <a href="/about">About</a></nav></header>
<main>
<article>
<h1>Charge curves</h1>
<p>A lithium cell does not take charge at one rate. The <strong>first third</strong> is
mostly <a href="https://example.com/cc">constant current</a>, and the rest tapers.</p>
<h2>What changes</h2>
<ul><li>Temperature raises the tail.</li><li>Age lowers the knee.</li></ul>
<pre><code class="language-js">const rate = 0.5 * capacity</code></pre>
<blockquote>Never test an aged cell as if it were new.</blockquote>
<table><tr><th>Cell</th><th>Cycles</th></tr><tr><td>18650</td><td>500</td></tr></table>
</article>
<aside><p>Related: <a href="/a">Cell ageing</a></p></aside>
</main>
<footer><p>© 2026 Battery notes. All rights reserved.</p></footer>
</body></html>`

test('reads title, description, canonical and author from metadata', () => {
  const page = readHtml(PAGE, 'https://battery.example/notes/charge?x=1')
  assert.equal(page.title, 'Charge curves')
  assert.equal(page.description, 'How lithium cells take charge.')
  assert.equal(page.author, 'Lin Wei')
  assert.equal(page.canonical, 'https://battery.example/notes/charge')
})

test('keeps the article and drops the chrome', () => {
  const page = readHtml(PAGE, 'https://battery.example/notes/charge')
  assert.match(page.markdown, /^# Charge curves/m)
  assert.match(page.markdown, /## What changes/)
  assert.match(page.markdown, /- Temperature raises the tail\./)
  assert.match(page.markdown, /\| 18650 \| 500 \|/)
  assert.match(page.markdown, /```js\nconst rate/)
  assert.match(page.markdown, /> Never test an aged cell/)
  assert.match(page.markdown, /\[constant current\]\(https:\/\/example\.com\/cc\)/)
  assert.doesNotMatch(page.markdown, /All rights reserved/)
  assert.doesNotMatch(page.markdown, /About/)
})

test('resolves relative links and keeps absolute ones', () => {
  const page = readHtml('<body><article><p>See <a href="../x">other</a>.</p></article></body>', 'https://a.example/b/c/d')
  assert.match(page.markdown, /\[other\]\(https:\/\/a\.example\/b\/x\)/)
})

test('drops script and style bodies but keeps inline code', () => {
  const page = readHtml(
    '<body><article><p>Run <code>pnpm test</code> first.</p><script>alert(1)</script><style>.a{}</style></article></body>',
    'https://a.example/',
  )
  assert.match(page.markdown, /`pnpm test`/)
  assert.doesNotMatch(page.markdown, /alert/)
  assert.doesNotMatch(page.markdown, /\.a\{\}/)
})

test('falls back to the body when no container scores', () => {
  const page = readHtml('<body><div><p>Just one short line.</p></div></body>', 'https://a.example/')
  assert.match(page.markdown, /Just one short line\./)
})

test('survives unbalanced tags and comments', () => {
  const page = readHtml('<body><!-- hidden --><div><p>one<p>two</div></span><p>three', 'https://a.example/')
  assert.match(page.markdown, /one/)
  assert.match(page.markdown, /two/)
  assert.match(page.markdown, /three/)
  assert.doesNotMatch(page.markdown, /hidden/)
})

test('reports the visible length used to decide on a renderer', () => {
  const page = readHtml('<body><div id="app"></div></body>', 'https://a.example/')
  assert.ok(page.visibleLength < 20)
  const rich = readHtml(PAGE, 'https://battery.example/notes/charge')
  assert.ok(rich.visibleLength > 200)
})

test('parses attributes and text through the tolerant tree', () => {
  const root = parseHtml('<div class="x" data-id=7>hi &amp; bye</div>')
  const div = findFirst(root, 'div')
  assert.equal(div.attrs.class, 'x')
  assert.equal(div.attrs['data-id'], '7')
  assert.equal(textContent(root).trim(), 'hi &amp; bye')
})
