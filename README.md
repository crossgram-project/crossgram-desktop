# Crossgram Desktop patcher

This repository applies opt-in features to Telegram Desktop forks without using Git patch files. `server-switch` adds a per-account MTProto server selector to the sign-in UI, while `branding` gives generated applications independent names and platform identifiers. The separately enabled `e2e` feature exposes the Qt accessibility tree to authenticated local test drivers.

For `bridge-media:` files, patched clients first call Crossgram's
`crossgram.getFileUrl` RPC and start one normal HTTP transfer for the whole file.
The existing part assembler reads from that shared transfer instead of issuing
one HTTP request per `upload.getFile` part. Any RPC, expiry, or HTTP failure silently falls back to the original `upload.getFile`
relay path. The download task exposes `crossgramDownloadTransport()` for
diagnostics and logs `crossgram_download_transport=<direct|relay>`.
While a document is downloading, its message status row also shows the selected
transport as a green **直连**, orange **中转**, or gray **连接中** badge.

Before uploading a prepared photo or regular document, patched clients hash the
local bytes once off the UI thread and call `crossgram.prepareMediaUpload` with
MD5, SHA-1, and the first-10-MiB MD5. A QQ rapid-upload hit skips every
`upload.saveFilePart` request while preserving Telegram's normal `InputFile`
send flow. RPC failures and cache misses fall back to the unchanged uploader;
voice, round-video, and secure uploads are never probed.

When Telegram already has a partial file, the one shared transfer starts with a
single open-ended `Range: bytes=<first-missing-offset>-` request. Fresh downloads
use a normal GET; neither path creates one HTTP request per 128 KiB part.

The same direct HTTP path is used for `bridge-sticker:` and
`bridge-reaction-resource:` documents. Original PNG, GIF, and APNG assets are
kept in their source format: animated image documents use the upstream
FFmpeg streaming pipeline, while animated stickers and custom reactions reuse
the alpha-preserving sticker clip player. No desktop-specific WebM/WebP
derivative is required from the relay.

Message drags use a Crossgram process-local token instead of Telegram
Desktop's bare `application/x-td-forward` marker. A drop inside the same
process and account keeps native forwarding. Drops into another process or
account fall back to the standard image or local-file MIME payload and are
uploaded as new media, which also allows downloaded media to be dragged into
an unmodified Telegram Desktop instance. A foreign Telegram Desktop drag is
treated the same way when it exposes loaded image data or downloaded files.
Multi-message drags export every loaded photo and every downloaded or
memory-cached document into an ordered local-file list; if any selected item
cannot be materialized, the external file payload is suppressed rather than
sending only part of the selection.

Supported upstreams:

- `telegramdesktop/tdesktop`
- `TDesktop-x64/tdesktop`
- `AyuGram/AyuGramDesktop`
- `kukuruzka165/materialgram`

`kotatogram/kotatogram-desktop` is deferred because its latest release is based on a substantially older tdesktop architecture. Supporting it would require maintaining a separate integration path for account startup, UI widgets and layout, and MTProto configuration loading.

## Apply the feature

Node.js 22 or newer and Yarn 4 are required.

```bash
corepack enable
yarn install --immutable
yarn apply --target tdesktop --brand cross --root /path/to/tdesktop
```

Normal builds do not contain the semantic automation endpoint. Add
`--feature e2e` only for a controlled E2E build; see
[`features/e2e/README.md`](features/e2e/README.md) for the runtime protocol and
driver examples.

Target ids are `tdesktop`, `tdesktop-x64`, `ayugram`, and `materialgram`. Brand ids are `cross`, `qq`, `wechat`, `wecom`, `dingtalk`, and `discord`; `cross` is the default. Applying the patch repeatedly is supported and produces byte-identical output.

The patcher performs unique, structural edits around C++ function bodies, declarations, includes, CMake metadata, and desktop integration files. A missing or ambiguous anchor is a hard failure. Large injected implementations and their integration logic are isolated under [`features/server-switch`](features/server-switch), [`features/branding`](features/branding), and [`features/e2e`](features/e2e).

## Build branding

Default builds use `CrossTelegram`, `Cross64Gram`, `CrossAyuGram`, or `CrossMaterialgram` and append `.crossgram` to the upstream platform identifier. Every supported upstream also ships these themed brands:

