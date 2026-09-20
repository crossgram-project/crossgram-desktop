# Branding feature

This feature gives every build an independent application name and platform identifier. The default `cross` brand keeps the upstream icon; `qq`, `wechat`, `wecom`, `dingtalk`, and `discord` use the corresponding current App Store artwork.

The default mode is `--brand runtime`. Explicit legacy per-brand modes are still supported. Runtime mode ships a
single binary with stable Cross application identifiers and adds a **Crossgram brand** action to the main menu. The
selected id is persisted in `tdata/crossgram-brand`; changing it restarts the
client so the next launch uses the selected display name. Platform package
identifiers remain those of the universal package by design.

Branding changes are limited to application metadata and launcher icons. They do not alter Telegram protocol behavior, chat assets, or tray status icons.

The themed builds are unofficial and are not affiliated with, endorsed by, or distributed by Tencent, Alibaba, or Discord. Source and hashes for downloaded artwork are recorded in `assets/SOURCES.md`.
