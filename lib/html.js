/**
 * A small, dependency-free HTML reader: build a tolerant tree, drop the chrome,
 * pick the densest remaining container, and render it as Markdown. It is not a
 * browser and does not try to be one — it is the cheap tier that saves a
 * network round trip to a renderer.
 * @module @local/dsh-retrieval/lib/html
 */

/** Elements whose text content is never article text. */
const NEVER_TEXT = new Set([
  'script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe', 'object', 'embed', 'math',
  'head', 'title', 'meta', 'link', 'base', 'input', 'select', 'textarea', 'button', 'label',
])

/** Elements dropped from the candidate tree before scoring. */
const CHROME = new Set(['nav', 'footer', 'aside', 'form', 'dialog', 'menu', 'search'])

/** Void elements: no closing tag, never pushed on the stack. */
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr'])

/** Block-level names used for implicit paragraph and list-item closing. */
const BLOCKISH = new Set(['address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'fieldset',
  'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'main',
  'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul'])

/** Headings map to Markdown levels in document order. */
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

const TAG_RE = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^"'>])*)>/g
const ATTR_RE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g

/** Common named entities; a full table is not worth the bytes here. */
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', hellip: '…', mdash: '—',
  ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»',
  copy: '©', reg: '®', trade: '™', times: '×', divide: '÷', middot: '·', bull: '•',
  deg: '°', euro: '€', pound: '£', yen: '¥', sect: '§', para: '¶', plusmn: '±',
  frac12: '½', frac14: '¼', frac34: '¾', sup2: '²', sup3: '³', micro: 'µ', shy: '\u00ad',
  ensp: '\u2002', emsp: '\u2003', thinsp: '\u2009', zwj: '\u200d', zwnj: '\u200c',
}

/**
 * Decode the entities an HTML text node or attribute may carry, including
 * numeric character references.
 * @param text - raw source text.
 * @returns the decoded text.
 */
export function decodeEntities(text) {
  if (typeof text !== 'string' || !text.includes('&')) return text
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);?/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole
      try {
        return String.fromCodePoint(code)
      } catch {
        return whole
      }
    }
    const named = NAMED_ENTITIES[body]
    return named === undefined ? whole : named
  })
}

/** @returns the attribute map for one raw attribute string. */
function parseAttributes(raw) {
  const attrs = {}
  if (raw === '') return attrs
  ATTR_RE.lastIndex = 0
  let match
  while ((match = ATTR_RE.exec(raw)) !== null) {
    const name = match[1].toLowerCase()
    const value = match[2] ?? match[3] ?? match[4] ?? ''
    if (name !== '') attrs[name] = value
  }
  return attrs
}

/** @returns a node with no children. */
function node(tag, attrs, parent) {
  return { tag, attrs, children: [], parent }
}

/**
 * Build a tolerant element tree. Unmatched close tags are ignored, and an
 * unmatched open tag is simply left open until its parent closes.
 * @param html - document source.
 * @returns the root node.
 */
export function parseHtml(html) {
  const root = node('#root', {}, null)
  const stack = [root]
  const top = () => stack[stack.length - 1]
  let lastIndex = 0

  const pushText = (text) => {
    if (text === '') return
    const current = top()
    const previous = current.children[current.children.length - 1]
    if (previous !== undefined && previous.tag === '#text') previous.text += text
    else current.children.push({ tag: '#text', attrs: {}, text, children: [], parent: current })
  }

  const closeTo = (name) => {
    for (let index = stack.length - 1; index > 0; index -= 1) {
      if (stack[index].tag === name) {
        stack.length = index
        return
      }
    }
  }

  TAG_RE.lastIndex = 0
  let match
  while ((match = TAG_RE.exec(html)) !== null) {
    const [whole, closing, rawName] = match
    if (closing === undefined) {
      // Comment, CDATA, doctype or processing instruction: not content.
      lastIndex = TAG_RE.lastIndex
      continue
    }
    pushText(html.slice(lastIndex, match.index))
    lastIndex = TAG_RE.lastIndex

    const name = rawName.toLowerCase()
    if (closing === '/') {
      closeTo(name)
      continue
    }
    if (VOID.has(name)) {
      top().children.push(node(name, parseAttributes(match[3]), top()))
      continue
    }
    // Two elements that cannot nest in practice: close the earlier one.
    if (name === 'p' && top().tag === 'p') stack.pop()
    if (name === 'li') {
      let index = stack.length - 1
      while (index > 0 && stack[index].tag !== 'ul' && stack[index].tag !== 'ol') {
        if (stack[index].tag === 'li') {
          stack.length = index
          break
        }
        index -= 1
      }
    }
    if (BLOCKISH.has(name)) {
      let index = stack.length - 1
      while (index > 0 && stack[index].tag === 'p') {
        stack.length = index
        index -= 1
      }
    }
    const created = node(name, parseAttributes(match[3]), top())
    top().children.push(created)
    stack.push(created)
  }
  pushText(html.slice(lastIndex))
  return root
}

