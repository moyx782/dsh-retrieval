# Browser control (Playwright MCP)

A configuration-only DSH bundle that runs
[`@playwright/mcp`](https://github.com/microsoft/playwright-mcp) as a stdio MCP
server. Nothing is reimplemented: the tools are Playwright's own.

```bash
npm i -g @playwright/mcp@0.0.85   # already installed on this machine
```

The patch starts the server with a persistent profile:

```yaml
command: playwright-mcp
args:
  - --headless
  - --viewport-size=1280,860
  # optional: keep sign-ins between sessions
  # - --user-data-dir=$HOME/.cache/dsh-retrieval/playwright-mcp
  # optional: use a Chromium build instead of the Chrome channel
  # - --executable-path=/path/to/chrome
```

Install with `plugin_manager` `install_bundle` on this directory. Tools appear
as `mcp__playwright__*`; sign in once in the window it opens, and later calls
reuse that session.

To attach the server to a Chromium you already run instead, add
`--cdp-endpoint http://127.0.0.1:9222` to the args and drop the profile flag.
