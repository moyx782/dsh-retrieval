# 打包与安装：不发布能不能装上

结论先给：**Chrome/Edge 可以完全不发布；Firefox 想“永久安装”就必须签名，但签名不等于上架商店。**

## 三种产物

| 文件 | 用途 | 生成方式 |
|---|---|---|
| `.zip` | 源码包，解压后用「加载已解压」 | `zip -r x.zip extension` |
| `.crx` | Chromium 打包件，含自签名公钥 | `chrome --pack-extension=<dir>` |
| `.xpi` | Firefox 打包件，`manifest.json` 必须在 zip 根目录 | `cd extension && zip -r ../x.xpi .` |

本目录里的三个文件就是这样来的；`.pem` 是 CRX 的私钥，**留着才能后续用同一个 ID 重新打包**（丢了就只能换 ID）。

## Chrome / Edge

| 方式 | 是否要发布 | 持久性 | 备注 |
|---|---|---|---|
| 开发者模式 → 加载已解压 | 不要 | 重启后仍在 | 每次启动会提示“关闭开发者模式扩展程序”，需要手动忽略 |
| 拖入 `.crx`（开发者模式） | 不要 | 视版本 | 部分平台/版本已禁止非商店 CRX 直接安装 |
| 策略强制安装 `.crx` | 不要 | 是 | 需要管理员写 `ExtensionInstallForcelist` + 自托管更新 XML；企业/受管设备最稳 |

个人自用，**加载已解压就够**，唯一代价是启动时那条开发者模式提示。

## Firefox

Firefox 的发布版只装**已签名**的扩展，这条绕不开，但有两种“不上架”的满足方式：

1. **临时载入**（`about:debugging`）：完全不用签名、不用发布，代价是**浏览器重启后失效**，每次要重新载入。
2. **AMO unlisted 签名**：向 addons.mozilla.org 提交、选 unlisted 渠道，自动签名后下载 `.xpi`。它不会出现在商店搜索里，只是“签个名”，仍然算发布流程（需要 AMO 账号和 API key）：
   ```bash
   npx web-ext sign --api-key=... --api-secret=... --channel=unlisted --artifacts-dir dist
   ```
3. **不签名的常驻方案**：Firefox Developer Edition / Nightly（或 ESR）里把 `xpinstall.signatures.required` 设为 `false`，自签名 XPI 就能永久安装。发布版（Release/Beta）不支持这个开关。

## 与 DSH 插件无关

DSH 的 bundle（`dsh-retrieval`、`dsh-browser-mcp`）不需要发布也不需要签名：`plugin_manager install_bundle` 用的是本地目录链接，改完源码重启那一行即可。上面讨论的“发布”只针对**浏览器扩展**。
