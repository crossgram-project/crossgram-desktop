# 品牌化与图标切换（`features/branding`）

为构建产物赋予独立的应用名称、平台标识（Windows AppId、macOS Bundle ID、Linux Desktop ID）与启动图标。

- 默认构建模式为 `--brand runtime`：生成单一通用可执行文件，并在主菜单提供 **Crossgram brand** 切换项（选择结果保存在 `tdata/crossgram-brand`，重启后生效）。
- 可选品牌：`cross`（保持上游图标）、`qq`（QQ · Cross）、`wechat`（微信 · Cross）、`wecom`（企业微信 · Cross）、`dingtalk`（钉钉 · Cross）、`discord`（Discord · Cross）。图标来源与 SHA-256 记录于 [`assets/SOURCES.md`](assets/SOURCES.md)。
