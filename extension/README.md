# Cookie → DSH retrieval

A small browser extension that reads the **current tab's cookies** and hands
them to the `网页检索` panel, so a signed-in site can be read without copying
values out of dev tools by hand.

It is a helper for [the retrieval bundle](../index.js); it does nothing on its
own and makes no network requests.

## What it does

- Reads the cookies this browser would send to the active tab
  (`https`/`http` pages only), skipping measurement and ad cookies by default.
- Shows the exact `Cookie: …` header in an editable box.
- **复制** puts it on the clipboard so you can paste it into
  `需要登录的站点` yourself.
- **发送到 DSH 面板** posts a message into the DSH page open in the same
  browser. The panel opens its add-a-site form with the host and header filled
  in — **you still tick the confirmation and press 允许并保存**; the extension
  cannot store a credential on its own.

## Install

### Firefox (the browser this machine runs)

1. Open `about:debugging#/runtime/this-firefox`.
2. **临时载入附加组件…** → choose `manifest.json` in this directory.
3. The extension appears in the toolbar; the temporary install disappears when
   Firefox restarts.

### Chrome / Edge / Brave

1. Open `chrome://extensions` and turn on **开发者模式**.
2. **加载已解压的扩展程序** → choose this `extension/` directory.

Both browsers use the same `manifest.json` (Manifest V3). Firefox additionally
reads `browser_specific_settings.gecko`.

## Using it

1. Open the DSH page (`http://192.168.1.19:3080`) and click **网页检索** in the
   left column at least once, so the panel has mounted once in this tab.
2. Sign in to the site you want to read, and open one of its pages in the same
   browser.
3. Click the extension icon, check the header, then **发送到 DSH 面板** (or
   **复制** and paste it).
4. Back in the panel: confirm the scope, tick the box, **允许并保存**.

The header is then stored for that host by the DSH credential service and sent
only to that host, only over https (loopback excepted). Delete it from the same
panel when you no longer need it.

## Permissions and privacy

| Permission | Why |
|---|---|
| `cookies` + `<all_urls>` | A cookie belongs to a site, so reading any site's cookies requires access to that site. |
| `tabs`, `scripting` | Find the open DSH tab and post one message into it. |
| `storage` | Remember the DSH address between popup opens. |
| `clipboardWrite` | The copy button. |

The extension sends nothing over the network: no analytics, no remote config,
no telemetry. The cookies travel from the browser's cookie store to the DSH
page's form, and only after you press save does the DSH host store them.

Once `发送到 DSH 面板` succeeds, the tab shows a `sessionStorage` entry that the
panel consumes immediately; nothing else persists on the page side.

## Limits

- A temporary Firefox add-on is re-loaded by hand after a restart; a permanent
  install needs signing.
- The extension cannot read `HttpOnly` cookies from page scripts, but it can
  read them through the `cookies` API — which is exactly why it needs that
  permission and why you should only run it on a machine you control.
- It reads cookies, not other auth state: a site that keeps its session in
  `localStorage` or a bearer token in a request header is not covered by this
  flow. Paste that header into the same panel field by hand.
