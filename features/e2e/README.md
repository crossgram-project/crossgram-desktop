# Desktop semantic E2E feature

This opt-in feature adds a loopback-only JSON Lines endpoint backed by Qt's
accessibility tree. It is intended for controlled E2E builds and is not included
by a normal patch/build.

Apply it explicitly:

```bash
yarn apply --target tdesktop --brand cross --root /path/to/tdesktop --feature e2e
```

At runtime, set a loopback port and a random token of at least 32 characters:

```bash
CROSSGRAM_E2E_PORT=43127 \
CROSSGRAM_E2E_TOKEN="$(openssl rand -hex 32)" \
/path/to/CrossTelegram
```

The server never binds a non-loopback interface. Both variables are required;
without them, even an E2E-patched binary does not open the endpoint. Requests and
responses are one JSON object per line. Protocol version 1 supports:

- `ping`: reports readiness and the protocol version;
- `snapshot`: returns the Qt accessibility tree; pass `includeValues: true` to
  include non-password values;
- `action`: locates a node with `selector` and invokes one of its advertised
  accessibility actions;
- `setText`: replaces the text of a semantically located editable node.

A selector may contain `path`, `name`, `objectName`, `role`, and zero-based
`occurrence`. Combining fields narrows the match. The snapshot returns stable
fields such as role, accessible name, object name, class, state, screen bounds,
and supported actions. Paths are only stable for the lifetime of the current UI
tree; prefer names and roles in test scenarios.

Use the bundled client for manual probes:

```bash
yarn e2e:desktop --port 43127 --token "$CROSSGRAM_E2E_TOKEN" --command snapshot
yarn e2e:desktop --port 43127 --token "$CROSSGRAM_E2E_TOKEN" --command action \
  --selector '{"name":"Next","role":"button"}' --action press
```

Password values are always redacted. Requests larger than 1 MiB and semantic
trees deeper than 64 levels or 10,000 nodes are rejected/truncated defensively.

For a fast native API/compile check without building all of Telegram Desktop,
apply the feature to an upstream checkout and configure
`tests/native/e2e/CMakeLists.txt` with `E2E_SOURCE_ROOT` pointing at the patched
`Telegram/SourceFiles` directory. The smoke target compiles the real endpoint
against Qt Core, Gui, Network, and Widgets. After building, run the complete
runtime scenario with:

```bash
yarn e2e:native-smoke --binary /path/to/crossgram_e2e_native_harness
```
