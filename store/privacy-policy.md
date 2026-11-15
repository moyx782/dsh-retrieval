# 隐私政策 / Privacy Policy

最后更新：2026-11-16

## 中文

「网页检索 Cookie 助手」（下称"本扩展"）是一个本地工具，用于把当前标签页的 Cookie 交给用户自己运行的 DeepSeek Harness 页面。本扩展**不收集、不上传、不共享**任何数据。

### 处理哪些数据

- 仅在用户点击扩展图标时，读取**当前标签页**对应的 Cookie（名称与值），用于生成 `Cookie:` 请求头。
- 用户可编辑该文本，并选择复制或发送到已打开的 DSH 页面。
- 记住用户填写的 DSH 面板地址（保存在浏览器本地 `storage`）。

### 数据去向

- 不发起任何网络请求：没有远程服务器、没有统计、没有遥测。
- 「发送到 DSH 面板」只向**同一浏览器里已打开的同源页面**投递一条消息，由该页面预填表单。
- 只有用户在 DSH 面板里勾选确认并点击保存后，值才会被该页面写入用户自己的 DSH 凭证库（位于用户自己的主机）。

### 保留与删除

本扩展自身不持久保存 Cookie 值；地址设置可在浏览器扩展设置里清除。已保存到 DSH 的凭证可在 DSH「网页检索」面板里按域名删除。

### 权限

`cookies`、`tabs`、`scripting`、`activeTab`、`storage`、`clipboardWrite`、`<all_urls>`。每项用途见商店「权限说明」。

### 儿童、第三方、变更

本扩展不面向儿童，不包含第三方 SDK。政策变更会更新本文件日期。

### 联系

在发布者仓库提交 issue（见商店「支持网址」）。

## English

"DSH retrieval cookie helper" is a local utility that hands the current tab's
cookies to a DeepSeek Harness page the user runs.

- **No collection, no upload, no sharing.** The extension makes no network
  requests and has no analytics or telemetry.
- It reads cookies **only for the tab the user invokes it on**, only when the
  user clicks the toolbar button.
- The cookie text is shown to the user, optionally copied, or posted as a
  same-origin message into the DSH page that is already open in the same
  browser. That page pre-fills a form; nothing is stored until the user ticks
  the consent box and saves it into their own DSH credential store.
- The DSH base address is the only value kept in `storage`.
- Permissions: `cookies`, `tabs`, `scripting`, `activeTab`, `storage`,
  `clipboardWrite`, `<all_urls>` — each is required to read the invoked tab's
  cookies and reach the locally running DSH page.
