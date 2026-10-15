# 应用内自动更新（`features/updater`）

复用并接管 Telegram Desktop 原生自动更新链路（检查 `current<N>` → 下载 `.upd` → SHA-1 + RSA 验签 → 解包至 `tupdates/temp` → `Updater` 替换二进制并重启）：

1. **版本号映射**：将 `core/version.h` 的 `AppVersion` 设为 `100000000 + <workflow run>`，既高于上游版本号以触发更新，又能在更新后识别当前构建号。
2. **签名公钥替换**：将 `config.h` 与 `_other/packer.cpp` 中的更新公钥替换为 Crossgram 公钥（`assets/update-public-key.pem`），CI 使用 `CROSSGRAM_UPDATE_KEY` 私钥通过 `Packer` 生成签名更新包。
3. **更新源重定向**：将 `storage/localstorage.cpp` 的 `readAutoupdatePrefixRaw()` 指向 `crossgram-desktop` 仓库 `updates` 分支下按 `<target>-<brand>/<platform>/current<N>` 组织的 `version:url` 文本源。

> 仅在同时传入 `--platform` 与 `--build` 参数时才会改写版本号与更新源地址；本地常规 `yarn apply` 保持原版本号不变。