/** @returns every descendant with one of the requested tags. */
export function findAll(rootNode, tags) {
  const wanted = new Set(Array.isArray(tags) ? tags : [tags])
  const found = []
  const walk = (current) => {
    for (const child of current.children) {
      if (wanted.has(child.tag)) found.push(child)
      walk(child)
    }
  }
  walk(rootNode)
  return found
}

/** @returns the first descendant with the tag and matching attribute, if any. */
export function findFirst(rootNode, tag, predicate = () => true) {
  for (const child of rootNode.children) {
    if (child.tag === tag && predicate(child)) return child
    const nested = findFirst(child, tag, predicate)
    if (nested !== undefined) return nested
  }
  return undefined
}

/** @returns the concatenated text of a subtree, skipping text-less elements. */
export function textContent(currentNode) {
  if (currentNode.tag === '#text') return currentNode.text
  if (NEVER_TEXT.has(currentNode.tag)) return ''
  let text = ''
  for (const child of currentNode.children) text += textContent(child)
  return text
}

/** @returns the subtree with chrome elements removed, as a new tree. */
function stripChrome(currentNode) {
  const children = []
  for (const child of currentNode.children) {
    if (child.tag === '#text') {
      children.push(child)
      continue
    }
    if (CHROME.has(child.tag)) continue
    if (child.tag === 'header') {
      const text = textContent(child).trim()
      if (text.length < 80) continue
    }
    children.push({ ...child, children: stripChrome(child).children })
  }
  return { ...currentNode, children }
}

/** @returns the number of characters inside direct `<p>`, `<li>` and `<pre>` children. */
function paragraphWeight(currentNode) {
  let weight = 0
  for (const child of currentNode.children) {
    if (child.tag === 'p' || child.tag === 'pre' || child.tag === 'blockquote') weight += textContent(child).trim().length
    else if (child.tag === 'li') weight += textContent(child).trim().length
    else weight += paragraphWeight(child) * 0.5
  }
  return weight
}

/** @returns the characters inside anchors, used to detect link farms. */
function linkTextLength(currentNode) {
  let length = 0
  for (const child of currentNode.children) {
    if (child.tag === 'a') length += textContent(child).length
    else length += linkTextLength(child)
  }
  return length
}

/**
 * Score one container: prose that is not links, plus a bonus for paragraphs and
 * headings, so a nav block with short linked lines loses to an article body.
 */
function scoreContainer(currentNode) {
  const text = textContent(currentNode).trim()
  if (text.length < 40) return 0
  const linked = linkTextLength(currentNode)
  const density = linked / Math.max(1, text.length)
  if (density > 0.6) return 0
  const paragraphs = findAll(currentNode, 'p').length
  const headings = findAll(currentNode, ['h1', 'h2', 'h3']).length
  return text.length * (1 - density) + paragraphs * 30 + headings * 10 + paragraphWeight(currentNode)
}

/**
 * Pick the content root: an explicit `<article>`, then `<main>`, then the
 * best-scoring container, then the body.
 * @param stripped - the chrome-free tree.
 * @returns the chosen node.
 */
