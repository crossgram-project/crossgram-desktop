# Crossgram Desktop patcher

This repository applies opt-in features to Telegram Desktop forks without using Git patch files. The first feature, `server-switch`, adds a per-account MTProto server selector to the sign-in UI.

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
yarn apply --target tdesktop --root /path/to/tdesktop
```

Target ids are `tdesktop`, `tdesktop-x64`, `ayugram`, and `materialgram`. Applying the patch repeatedly is supported and produces no duplicate code.

The patcher performs unique, structural edits around C++ function bodies, declarations, includes, and CMake source lists. A missing or ambiguous anchor is a hard failure. Large injected implementations live in [`features/server-switch`](features/server-switch), while [`patch.ts`](features/server-switch/patch.ts) contains the integration logic.

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

[`check.yml`](.github/workflows/check.yml) resolves and patches all four latest upstream releases in parallel. Matrix fail-fast is disabled, so a broken upstream does not cancel the others.

[`release.yml`](.github/workflows/release.yml) builds a 4-client × 3-platform matrix for Windows, Linux, and macOS. Successful artifacts are grouped and published per client; one client's failure does not block the other release jobs. A platform asset that already exists is skipped, while a previously failed or missing platform is retried on the next run. A manual run can set `force` to rebuild every asset.

For production Telegram access, define repository secrets `TDESKTOP_API_ID` and `TDESKTOP_API_HASH`. Without them, CI passes `TDESKTOP_API_TEST=ON`; those artifacts are useful for build validation but do not contain production API credentials.

Release tags use this form:

```text
crossgram/<target-id>/<upstream-release-tag>
```

## Development checks

```bash
yarn check
yarn build
```

The TypeScript test suite covers structural function matching, CRLF preservation, ambiguous-anchor rejection, and the supported-target registry.
