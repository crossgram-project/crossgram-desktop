# Crossgram Desktop Patcher

向 Telegram Desktop 及其衍生客户端源码注入 Crossgram 特性的结构化源码补丁工具（不依赖 `git apply`）。

## 注入特性

- **服务器切换（[`features/server-switch`](features/server-switch/README.md)）**：在登录页按账号槽位配置自定义 MTProto 服务器（保存在 `tdata/<account-hash>/server-switch.json`）。
- **媒体直连下载（`features/direct-download`）**：对 `bridge-media:`、`bridge-sticker:` 与 `bridge-reaction-resource:` 文件调用 `crossgram.getFileUrl` 发起单次 HTTP（或 `Range` 断点续传）下载，状态栏显示 **直连 / 中转 / 连接中** 徽章，失败时自动回退到 `upload.getFile`。
- **秒传预检（`features/fast-upload`）**：上传图片或普通文件前在后台计算 MD5、SHA-1 与前 10 MiB MD5，调用 `crossgram.prepareMediaUpload`；命中 QQ 秒传时直接跳过 `upload.saveFilePart`。
- **原始动图直通（`features/raw-animation`）**：直接解码并播放 PNG / GIF / APNG 动图、动态贴纸与自定义表情回应，无需服务端转码 WebM/WebP。
- **跨实例拖拽转发（`features/cross-instance-forward`）**：同进程同账号内拖拽保持原生转发；拖向其他客户端实例或外部窗口时自动导出已加载图片或本地文件。
- **戳一戳（[`features/poke`](features/poke/README.md)）**：在支持 `poke` 的群聊/私聊头像与菜单中添加「戳一戳」（单击 1 次，悬停展开 1 / 5 / 10 次）。
- **合并转发与撤回标记（`features/merged-forward` / `features/recalled`）**：以只读历史视图打开 QQ 合并转发记录（不污染左侧会话列表，默认定位到首条消息），并支持显示已撤回消息。
- **无障碍行缓存（[`features/accessibility`](features/accessibility/README.md)）**：缓存聊天窗口无障碍子项列表，消除屏幕阅读器或焦点切换在长历史记录下的 $O(N^2)$ 卡死。
- **中日文分词（[`features/cjk-segmentation`](features/cjk-segmentation/README.md)）**：内置词频词典与全角标点分隔，支持中文双击选词、`Ctrl+Left/Right` 按词移动光标与 `Ctrl+Backspace/Delete` 按词删除。
- **Windows Unicode 输入修复（[`features/win-unicode-input`](features/win-unicode-input/README.md)）**：修复微信语音输入等通过 `KEYEVENTF_UNICODE` (`VK_PACKET`) 注入文本时的吞字与标点重复问题。
- **多品牌与自动更新（[`features/branding`](features/branding/README.md) / [`features/updater`](features/updater/README.md)）**：支持应用内切换品牌图标与名称（`--brand runtime`），并对接 Crossgram 自动更新源。
- **受控语义 E2E（[`features/e2e`](features/e2e/README.md)）**：默认关闭，显式传入 `--feature e2e` 时开启基于 Qt Accessibility 树的本地测试接口。

## 支持的上游客户端

| Target ID | 上游仓库 | 默认可执行文件名 |
|---|---|---|
| `tdesktop` | `telegramdesktop/tdesktop` | `CrossTelegram` |
| `tdesktop-x64` | `TDesktop-x64/tdesktop` | `Cross64Gram` |
| `ayugram` | `AyuGram/AyuGramDesktop` | `CrossAyuGram` |
| `materialgram` | `kukuruzka165/materialgram` | `CrossMaterialgram` |

## 使用方法

需要 Node.js 22+ 与 Yarn 4：

```bash
corepack enable
yarn install --immutable
yarn apply --target tdesktop --brand runtime --root /path/to/tdesktop
```

- `--target`：`tdesktop` | `tdesktop-x64` | `ayugram` | `materialgram`
- `--brand`：默认 `runtime`（单一通用包，可在主菜单 **Crossgram brand** 中切换 `Cross`、`QQ · Cross`、`微信 · Cross`、`企业微信 · Cross`、`钉钉 · Cross`、`Discord · Cross` 并保存在 `tdata/crossgram-brand`）；也支持显式指定单个品牌 ID。
- `--feature e2e`：可选，仅用于受控 E2E 测试构建。

## 服务器配置 JSON

登录页点击 **Server** → **Add custom configuration...**，输入或从剪贴板读取服务器配置：

```json
{
  "name": "Crossgram",
  "enable_special_config": false,
  "host": "192.168.1.100",
  "port": 4430,
  "rsa_key": "-----BEGIN RSA PUBLIC KEY-----\n...\n-----END RSA PUBLIC KEY-----",
  "dcs": [
    { "id": 1, "ip": "192.168.1.100", "port": 4430 }
  ]
}
```

每个账号将配置独立保存在 `tdata/<account-hash>/server-switch.json`；新增账号时会自动复制来源账号已保存的 `server-switch.json` 作为初始配置，此后各账号独立切换互不影响。

## 开发与检查

```bash
yarn check
yarn build
```