export function pickContentRoot(stripped) {
  const body = findFirst(stripped, 'body') ?? stripped
  const candidates = []
  const walk = (currentNode, depth) => {
    if (currentNode.tag === 'article' || currentNode.tag === 'main'
      || currentNode.attrs.role === 'main' || currentNode.attrs.itemprop === 'articleBody'
      || currentNode.tag === 'div' || currentNode.tag === 'section' || currentNode.tag === 'td') {
      const score = scoreContainer(currentNode)
      if (score > 0) candidates.push({ node: currentNode, score, depth })
    }
    for (const child of currentNode.children) walk(child, depth + 1)
  }
  walk(body, 0)
  const articles = candidates.filter(candidate => candidate.node.tag === 'article')
  if (articles.length > 0) {
    return articles.sort((a, b) => b.score - a.score)[0].node
  }
  const mains = candidates.filter(candidate => candidate.node.tag === 'main')
  if (mains.length > 0 && scoreContainer(mains[0].node) > 200) {
    return mains.sort((a, b) => b.score - a.score)[0].node
  }
  if (candidates.length === 0) return body
  const best = candidates.sort((a, b) => (b.score - a.score) || (b.depth - a.depth))[0]
  return best.score < 200 ? body : best.node
}

/** @returns true when an inline element should keep its markers. */
const INLINE_WRAP = new Set(['strong', 'b', 'em', 'i', 'code', 'del', 's', 'mark', 'kbd', 'sup', 'sub'])

/** Wrap inline Markdown according to the element. */
function wrapInline(tag, inner) {
  if (inner.trim() === '') return inner
  switch (tag) {
    case 'strong':
    case 'b':
      return `**${inner}**`
    case 'em':
    case 'i':
      return `*${inner}*`
    case 'code':
      return `\`${inner}\``
    case 'del':
    case 's':
      return `~~${inner}~~`
    case 'kbd':
      return `\`${inner}\``
    default:
      return inner
  }
}

/** Resolve a possibly relative URL, returning the original on failure. */
function absoluteUrl(href, base) {
  if (href === '' || href.startsWith('#') || href.startsWith('javascript:')) return ''
  try {
    return new URL(href, base).toString()
  } catch {
    return ''
  }
}

/**
 * Render one subtree as Markdown.
 * @param currentNode - the subtree.
 * @param base - the document URL, for resolving relative links and images.
 * @param depth - list nesting depth.
 * @returns Markdown text.
 */
