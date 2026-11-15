/**
 * The browser tier: render a page with a real Chromium and hand back its HTML.
 *
 * This tier exists to execute JavaScript, not to hold a sign-in. Signed-in
 * browsing belongs to the Playwright MCP server (`dsh-browser-mcp`), which owns
 * a persistent profile and exposes navigation tools; this tier launches an
 * isolated browser, or attaches to one the user points at with
 * RETRIEVAL_CDP_URL. It stays alive for the life of the process so repeated
 * reads skip the cold start.
 * @module @local/dsh-retrieval/lib/browser
 */

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { homedir } from 'node:os'

/** An already-running Chromium to attach to, when the user points at one. */
const CDP_URL = process.env.RETRIEVAL_CDP_URL ?? ''

/** Open a visible window, for debugging a render by hand. */
const HEADED = process.env.RETRIEVAL_BROWSER_HEADED === '1'


const require = createRequire(import.meta.url)

/**
 * Node's global module roots, derived from the running binary rather than from
 * a hardcoded layout, plus the usual system-wide ones.
 * @returns directories that may contain a globally installed package.
 */
function globalRoots() {
  const roots = new Set()
  const exec = process.execPath
  if (typeof exec === 'string' && exec !== '') {
    roots.add(join(dirname(dirname(exec)), 'lib', 'node_modules'))
    roots.add(join(dirname(dirname(exec)), 'node_modules'))
  }
  if (typeof process.env.npm_config_prefix === 'string' && process.env.npm_config_prefix !== '') {
    roots.add(join(process.env.npm_config_prefix, 'lib', 'node_modules'))
  }
  for (const entry of (process.env.NODE_PATH ?? '').split(':')) {
    if (entry !== '') roots.add(entry)
  }
  roots.add('/usr/local/lib/node_modules')
  roots.add('/usr/lib/node_modules')
  roots.add(join(homedir(), '.npm-global', 'lib', 'node_modules'))
  return [...roots]
}

/** @returns an installed Playwright module, or undefined. */
async function loadPlaywright() {
  for (const specifier of ['playwright', 'playwright-core']) {
    try {
      return await import(specifier)
    } catch {
      // Fall through to the global roots below.
    }
  }
  for (const root of globalRoots()) {
    for (const name of ['playwright', 'playwright-core']) {
      try {
        const resolved = require.resolve(name, { paths: [root] })
        return await import(pathToFileURL(resolved).href)
      } catch {
        // Try the next root or package name.
      }
    }
  }
  return undefined
}

const LAUNCH_OPTIONS = {
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
}

const CONTEXT_OPTIONS = {
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  locale: 'zh-CN',
  viewport: { width: 1366, height: 900 },
  javaScriptEnabled: true,
}

/** The live browser session, shared by every call in this process. */
let shared

/** How long an unused session keeps the profile locked. */
const IDLE_CLOSE_MS = 90_000
let idleTimer

/** One render at a time: a shared browser is navigated sequentially. */
let queue = Promise.resolve()

/**
 * Open (or reuse) the session the browser tier renders in.
 * @param playwright - the loaded module.
 * @returns a context and how it is owned.
 */
async function sessionFor(playwright) {
  if (shared !== undefined && shared.alive()) return shared
  const chromium = playwright.chromium ?? playwright.default?.chromium
  if (chromium === undefined) throw new Error('The installed Playwright build exposes no chromium launcher.')

  // An explicitly configured Chromium may be attached to; otherwise this tier
  // runs its own browser. Authenticated browsing is the job of the Playwright
  // MCP server, which owns its own profile.
  const endpoint = CDP_URL
  if (endpoint !== '') {
    const browser = await chromium.connectOverCDP(endpoint)
    const context = browser.contexts()[0] ?? await browser.newContext(CONTEXT_OPTIONS)
    shared = {
      kind: 'cdp',
      context,
      alive: () => browser.isConnected(),
      close: async () => { await browser.close().catch(() => {}) },
    }
    return shared
  }

  const browser = await chromium.launch({ ...LAUNCH_OPTIONS, headless: !HEADED })
  const context = await browser.newContext(CONTEXT_OPTIONS)
  shared = {
    kind: 'ephemeral',
    context,
    alive: () => browser.isConnected(),
    close: async () => { await browser.close().catch(() => {}) },
  }
  return shared
}

/**
 * Close the shared session, flushing the profile to disk. The plugin calls this
 * when it unloads; a script calls it before exiting so cookies survive.
 * @returns nothing.
 */
export async function closeBrowserSession() {
  if (idleTimer !== undefined) {
    clearTimeout(idleTimer)
    idleTimer = undefined
  }
  if (shared === undefined) return
  const current = shared
  shared = undefined
  await current.close()
}

/**
 * Drop the browser after a quiet spell, so an unused Chromium process does not
 * sit on memory for the whole session.
 * @returns nothing.
 */
function scheduleIdleClose() {
  if (idleTimer !== undefined) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => { void closeBrowserSession() }, IDLE_CLOSE_MS)
  idleTimer.unref?.()
}

/**
 * Render one page in the session.
 * @param url - absolute URL.
 * @param options - signal, deadline, headers for this host.
 * @returns HTML, title, and whether a browser was available at all.
 */
export async function renderWithBrowser(url, options = {}) {
  const { signal, timeoutMs = 30_000, headers = {} } = options
  const playwright = await loadPlaywright()
  if (playwright === undefined) {
    return {
      installed: false,
      message: 'No Playwright module is installed, so the browser tier is unavailable. '
        + 'Install it with `npm i -g playwright && npx playwright install chromium`, or set CHROMIUM_PATH to an existing Chromium build.',
    }
  }

  const run = async () => {
    const session = await sessionFor(playwright)
    // The stored per-site header applies to this navigation only.
    await session.context.setExtraHTTPHeaders(headers).catch(() => {})
    const page = await session.context.newPage()
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
      await page.waitForLoadState('networkidle', { timeout: Math.min(8_000, timeoutMs) }).catch(() => {})
      await page.waitForTimeout(600)
      const html = await page.content()
      const title = await page.title()
      scheduleIdleClose()
      return { installed: true, html, title, reused: session.kind }
    } finally {
      await page.close().catch(() => {})
    }
  }

  const attempt = queue.then(run, run)
  queue = attempt.catch(() => {})
  try {
    return await attempt
  } catch (error) {
    return {
      installed: false,
      message: `Playwright is installed but no browser could start: ${error instanceof Error ? error.message : String(error)}. `
        + `Run \`npx playwright install chromium\`, set CHROMIUM_PATH, or start a Chromium with --remote-debugging-port and set RETRIEVAL_CDP_URL.`,
    }
  }
}