- `QQ · Cross` / `.crossgram.qq`
- `微信 · Cross` / `.crossgram.wechat`
- `企业微信 · Cross` / `.crossgram.wecom`
- `钉钉 · Cross` / `.crossgram.dingtalk`
- `Discord · Cross` / `.crossgram.discord`

Windows receives a distinct deterministic AppId, macOS a distinct bundle id, and Linux a distinct desktop/application id. Display names may contain Unicode; executable filenames remain ASCII. The themed icons are current App Store CDN artwork with source URLs and SHA-256 hashes recorded in [`features/branding/assets/SOURCES.md`](features/branding/assets/SOURCES.md).

These are unofficial themed builds and are not affiliated with or endorsed by Tencent, Alibaba, Discord, Telegram, or the upstream client projects.

## User experience

The sign-in screen contains a **Server** button. Its popup contains:

- **Official Telegram**, which removes the account's custom configuration;
- the account's saved custom configuration, when present;
- **Add custom configuration...**, which opens a multiline JSON input with Confirm, Read from clipboard, and Cancel buttons.

The input schema is:

```json
{
  "name": "My custom server",
  "enable_special_config": false,
  "host": "192.168.1.100",
  "port": 4430,
  "rsa_key": "-----BEGIN RSA PUBLIC KEY-----\n...\n-----END RSA PUBLIC KEY-----",
  "dcs": [
    { "id": 1, "ip": "192.168.1.100", "port": 4430 },
    { "id": 2, "ip": "192.168.1.100", "port": 4430 },
    { "id": 3, "ip": "192.168.1.100", "port": 4430 },
    { "id": 4, "ip": "192.168.1.100", "port": 4430 },
    { "id": 5, "ip": "192.168.1.100", "port": 4430 }
  ]
}
```

The client rejects malformed JSON, invalid IP addresses or ports, duplicate DC ids, and invalid RSA public keys. Switching is allowed only before an account signs in. It rebuilds that account's MTProto instance without carrying authorization keys across servers.

Each account stores its JSON at:

```text
tdata/<account-hash>/server-switch.json
```

`QSaveFile` provides atomic writes. The file contains connection metadata and a public key, not account credentials.

## CI and releases

[`check.yml`](.github/workflows/check.yml) resolves and patches all 24 target/brand combinations in parallel. Matrix fail-fast is disabled, so a broken upstream or brand does not cancel the others.

[`release.yml`](.github/workflows/release.yml) resolves all upstream versions once and
generates a dynamic matrix of two-brand build batches. Scheduled runs inspect release
assets produced from the current patcher commit and only rebuild missing package/symbol
pairs. This makes an unchanged daily run finish after the planner, while an interrupted
release retries only its missing targets, platforms, batches, or individual brands.
Manual dispatches always rebuild the explicitly requested filters.

Each run publishes every successful target, brand, and platform into one unified
`Crossgram Desktop #<run-number>` release, matching the Android release model. One
job's failure does not prevent the other successful builds from being published.

User archives contain stripped production binaries built with `NDEBUG` and `QT_NO_DEBUG`. Debug information is kept out of those archives and published as separate `*.symbols.*` assets: PDB files on Windows, split debug files on Linux, and dSYM bundles on macOS.

The publish job uses `GITHUB_TOKEN` with repository Contents write permission.

CI uses the Crossgram project's Telegram API identity for every supported client target. Repository secrets `TDESKTOP_API_ID` and `TDESKTOP_API_HASH` may override both values together; a partial override is rejected. Release builds never fall back to `TDESKTOP_API_TEST=ON`.

The workflows cache Yarn artifacts, Linux Python package downloads and BuildKit
dependency-image layers, plus the Windows/macOS `TBuild/Libraries` and
`TBuild/ThirdParty` dependency trees. Native cache keys include the target and the
upstream prepare-script hash, while BuildKit validates its own layer inputs, so
regular app releases can reuse prepared Qt and third-party libraries without
accepting another target's or a stale build recipe's dependencies.

Release tags use this form:

```text
crossgram-<workflow-run-number>
```

## Development checks

```bash
yarn check
yarn build
```

The TypeScript test suite covers structural function matching, CRLF preservation, ambiguous-anchor rejection, and the supported-target registry.
