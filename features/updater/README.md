# 应用内自动更新（`features/updater`）

复用并接管 Telegram Desktop 原生自动更新链路（检查 `current<N>` → 下载更新包 → 验签 → 解包至 `tupdates/temp` → `Updater` 替换二进制并重启）：

1. **版本号映射**：将 `core/version.h` 的 `AppVersion` 设为 `100000000 + <workflow run>`，既高于上游版本号以触发更新，又能在更新后识别当前构建号。
2. **签名链替换（按上游能力二选一）**：
   - Telegram Desktop 7.3+ 走 **V2 链路**：客户端在构建期从 `Telegram/Resources/update/`（`cmake/generate_update_keys.cmake`）嵌入 Ed25519 根公钥与密钥清单，且只接受 TDUP 信封的 V2 更新包。补丁把该目录三个文件替换为 `assets/v2/`（`root-public.pem` / `manifest.min.json` / `manifest.sig`），CI 用 `CROSSGRAM_UPDATE_V2_KEY`（清单中 `cg-rl-1` 的 Ed25519 私钥）调用 `Packer -channel stable -keys-loc … -local-key …` 产 V2 包。旧包（RSA）会被此类客户端以 `missing v2 magic` 拒收。
   - 更早的上游（AyuGram 7.2 等）仍走 **RSA v1 链路**：将 `config.h` 与 `_other/packer.cpp` 中的更新公钥替换为 Crossgram RSA 公钥（`assets/update-public-key.pem`），CI 使用 `CROSSGRAM_UPDATE_KEY` 私钥产签名包。
3. **更新源重定向**：将 `storage/localstorage.cpp` 的 `readAutoupdatePrefixRaw()` 指向 `crossgram-desktop` 仓库 `updates` 分支下按 `<target>-<brand>/<platform>/current<N>` 组织的 `version:url` 文本源。

> 仅在同时传入 `--platform` 与 `--build` 参数时才会改写版本号与更新源地址；本地常规 `yarn apply` 保持原版本号不变。签名链替换始终执行，本地构建因此也不会接受官方更新包。
>
> 根私钥与签名私钥保存在 CI secrets 并另行离线备份；轮换密钥时需重新生成 `assets/v2/` 三件套，且首个携带它们的构建需要用户手动升级一次（旧构建嵌入的是旧根公钥，无法自动跳转到新链路）。
