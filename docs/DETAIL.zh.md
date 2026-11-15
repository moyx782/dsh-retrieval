# 网页检索

一个工具 `web_retrieve`：优先用免费的正路子读页面，并告诉你最后是哪一层给出了内容。

## 做什么

`web_retrieve` 有三个动作：

- **`fetch`** —— 读一个网址。链路依次是：站点官方 API → 普通 GET + 正文抽取 → `r.jina.ai` reader 服务 → 本机 Playwright 浏览器。第一个拿到真实内容的层胜出，返回里写明层级、耗时和字节数。
- **`probe`** —— 批量读之前先勘察：`robots.txt` 的结论、sitemap、RSS、OpenSearch 描述、页面在 JS 执行前有没有正文、以及该域名已被哪个官方 API 覆盖。一次 probe 通常比五次失败的读取便宜。
- **`search`** —— 按关键词找页面。`site` 指向 GitHub / Wikipedia / Hacker News / arXiv / Stack Exchange 时走该站自己的搜索接口，否则走 DuckDuckGo、Marginalia 或 SearXNG 实例。失败的后端会写进结果，而不是被悄悄跳过。

## 四层

| 层 | 谁在回答 | 说明 |
|---|---|---|
| `api` | GitHub、Wikipedia、Hacker News、arXiv、Stack Exchange、npm、PyPI | 站点公开的契约接口，不需要付费 key |
| `http` | 普通 GET + 零依赖正文抽取 | 遵守 `robots.txt`；去掉导航，保留标题、链接、代码块和表格 |
| `reader` | `r.jina.ai` | 免 key，匿名约 20 次/分钟；URL 会离开本机，返回里会注明 |
| `browser` | Playwright | 仅在已安装时可用；每次隔离启动、不占 profile —— 需要登录的浏览交给 `dsh-browser-mcp` |

`fetch` 支持 `layer` 强制指定某一层、`maxChars` 限制正文长度（2,000–60,000，默认 24,000）。强制 `api` 时会直接失败而不降级，这在验证适配器时正是想要的。

## 凭证

两个可选令牌，都存在 DSH 的凭证服务里，不写进插件配置：

- **GitHub 令牌**（`GITHUB_TOKEN`）—— 把 GitHub API 额度从 60 次/小时提到 5,000 次/小时。
- **Jina Reader 令牌**（`JINA_API_KEY`）—— 提高 reader 层的匿名额度。

授权入口在左侧栏的「网页检索」面板里（面板标题为「检索授权」）；同一页还有「需要登录的站点」，按域名保存一个 Cookie 或 Authorization 头，同样是两步确认、可按域名删除；随附的浏览器插件（`extension/`）可以把当前标签页的 Cookie 直接送进这个表单，仍要你确认后才会保存：面板显示每一项的状态与来源，列出令牌的用途范围，必须显式确认后才会写入；撤销后自动回退到环境变量。不配置任何令牌，插件也照常工作。

## 边界

- `robots.txt` 会挡住静态、reader、浏览器三层；但不会挡住站点公开的 API —— arXiv 就是标准例子：它的 `robots.txt` 全站禁止，而 API 是对公众开放的。
- 任何一层都不会自己去登录、不绕付费墙，被 Cloudflare 拦截的 403 就报成 403。你自己保存的登录凭证是另一回事：面板可以为每个域名保存一个 Cookie 或 Authorization 头，只发给该域名、且除本机回环外只走 https，带凭证的读取不进入缓存。
- PDF 等二进制响应只报告不解析。
- 搜索依赖会被限流的 HTML 端点；所有后端都失败时，结果里会逐条列出各自的原因。
