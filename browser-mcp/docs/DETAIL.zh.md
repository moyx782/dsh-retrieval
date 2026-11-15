# 浏览器控制（Playwright MCP）

纯配置型 bundle：把微软官方的 Playwright MCP 服务（`@playwright/mcp` 0.0.85，Apache-2.0）作为 stdio MCP 服务挂进来，让模型能驱动一个真实的 Chromium，而不只是读 HTML。

## 模型拿到什么

工具以 `mcp__playwright__<tool>` 出现，例如：

- `browser_navigate` —— 打开一个网址。
- `browser_snapshot` —— 页面的无障碍树文本快照，比截图省 token，点击前先读它。
- `browser_click`、`browser_type`、`browser_press_key`、`browser_fill_form`、`browser_select_option`、`browser_file_upload`。
- `browser_take_screenshot`、`browser_tabs`、`browser_wait_for`、`browser_navigate_back`、`browser_close`。
- `browser_evaluate`、`browser_network_requests`、`browser_console_messages`、`browser_cookie_*`、`browser_localstorage_*`、`browser_sessionstorage_*`。

## 需要登录的页面

服务使用一个持久化的 Chromium 配置目录 `~/.cache/dsh-retrieval/playwright-mcp`，所以登录状态能跨 DSH 重启保留。浏览器默认以**有头**方式打开，遇到登录页时你可以直接在窗口里登录，之后每次调用都带着这份 Cookie。

这是**另一个浏览器身份**，不是你日常用的 Firefox —— Firefox 没有 CDP 端点，挂不上去。

## 边界

- 只有一个 Chromium 窗口；关掉窗口结束本次会话，但配置目录还在。
- 不额外下载任何东西：Playwright 已装好的 Chromium 就是它用的那个。
- 服务本身在本机运行、不对外发请求；如果它启动失败，DSH 仍会正常启动，只是不会出现 `mcp__playwright__*` 工具，可在「插件」页把这一行关/开重试。
