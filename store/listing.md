# 商店上架资料（Chrome / Edge / Firefox）

## 名称与简介

**名称**：网页检索 Cookie 助手 / DSH retrieval cookie helper

**简短说明（Chrome 上限 132 字符）**
> 把当前标签页的 Cookie 一键交给 DSH 网页检索面板，让需要登录的页面也能被抓取。

> Send the current tab's cookies to the DSH retrieval panel so signed-in pages can be read.

**单一用途（Edge 会单独要）**
> 读取用户当前标签页的 Cookie，并把用户确认过的值交给同一浏览器里已打开的 DSH「网页检索」面板。

**类别**：开发者工具 / Developer tools
**语言**：中文（简体）、English

## 详细说明

本扩展是 DeepSeek Harness 检索插件的配套工具，只做一件事：
把当前标签页的 Cookie 交给 DSH 页面上的「网页检索」面板，省去从开发者工具里手工复制的步骤。

**工作方式**

1. 打开要读取的网站，登录到你需要的样子。
2. 点扩展图标：它显示这个标签页会发送的 `Cookie:` 头，默认过滤掉统计和广告类 Cookie，文本可编辑。
3. 点「发送到 DSH 面板」：扩展在你已经打开的 DSH 页面里预填该域名和值。
4. 面板会要求你勾选授权范围并点「允许并保存」——扩展自己不保存任何东西。

**它不做的事**

- 不联网：没有任何远程请求、统计或遥测。
- 不读取你没有主动点击的那个标签页以外的内容。
- 不保存密码、不代替你登录、不绕过付费墙。

**权限说明**

| 权限 | 用途 |
|---|---|
| `cookies` | 读取用户主动点击的那个标签页的 Cookie |
| `tabs` | 找到当前标签页，并定位已打开的 DSH 面板标签页 |
| `scripting` | 向 DSH 页面投递一条同源消息（预填表单） |
| `activeTab` | 把访问范围限制在用户主动操作的标签页 |
| `storage` | 记住 DSH 面板地址 |
| `clipboardWrite` | 「复制」按钮 |
| `<all_urls>` | Cookie 属于具体站点，读任意站点的 Cookie 就必须声明该站点权限；实际只在用户点击扩展的标签页上读取 |

## 隐私政策（需公开 URL）

见 [`privacy-policy.md`](privacy-policy.md)。Chrome 隐私字段要求一个**可公开访问的 URL**：把这份文件贴成 Gist / 静态页面即可，例如
`https://gist.github.com/<you>/<id>` 或你自己的站点。

## 图片资源（已备/待备）

| 用途 | 尺寸 | 状态 |
|---|---|---|
| 商店图标 | 128×128 PNG | ✅ `extension/icons/icon128.png` |
| 小宣传图块 | 440×280 | ✅ `store/promo-440x280.png` |
| 滚动宣传图块（可选） | 1400×560 | ✅ `store/promo-1400x560.png` |
| 截图 | 1280×800，1–5 张 | ⬜ **需要你在装好扩展的浏览器里截**：①弹窗显示 Cookie 头 ②面板预填后的确认框 |
| 宣传视频（可选） | YouTube 链接 | ⬜ 可留空 |

## 上传包

`store/upload-flat.zip`：**根目录就是 manifest.json** 的那份（`dsh-retrieval-cookie-helper.zip` 里多套了一层 `extension/`，适合解压使用，不适合直接上传）。

## 版本

`0.1.0`。商店每次更新都要把 `manifest.json` 的 `version` 往上加。
