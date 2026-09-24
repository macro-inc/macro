# Tauri / Mobile Frontend

This crate wraps the shared web client that lives in `src`. There is a
single Vite build that runs identically for web, desktop, iOS, and Android — the
platform is detected at runtime via `getPlatform()` rather than baked into the
bundle.

## Running in development

```sh
# Desktop shell (macOS/Linux/Windows)
cargo tauri dev

# iOS simulator
cargo tauri ios dev

# Android emulator
cargo tauri android dev
```

The `beforeDevCommand` is `just dev-tauri`, which runs `bun run dev` against the
single `vite.config.ts`.

You can override the dev server host for devices/emulators by exporting
`TAURI_DEV_HOST` before running `cargo tauri …`.

Default native logging keeps Turso at `warn`, including Debug builds: its
per-record/page debug spans are expensive through iOS OS activity logging.
Application and Tao debug logs remain enabled in Debug builds. An explicit
`RUST_LOG` still overrides the defaults; opt into Turso debug logs only for a
focused diagnostic, not startup/performance measurements. Persistent-cache startup
and explicit integrity checks are described in the
[cache guide](../../../../crates/client/README.md#startup-and-integrity-checks).

The native workspace also optimizes the `turso_core` dependency in Debug builds
and disables only that dependency's internal debug assertions. Its per-cell B-tree
validation otherwise makes large read-only filter queries unrepresentative of
release execution. The app and cache adapters remain debuggable, and their schema,
codec, scope, and queued-write validation is unchanged. Root-workspace storage tests
still exercise the ordinary Debug VM; native integration tests exercise this
optimized dependency profile.

## iOS 27 scene lifecycle

Apps built with the iOS 27 SDK must use the scene lifecycle. Keep the
`UIApplicationSceneManifest` in `Info.ios.plist`,
`gen/apple/app_iOS/Info.plist`, and `gen/apple/project.yml` in sync:

- The fork at `957785f5` uses Tao 0.37, which enables the scene lifecycle from
  the manifest independently of multi-window support. Keep
  `UIApplicationSupportsMultipleScenes` false to retain Macro's single-window
  behavior on both iPhone and iPad.
- Declare `TaoScene` under
  `UISceneConfigurations.UIWindowSceneSessionRoleApplication`.
- Tao registers the delegate dynamically; do not add a separate Swift delegate.
- Mobile foreground handling uses `RunEvent::WindowEvent` containing
  `WindowEvent::Resumed`, not top-level `RunEvent::Resumed` or `Focused(true)`.
  This preserves bundle-update retries on resume without triggering them for
  ordinary focus changes. The event variant and handler are gated to mobile.

The Tao patch in `../Cargo.toml` pins `macro-inc/tao` at `6cbc7628`. It backports
[tao#1257](https://github.com/tauri-apps/tao/pull/1257), including the review's
nullable-accessor fix: cold-start URL contexts and browsing-web activities
are forwarded through the same `Opened` event path as warm links. Nil launch
options are treated as an ordinary launch, not a panic. Macro's existing
frontend-ready buffer handles early delivery; no extra navigation path is needed.

Normal startup and cold/warm custom-scheme links were exercised on iOS 27;
logs showed one event per tested link. Universal-link extraction/filtering is
covered by simulator-executed Tao tests. Signed associated-domain delivery,
physical devices, iOS 26, and share-sheet flows still need end-to-end testing.
See the fork's [FORK.md](https://github.com/macro-inc/tao/blob/6cbc7628f91db2c5ce588719bf8ba6f2dd6fc1c8/FORK.md)
for provenance and verification. Remove the patch once a compatible Tao release
includes both the cold-start fix and nil handling.

The app and both extensions now require **iOS 15 or later**, matching Xcode
27's minimum supported deployment target. This drops iOS 14 support. The Tauri
configuration, XcodeGen source, and generated debug/release build settings all
use 15.0; no command-line deployment-target override is needed.

The resolved `swift-rs` 1.0.8 supports Xcode 27's SwiftPM; the previous
`--build-system native` workaround is no longer needed. Tauri CLI 2.11.4 still
mistakes simulators returned by `devicectl` for physical devices. Use
`cargo tauri ios dev --open` and build the simulator destination with Xcode.
Use Xcode's tools rather than Nix's Apple SDK/linker for native builds.

Checked-in configuration tests and the normal/cold/warm/resume simulator smoke
runner are documented in [iOS verification](../../tests/native/ios/README.md).
That guide also records the remaining release checks and a separate legacy
document-rendering finding; passing the smoke test is not full iOS 26/27 parity.

## Building bundles

```sh
# Desktop bundle
cargo tauri build

# iOS / Android release artifacts
cargo tauri ios build
cargo tauri android build
```

The `beforeBuildCommand` is `just build-tauri`, which runs `bun run build` and
emits the frontend into `dist`. Tauri then packages that output
according to `tauri.conf.json`.

## Automated offline tests (Linux)

See [native E2E](../../tests/native/README.md) for the isolated WebDriver setup,
fixture-backed backfill smoke test, and offline Mail filter regression. Use
`nix develop .#tauri-e2e`; this exercises the native cache, not browser WASM.

## Platform aware UI

Use the helpers in `@core/util/platform` (`isTauri()`, `getPlatform()`,
`isMobilePlatform()`, etc.) anywhere you need to branch behaviour, register
extra routes, or mount native-only UI. Pair those checks with the
`MaybeTauriProvider` from `@macro/tauri` to keep native-specific wiring
localized while rendering everything through the shared `src` entry
point.
