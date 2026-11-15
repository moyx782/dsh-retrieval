# Web retrieval

One tool, `web_retrieve`, that reads a page the free way first and tells you
which layer answered.

## What it does

`web_retrieve` has three actions:

- **`fetch`** — read one URL. The pipeline tries the site's documented API, then
  a plain GET with article extraction, then the `r.jina.ai` reader service, then
  a local Playwright browser. The first tier with a real answer wins, and the
  reply states the tier, the elapsed time and the byte count.
- **`probe`** — survey a site before reading from it: `robots.txt` verdict,
  sitemaps, feeds, OpenSearch description, whether the page ships text before
  JavaScript runs, and which official API already covers the host. One probe
  call is usually cheaper than five failed reads.
- **`search`** — find pages by keyword. When `site` names GitHub, Wikipedia,
  Hacker News, arXiv or Stack Exchange the site's own search endpoint answers;
  otherwise DuckDuckGo, Marginalia or a SearXNG instance does. Backends that
  fail are named in the result rather than hidden.

## The tiers

| Tier | What answers | Notes |
|---|---|---|
| `api` | GitHub, Wikipedia, Hacker News, arXiv, Stack Exchange, npm, PyPI | the site's published contract; needs no paid key |
| `http` | a plain GET plus a dependency-free article extractor | honours `robots.txt`; strips navigation, keeps headings, links, code and tables |
| `reader` | `r.jina.ai` | no key needed; ~20 requests a minute anonymously; the URL leaves the machine and the result says so |
| `browser` | Playwright | only when installed; isolated, no profile — signed-in browsing belongs to the `dsh-browser-mcp` bundle |

`fetch` accepts `layer` to force one tier and `maxChars` to bound the body
(2,000–60,000, default 24,000). A forced `api` tier fails loudly instead of
falling through, which is what you want when testing an adapter.

## Credentials

Two optional tokens, both stored by the credential service rather than in
plugin configuration:

- **GitHub token** (`GITHUB_TOKEN`) — raises the GitHub API allowance from 60 to
  5,000 requests an hour.
- **Jina Reader token** (`JINA_API_KEY`) — raises the reader tier's anonymous
  quota.

They are authorized in the **Web retrieval** panel in the left sidebar, which opens the `检索授权` page. The same page holds **sites that need a sign-in**: one Cookie or Authorization header per host, added with the same two-step confirmation, listed by host, and deletable there. The bundled browser extension
(`extension/`) can hand the active tab's cookies to that form, which still asks
for the same confirmation before storing them. The panel shows each reference's
status and source, states the scope of the token, and requires an explicit
confirmation before anything is written; revoking restores the environment
fallback. Without either token the bundle works normally.

## Limits

- `robots.txt` stops the static, reader and browser tiers. It does not stop a
  documented API, which is published for machine use — arXiv is the standing
  example, because its `robots.txt` disallows everything while its API is
  offered to the public.
- No tier signs in on its own or defeats a paywall, and a Cloudflare 403 is
  reported as a 403. A sign-in you store yourself is different: the panel can
  hold one Cookie or Authorization header per host, it is sent only to that
  host and only over https (loopback excepted), and a credentialed read is
  never served from the cache.
- PDFs and other binary responses are reported, not parsed.
- Search depends on HTML endpoints that rate-limit aggressively; when every
  backend fails the result lists what each one said.
