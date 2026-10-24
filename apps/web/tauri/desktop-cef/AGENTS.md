# desktop-cef

Status: shipped macOS desktop app. The desktop release workflow builds it,
packages it as a signed DMG, and publishes the release. The same workflow runs
on pull requests that change desktop build inputs (ad-hoc signed, not
notarized or uploaded) and nightly on main.

## What it is

The macOS desktop app rendered with Chromium (CEF) instead of WKWebView. It is a
thin binary over `../src-tauri` (`app_lib::run_with`) that selects
`tauri-runtime-cef`.

## Scope

- Owns: the macOS Chromium binary, its Cargo workspace and lockfile, and its
  bundle config (`tauri.conf.json`).
- Not here: app behaviour, which stays in `../src-tauri`; iOS, Android, Linux,
  and Windows, which build `../src-tauri` from `../Cargo.toml` on wry.

## Checks

- `RUSTUP_TOOLCHAIN=1.95.0 cargo check --target aarch64-apple-darwin`
- From the repository root on macOS, `nix build --option sandbox false
  .#tauri-desktop-cef-app` builds the unsigned app. Release builds use
  `.#tauri-desktop-dmg` and sign, notarize, and publish that app.
- Bundle: build the frontend inside `nix develop` (`just build-tauri` in
  `apps/web`), then from here run the Tauri CLI built from the `macro-cef`
  branch of `macro-inc/tauri`:
  `RUSTUP_TOOLCHAIN=1.95.0 cargo-tauri build --bundles app -c '{"build":{"beforeBuildCommand":""}}'`.
  The stock `cargo-tauri` does not ship the Chromium framework or helper apps.
- CI: `Build Desktop on Tag` must pass on the pull request. Its
  `Check release secrets` job fails until every secret the release jobs read
  is configured, so add a new secret before merging the change that reads it.

## Gotchas

- Keep this a separate workspace. A `[patch]` applies to every target in its
  workspace, so moving the CEF Tauri patches into `../Cargo.toml` would rebuild
  iOS and Android against the CEF branch.
- `../src-tauri` must resolve `tauri` through `[patch.crates-io]` (a version
  requirement, not a git dependency) so this workspace can repoint it.
- The `cef` feature of `../src-tauri` adds no dependencies; it switches the
  served origin to `http://tauri.localhost` and the `AppRuntime` alias to
  `tauri::DynRuntime`. It only compiles in this workspace.
- The CEF Tauri fork's `on_web_content_process_terminate` callback takes a
  webview and termination details; the regular fork takes only a webview.
  Check both workspaces when changing shared callback registration.
- Needs Rust 1.95 (the repo pins 1.94), `cmake`, and `ninja`; the first build
  downloads about 1 GB of CEF into `~/Library/Caches/tauri-cef`.
- Nix pins Rust 1.95 and the `macro-cef` Tauri CLI separately for macOS. Keep
  `nix/tauri-desktop.nix` on this workspace and CLI; the stock CLI omits the CEF
  framework and helper apps from macOS bundles.
- Keep `entitlements.plist` on the CEF config and the Nix DMG signing step. The
  release signs the unsigned Nix app after bundling, and Chromium needs the JIT
  entitlements under the hardened runtime. Calls and dictation need its camera
  and audio-input entitlements, plus the usage descriptions in
  `../src-tauri/icons/macos/Info.plist`; without either, macOS refuses capture.
- Keep `tauri.conf.json` aligned with `../src-tauri/tauri.conf.json` and
  `tauri.macos.conf.json`: the CLI bundles from this file, while the app's
  runtime config still comes from `../src-tauri`.
