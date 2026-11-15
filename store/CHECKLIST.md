# 上架步骤（2026-11 核对）

## 三条路对比

| 商店 | 注册费 | 审核 | 适合 |
|---|---|---|---|
| Chrome Web Store | **$5 一次性**（一个账号最多 20 个扩展） | 通常 1–3 个工作日 | 面向所有 Chrome / Edge 用户搜得到 |
| Microsoft Edge 加加载项 | **免费**（Partner Center，需 Microsoft 账号） | 几个工作日 | Edge 用户；同一份 zip 直接复用 |
| Firefox AMO | **免费** | listed 需人工审核；unlisted 快 | Firefox 用户；或只为拿到签名 XPI |

> 如果你只是局域网里几台机器用，其实**不必上架**：自托管 CRX + 企业策略，或直接发 zip 让对方「加载已解压」即可。上架的价值是"能搜到、能一键装、能自动更新"。

---

## Chrome Web Store

1. **注册**：<https://chrome.google.com/webstore/devconsole> → 同意开发者协议 → 付一次性注册费。用一个你长期控制的 Google 账号（账号即商品归属），并开启两步验证。
2. **准备上传包**：`store/upload-flat.zip`（根目录是 `manifest.json`）。图标已在 `extension/icons/icon128.png`。
3. **新建商品**：Dashboard → New item → 上传 zip。
4. **商品详情**（照着 `listing.md` 填）：
   - 名称、简短说明（≤132 字符）、详细说明
   - 类别：开发者工具；语言：中文（简体）/ English
   - 图片：128×128 图标（可自动取）、**至少 1 张 1280×800 截图**、440×280 小宣传图、可选 1400×560 滚动图
5. **隐私规范**（关键，审核最容易卡这里）：
   - 单一用途说明
   - 逐项权限用途（`cookies` / `tabs` / `scripting` / `activeTab` / `storage` / `clipboardWrite` / `<all_urls>`）
   - 数据使用声明：勾选"认证信息"，说明只在本机流转、不上传
   - **隐私政策 URL**：把 `privacy-policy.md` 发布成公开页面（Gist / 自己的站点）后填入
6. **分发设置**：公开 / 不公开（unlisted，只有拿到链接的人能装）；地区、定价（免费）。
7. **提交审核**。1–3 个工作日；被拒会给出具体条款，改完重新提交。
8. 通过后同一 Dashboard 上传新 zip 即可更新（版本号必须递增）。

## Microsoft Edge 加载项

1. 用 Microsoft 账号注册 Partner Center 的 Edge 计划（免费）：<https://partner.microsoft.com/dashboard/microsoftedge>
2. 提交同一份 `store/upload-flat.zip`。
3. 表单比 Chrome 多一栏 **Single purpose description**，直接抄 `listing.md` 里的那句。
4. 提供测试说明：这个扩展需要配合本机 DSH 页面使用，写明"打开任一网页后点击扩展即可看到 Cookie 头"。
5. 审核几个工作日；通过后 Edge 用户可安装。

## Firefox AMO

1. 注册 <https://addons.mozilla.org> 开发者账号（免费）。
2. 上传 `dsh-retrieval-cookie-helper.xpi`（根目录含 `manifest.json`）。
3. 选择分发方式：
   - **On this site（listed）**：公开可搜，需人工审核。
   - **On your own（unlisted）**：不上架搜索，只做签名，拿到已签名 XPI 自行分发。
4. 代码未压缩混淆，通常不需要提交源码包；若被要求，附 `extension/` 源码。
5. 或用命令行签名（适合反复发版）：
   ```bash
   npx web-ext sign --api-key=$KEY --api-secret=$SECRET --channel=unlisted --artifacts-dir dist
   ```

---

## 提交前自检

- [ ] `manifest.json` 的 `version` 已递增
- [ ] 上传包根目录有 `manifest.json`（不是套在 `extension/` 里）
- [ ] 图标 128×128、至少一张 1280×800 截图
- [ ] 隐私政策已发布成公开 URL
- [ ] 权限用途逐条写清（`<all_urls>` + `cookies` 是高风险组合，务必解释是"读用户主动点击的标签页"）
- [ ] 说明它**不联网**、不保存密码、不绕过付费墙
