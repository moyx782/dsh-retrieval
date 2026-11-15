# Browser control (Playwright MCP)

Configuration-only bundle: it starts Microsoft's Playwright MCP server
(`@playwright/mcp` 0.0.85, Apache-2.0) as a stdio MCP server and lets the model
drive a real Chromium instead of only reading HTML.

## What the model gets

The tools arrive as `mcp__playwright__<tool>`, for example:

- `browser_navigate` — open a URL in the browser.
- `browser_snapshot` — a token-cheap accessibility-tree text of the page, which
  is what the model should read before clicking.
- `browser_click`, `browser_type`, `browser_press_key`, `browser_fill_form`,
  `browser_select_option`, `browser_file_upload`.
- `browser_take_screenshot`, `browser_tabs`, `browser_wait_for`,
  `browser_navigate_back`, `browser_close`.
- `browser_evaluate`, `browser_network_requests`, `browser_console_messages`,
  `browser_cookie_*`, `browser_localstorage_*`, `browser_sessionstorage_*`.

## Signed-in pages

The server keeps a persistent Chromium profile at
`~/.cache/dsh-retrieval/playwright-mcp`, so a sign-in survives a restart of DSH.
The browser opens **headed** (its default), so a page that asks for a login can
be signed into by the person at the keyboard; the cookies then stay in that
profile for every later call.

This is a separate browser identity, not your Firefox: Firefox exposes no CDP
endpoint, so it cannot be attached to.

## Limits

- One Chromium window; closing it ends the session but not the profile.
- It downloads nothing extra: the Playwright install already provides the
  Chromium build.
- Google's usage-statistics collection is off by default here because this
  bundle passes no `--no-usage-statistics` and Playwright MCP does not report
  to Google; the server is local and makes no calls of its own.
- If the server fails to start, the harness still starts and no
  `mcp__playwright__*` tools appear; the row can be toggled in **Plugins**.
