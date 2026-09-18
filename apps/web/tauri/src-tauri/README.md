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

Cold-start deep links still need follow-up: Tao's first-scene connection does
not forward its connection options as an opened-URL event. Warm links work.

Xcode 27 also changes the local build tooling: its SDK requires a deployment
build setting of at least iOS 15. The resolved `swift-rs` 1.0.8 supports Xcode
27's SwiftPM; the previous `--build-system native` workaround is no longer
needed. Tauri CLI 2.11.4 still mistakes simulators returned by `devicectl` for
physical devices. For now use
`cargo tauri ios dev --open` and build the simulator destination with Xcode,
with `IPHONEOS_DEPLOYMENT_TARGET=15.0`. Use Xcode's tools rather than Nix's
Apple SDK/linker for native builds. These are build-time workarounds, not
changes to the app's declared minimum OS version.

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