function renderNode(currentNode, base, depth = 0) {
  if (currentNode.tag === '#text') return decodeEntities(currentNode.text).replace(/[ \t\r\n]+/g, ' ')
  if (NEVER_TEXT.has(currentNode.tag)) return ''
  const children = (extraDepth = depth) => currentNode.children.map(child => renderNode(child, base, extraDepth)).join('')

  if (HEADINGS.has(currentNode.tag)) {
    const level = Number(currentNode.tag[1])
    const text = textContent(currentNode).replace(/\s+/g, ' ').trim()
    return text === '' ? '' : `\n\n${'#'.repeat(level)} ${text}\n\n`
  }
  switch (currentNode.tag) {
    case 'p':
      return `\n\n${children().trim()}\n\n`
    case 'br':
      return '\n'
    case 'hr':
      return '\n\n---\n\n'
    case 'pre': {
      const code = textContent(currentNode).replace(/\n+$/, '')
      const language = /language-([\w+#-]+)/.exec(
        (findAll(currentNode, 'code')[0]?.attrs.class ?? currentNode.attrs.class ?? ''),
      )?.[1] ?? ''
      return `\n\n\`\`\`${language}\n${code}\n\`\`\`\n\n`
    }
    case 'blockquote': {
      const inner = children().trim()
      if (inner === '') return ''
      return `\n\n${inner.split('\n').map(line => `> ${line}`).join('\n')}\n\n`
    }
    case 'ul':
    case 'ol': {
      const items = currentNode.children.filter(child => child.tag === 'li')
      if (items.length === 0) return `\n\n${children().trim()}\n\n`
      const ordered = currentNode.tag === 'ol'
      const rendered = items.map((item, index) => {
        const text = renderNode(item, base, depth + 1).trim().replace(/\n{3,}/g, '\n\n')
        const marker = ordered ? `${index + 1}.` : '-'
        const indent = '  '.repeat(depth)
        return `${indent}${marker} ${text.replace(/\n/g, `\n${indent}  `)}`
      })
      return `\n\n${rendered.join('\n')}\n\n`
    }
    case 'li':
      return children().trim()
    case 'a': {
      const text = children().trim()
      const href = absoluteUrl(currentNode.attrs.href ?? '', base)
      if (text === '' || href === '') return text
      return `[${text}](${href})`
    }
    case 'img': {
      const alt = (currentNode.attrs.alt ?? '').trim()
      const src = absoluteUrl(currentNode.attrs.src ?? currentNode.attrs['data-src'] ?? '', base)
      if (src === '') return ''
      return `![${alt}](${src})`
    }
    case 'table': {
      const rows = findAll(currentNode, 'tr').map(row =>
        row.children.filter(cell => cell.tag === 'td' || cell.tag === 'th')
          .map(cell => textContent(cell).replace(/\s+/g, ' ').trim()))
      const kept = rows.filter(row => row.length > 0)
      if (kept.length === 0) return ''
      return `\n\n${kept.map(row => `| ${row.join(' | ')} |`).join('\n')}\n\n`
    }
    case 'td':
    case 'th':
    case 'tr':
    case 'thead':
    case 'tbody':
      return children()
    default: {
      if (INLINE_WRAP.has(currentNode.tag)) return wrapInline(currentNode.tag, children())
      if (BLOCKISH.has(currentNode.tag)) {
        const inner = children().trim()
        return inner === '' ? '' : `\n\n${inner}\n\n`
      }
      return children()
    }
  }
}

/** Collapse the Markdown's blank runs and trailing spaces. */
export function tidyMarkdown(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** @returns the JSON-LD records declared by the document, when parseable. */
function jsonLd(html) {
  const records = []
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let match
  while ((match = re.exec(html)) !== null && records.length < 8) {
    try {
      const parsed = JSON.parse(match[1].trim())
      if (Array.isArray(parsed)) records.push(...parsed)
      else records.push(parsed)
    } catch {
      // A malformed block is common; the rest of the document still reads.
    }
  }
  return records
}

/**
 * Read one document: metadata, Markdown body, links, and the signals a caller
 * uses to decide whether a renderer is worth its cost.
 * @param html - the document source.
 * @param url - the document URL, for resolving relative references.
 * @returns the reading result.
 */
export function readHtml(html, url) {
  const parsed = parseHtml(html)
  const titleTag = findFirst(parsed, 'title')
  const meta = {}
  for (const element of findAll(parsed, 'meta')) {
    const key = element.attrs.property ?? element.attrs.name
    const value = element.attrs.content
    if (key !== undefined && value !== undefined && meta[key.toLowerCase()] === undefined) {
      meta[key.toLowerCase()] = value
    }
  }
  const canonical = findAll(parsed, 'link')
    .find(element => (element.attrs.rel ?? '').toLowerCase() === 'canonical')?.attrs.href
  const ld = jsonLd(html)
  const ldArticle = ld.find(record => record !== null && typeof record === 'object'
    && typeof record.headline === 'string') ?? {}

  const stripped = stripChrome(parsed)
  const root = pickContentRoot(stripped)
  const markdown = tidyMarkdown(renderNode(root, url))

  const links = []
  for (const anchor of findAll(root, 'a')) {
    const href = absoluteUrl(anchor.attrs.href ?? '', url)
    if (href === '') continue
    const text = textContent(anchor).replace(/\s+/g, ' ').trim()
    links.push({ url: href, text })
    if (links.length >= 400) break
  }

  const bodyText = textContent(findFirst(parsed, 'body') ?? parsed)
  const visibleLength = bodyText.replace(/\s+/g, ' ').trim().length
  const rawTitle = titleTag === undefined ? '' : textContent(titleTag).replace(/\s+/g, ' ').trim()
  const ldHeadline = typeof ldArticle.headline === 'string' ? ldArticle.headline : ''
  return {
    title: decodeEntities(meta['og:title'] ?? (rawTitle !== '' ? rawTitle : ldHeadline)),
    description: decodeEntities(meta.description ?? meta['og:description'] ?? ldArticle.description ?? ''),
    site: meta['og:site_name'] ?? '',
    author: meta.author ?? meta['article:author'] ?? ldArticle.author?.name ?? '',
    published: meta['article:published_time'] ?? meta['og:updated_time'] ?? ldArticle.datePublished ?? '',
    canonical: canonical === undefined ? url : absoluteUrl(canonical, url) || url,
    markdown,
    links,
    visibleLength,
    hasJsonLd: ld.length > 0,
  }
}

/** @returns the plain text of a fragment, for tags inside API payloads. */
export function fragmentText(html) {
  return decodeEntities(textContent(parseHtml(html ?? ''))).replace(/\s+/g, ' ').trim()
}
