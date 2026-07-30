# Crossgram Desktop patcher

This repository applies opt-in features to Telegram Desktop forks without using Git patch files. `server-switch` adds a per-account MTProto server selector to the sign-in UI, while `branding` gives generated applications independent names and platform identifiers. The separately enabled `e2e` feature exposes the Qt accessibility tree to authenticated local test drivers.

For `bridge-media:` files, patched clients first call Crossgram's
`crossgram.getFileUrl` RPC and download byte ranges directly over HTTP. Any RPC,
expiry, or HTTP failure silently falls back to the original `upload.getFile`
relay path. The download task exposes `crossgramDownloadTransport()` for
diagnostics and logs `crossgram_download_transport=<direct|relay>`.

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

Default builds use `CrossTelegram`, `Cross64Gram`, `CrossAyuGram`, or `CrossMaterialgram` and append `.crossgram` to the upstream platform identifier. The additional Telegram Desktop themes are:

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

[`check.yml`](.github/workflows/check.yml) resolves and patches all four latest upstream releases plus the five Telegram Desktop themes in parallel. Matrix fail-fast is disabled, so a broken upstream or brand does not cancel the others.

[`release.yml`](.github/workflows/release.yml) builds 9 target/brand combinations × 3 platforms for Windows, Linux, and macOS. Each workflow run publishes every successful target, brand, and platform into one unified `Crossgram Desktop #<run-number>` release, matching the Android release model. One job's failure does not prevent the other successful builds from being published.

User archives contain stripped production binaries built with `NDEBUG` and `QT_NO_DEBUG`. Debug information is kept out of those archives and published as separate `*.symbols.*` assets: PDB files on Windows, split debug files on Linux, and dSYM bundles on macOS.

The publish job uses the repository secret `CROSSGRAM_RELEASE_TOKEN` when present and otherwise falls back to `GITHUB_TOKEN`. Organizations that force the default Actions token to read-only must provide a fine-grained token with repository Contents read/write access through that secret.

CI defaults to the production API ID/hash recovered from each upstream's official release binary: Telegram Desktop and AyuGram use Telegram Desktop's credentials, while 64Gram and Materialgram keep their own. Repository secrets `TDESKTOP_API_ID` and `TDESKTOP_API_HASH` may override both values together. Release builds never fall back to `TDESKTOP_API_TEST=ON`.

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
