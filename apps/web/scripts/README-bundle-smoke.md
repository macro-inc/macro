# Local desktop bundle update smoke test

This exercises the real native downloader, SHA-256 verification, ZIP extraction,
bundle selection, webview reload and cache restoration. It updates the embedded
web frontend; it does **not** replace the native app executable or installer.
The fixture server publishes only to this machine, with no remote deployment.

From `apps/web`, build a deterministic baseline using the normal Tauri frontend
recipe (inside the repository Nix environment for WASM builds):

```sh
BUNDLE_BUILD_NUMBER=100 MIN_NATIVE_BUILD=0 just build-tauri
bun scripts/smoke-bundle-updater-server.ts older --host 127.0.0.1 --port 3001
```

Use a free port, updating every URL below if 3001 is occupied. The server copies
`dist` into ignored `.bundle-smoke` fixtures; the embedded baseline stays intact.
Each archive contains a matching manifest and HTML build ID plus a visible
`OTA smoke build <number>` badge. Restart the server after changing `dist`.

In a second terminal, build the isolated macOS app from `apps/web/tauri/src-tauri`:

```sh
MACRO_BUNDLE_UPDATE_BASE_URL=http://127.0.0.1:3001 \
  cargo tauri build --bundles app --ci --no-sign \
  --config '{"identifier":"com.macro.app.ota-smoke","productName":"Macro OTA Smoke","app":{"windows":[{"title":"Macro OTA Smoke","width":1000,"height":700}]},"plugins":{"deep-link":{"desktop":{"schemes":["macro-ota-smoke"]}}},"build":{"beforeBuildCommand":"","frontendDist":"../../dist"}}' \
  -- --locked
codesign --force --deep --sign - '../target/release/bundle/macos/Macro OTA Smoke.app'
open '../target/release/bundle/macos/Macro OTA Smoke.app'
```

Use Apple's SDK/linker for the native macOS build. The override URL is compiled
into the binary; setting it only when launching has no effect. Keep default
Cargo features enabled, and do not launch with `--record-memory`: both
`--no-default-features` and recording mode disable automatic bundle updates.
The distinct identifier isolates caches, cookies and app data; the distinct
URL scheme preserves the normal app's `macro:` handler. Do not change or clear
the installed Macro app's cache for this test.

`CARGO_TARGET_DIR` may point at an existing desktop build cache to reuse compiled
dependencies. Build outputs then live under that target directory instead of
`../target`; use that path for signing and opening. Never run simultaneous Cargo
builds against the same target directory. Changed local crates/configuration
still rebuild, so an old app bundle is not a substitute for this build.

1. **Baseline / no downgrade:** the server should log `darwin/aarch64 current=100
   native=0 scenario=older` (or `x86_64`). There should be no fixture badge.
2. **Deliver an update:** run `curl -X POST
   http://127.0.0.1:3001/__scenario/update-101`, then quit/relaunch the isolated app
   to start a fresh check. Wait for the archive to download. Hide or minimize the
   app so the frontend applies the completed update; quit/relaunch also restores
   completed downloads. Confirm the badge reads `OTA smoke build 101` and the
   server receives a follow-up check with `current=101` after reload acknowledgement.
3. **Persistence:** quit and reopen. Confirm build 101 still appears, without
   another archive download. The isolated cache is normally under
   `~/Library/Caches/com.macro.app.ota-smoke`, with `bundle_root` pointing to the
   selected numeric bundle directory.
4. **Revocation:** switch to `/__scenario/revoke-101`, then quit/relaunch. Hide or
   minimize after the check if necessary. Confirm the badge disappears and a
   follow-up check reports `current=100`. Reopen once more and confirm 101 does
   not return. Rollback persists an explicit `embedded` selection in `bundle_root`;
   old absolute-path selections and completed-download markers remain readable.
5. **Compatibility:** switch to `/__scenario/incompatible-102`, then quit/relaunch.
   Confirm the native-update-required dialog appears and no 102 archive is used.
6. Quit the smoke app and stop the server. Keep the normal app installed; no
   production update was published. Remove the isolated app/cache only when no
   longer needed for inspection.

Desktop checks currently run at startup, not on a periodic timer or ordinary
focus changes. The Settings update controls are mobile-only. This is why these
steps relaunch to initiate each check. Desktop reports native build `0`, so the
compatible fixtures require `minNativeBuild: 0`. The 102 fixture deliberately
requires `999999`.

Desktop downloads use any available connection, including VPNs and connections
whose type cannot be classified. They may therefore use a metered connection;
HTTP failures remain normal download errors. iOS and Android still wait for
Wi-Fi/Ethernet unless the user explicitly selects **Download anyway**. This
avoids a desktop VPN interface such as `utun0` being mistaken for unavailable
Wi-Fi and leaving a reachable update waiting forever.

Automated fixture regression tests:

```sh
bunx --bun vitest run --project scripts scripts/smoke-bundle-updater-server.test.ts
```

Updater domain/transport tests, from the repository root with `SQLX_OFFLINE`
unset:

```sh
cargo test --manifest-path apps/web/tauri/Cargo.toml -p macro_bundle_updater_plugin --locked
```

The fixture tests validate actual ZIP bytes, manifest/document generation IDs,
checksums and scenario responses. The Rust tests cover selection, compatibility,
cache persistence, revocation, download gating, reload acknowledgement and asset
boundaries. Neither suite by itself proves the native webview reload; the manual
steps above provide that coverage.
