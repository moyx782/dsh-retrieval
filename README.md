# Web retrieval for DeepSeek Harness

Reads a page the free way first. This repository is two DSH bundles plus a
browser extension that share one idea: spend the cheapest free tier, and only
reach for a browser when the page actually needs one.

## What's here

| Path | What it is |
|---|---|
| `.` (this directory) | the `dsh-retrieval` bundle: the `web_retrieve` model tool, the four-tier pipeline, and the `网页检索` sidebar panel |
| `extension/` | Manifest V3 browser extension that hands the active tab's cookies to that panel |
| `browser-mcp/` | `dsh-browser-mcp` bundle: runs Microsoft's [Playwright MCP](https://github.com/microsoft/playwright-mcp) server so the model can drive a real Chromium |
| `store/` | Chrome/Edge/Firefox listing copy, promo art and the packaging script |

## Install

```bash
# in a DSH profile: install each bundle by its directory
plugin_manager install_bundle  ./            # dsh-retrieval
plugin_manager install_bundle  ./browser-mcp # dsh-browser-mcp (optional, for browser control)

# browser extension: load `extension/` unpacked, or zip it
node store/build.mjs
```

Both bundles are local-only: no publishing or signing is involved. See
[extension/PACKAGING.md](extension/PACKAGING.md) if you do want to ship the
extension through a store.

## Tiers

| Tier | Source | Cost | Honours robots.txt |
|---|---|---|---|
| `api` | the site's own documented endpoint | free | the API's own terms outrank the file |
| `http` | a plain GET plus article extraction | free | yes |
| `reader` | `r.jina.ai` | free at ~20 requests a minute | the URL leaves the machine |
| `browser` | Playwright, when installed | local CPU | yes |

A tier answers and the pipeline stops; a low yield escalates to the next. Every
result names the tier that produced it, so a reply can say where the text came
from.

## Official APIs, without a paid key

GitHub (repositories, issues, pull requests, files, directory listings,
releases), Wikipedia, Hacker News, arXiv, Stack Exchange, npm, PyPI. Each is the
site's published contract, so these reads survive markup changes and never pay
for a renderer.

## Search

A site's own search endpoint first when `site` names a supported host, then
DuckDuckGo's HTML endpoint, its lite endpoint, Marginalia and two SearXNG
instances. Each backend that fails is named in the result instead of being
silently skipped.

## Credentials

Both are optional and stored by the credential service, not in configuration:

- `GITHUB_TOKEN` — raises the GitHub allowance from 60 to 5,000 requests an hour.
- `JINA_API_KEY` — raises the reader tier's anonymous quota.

Authorization lives in the `网页检索` panel in the left sidebar: the page states the
scope, then requires an explicit confirmation before the value is written. Revoking a token
restores the environment fallback. Without a token the plugin still works.

## Signed-in pages

Two separate things cover this:

- **Site credentials** (the panel) attach one Cookie or Authorization header to
  requests for one host.
- **Browser control** (`dsh-browser-mcp`) reuses Microsoft's Playwright MCP
  server: a real Chromium with a persistent profile, headed, so you sign in once
  in its window and the model can then navigate, snapshot and read pages that
  sit behind that login. The retrieval tier's own browser stays isolated on
  purpose, so the two never fight over one profile.

## Browser helper

`extension/` is a Manifest V3 extension for Chromium and Firefox that reads the
active tab's cookies and hands the header to the panel's 需要登录的站点 form —
it cannot store anything itself; the two-step confirmation still applies. See
[extension/README.md](extension/README.md) for install steps and the permission
rationale.

## Limits worth knowing

- `robots.txt` stops the static, reader and browser tiers. It does not stop a
  documented API, which is published for machines.
- No tier signs in on its own, defeats a paywall, or retries around a block; a
  Cloudflare 403 is reported as a 403.
- A sign-in you store yourself is supported separately: the panel keeps one
  Cookie or Authorization header per host, sends it only to that host and only
  over https (loopback excepted), and never caches a credentialed read.
- The reader tier sends the URL to a third party; the result says so every time.
- PDFs and other binary downloads are reported, not parsed.
- The browser tier needs `npm i -g playwright && npx playwright install chromium`
  or `CHROMIUM_PATH`; the bundle ships no browser. A globally installed
  Playwright is found through the running Node installation, so `-g` is enough.

## Verify

```bash
cd /home/sfwh/plugins/dsh-retrieval
node --test                 # unit tests, no network
node scripts/smoke.mjs      # live run against every tier
```
