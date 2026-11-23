# desktop-cef

Status: shipped macOS desktop app. The desktop release workflow builds it,
packages it as a signed DMG, and publishes the release.

## What it is

The macOS desktop app rendered with Chromium (CEF) instead of WKWebView. It is a
thin binary over `../src-tauri` (`app_lib::run_with`) that selects
`tauri-runtime-cef`. It runs on Apple silicon Macs with macOS 14 (Sonoma) or
later, the newest minimum of the binaries it bundles.

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

## Driving a local build over CDP

To reproduce a frontend bug in Chromium as the app runs it, run a dev build
against a Vite server and drive it with Playwright `connectOverCDP`:

- Patch `src/main.rs` locally (never commit it) so the runtime listens for CDP
  and keeps its profile out of the installed app's cache:
  `.remote_debugging(tauri_runtime_cef::RemoteDebugging::Port { port: 9334, allowed_origins: vec![] })`
  and `.root_cache_path("<scratch dir>")` on the `Cef` builder.
- `echo development > ../src-tauri/.macro-tauri-env` (gitignored). Without it
  `build.rs` needs a built `dist/`.
- Build the CLI once from the `macro-cef` checkout cargo already fetched
  (`~/.cargo/git/checkouts/tauri-*/4b8a46f`):
  `RUSTUP_TOOLCHAIN=1.95.0 cargo build --release -p tauri-cli`. Put `ninja` on
  `PATH` (`nix shell nixpkgs#ninja`) and point `CEF_PATH` at a disk with room.
- From here:
  `RUSTUP_TOOLCHAIN=1.95.0 <cli>/cargo-tauri dev --no-watch -c '{"identifier":"com.macro.app.<name>","productName":"Macro <name>","build":{"beforeDevCommand":"","devUrl":"http://localhost:3009/<page>"}}'`.
  A separate identifier keeps the build off the installed app's Application
  Support data and single-instance lock. The webview renders only
  `localhost:3000`–`3009` (`ALLOWED_DOMAINS` in `../src-tauri/src/lib.rs`) and
  opens any other origin in the system browser.
- `chromium.connectOverCDP('http://127.0.0.1:9334')` then drives the page.
  Backend-free browser-test fixtures (`*.html` under a feature's
  `browser-test/`) load as the dev URL with no sign-in.

CDP input enters Chromium's input pipeline as a real click does, so it reaches
the same renderer code, but it skips AppKit's event timing.

## Gotchas

- `bundle.macOS.minimumSystemVersion` in `tauri.conf.json` is the app's
  `LSMinimumSystemVersion`; macOS refuses to open the app on anything older.
  Keep it at the highest `minos` (`otool -l`) of any binary in the bundle,
  since dyld won't load a library built for a newer macOS. Today that is 14.0,
  from the Nix-built `libiconv`, `libcharset` and `macrod` (nixpkgs' default
  Darwin target); Chromium's own is `mac_min_system_version` in its
  `build/config/mac/mac_sdk.gni` (13.0 on CEF 151). When a CEF or nixpkgs bump
  raises one, raise this value in the same change and tell whoever owns the
  download pages and customer docs, which state the requirement. The release's
  `Validate signed DMG` step fails while it is lower than any binary's `minos`.
  The update feed carries the value, and installed apps on an older macOS skip
  that release (`../src-tauri/README.md#desktop-native-updates`).

- Keep this a separate workspace. A `[patch]` applies to every target in its
  workspace, so moving the CEF Tauri patches into `../Cargo.toml` would rebuild
  iOS and Android against the CEF branch.
- A dependency change in `../src-tauri` or a shared plugin updates both
  lockfiles: run `cargo metadata --format-version 1 > /dev/null` here as well as
  in `..`. A new git dependency also needs its `outputHashes` entry on both
  vendor dirs in `nix/tauri-desktop.nix`. The `check tauri lockfiles` PR
  workflow fails when either lockfile is stale (`cargo update --workspace
  --locked`); otherwise only the macOS release build would. When a lockfile or
  Nix input changes it also builds the vendor dirs
  (`nix build .#checks.x86_64-linux.tauri-cargo-lockfiles`).
- `../src-tauri` must resolve `tauri` through `[patch.crates-io]` (a version
  requirement, not a git dependency) so this workspace can repoint it.
- The `cef` feature of `../src-tauri` adds no dependencies; it switches the
  served origin to `http://tauri.localhost` and the `AppRuntime` alias to
  `tauri::DynRuntime`. It only compiles in this workspace.
- The CEF Tauri fork's `on_web_content_process_terminate` callback takes a
  webview and termination details; the regular fork takes only a webview.
  Check both workspaces when changing shared callback registration.
- Needs Rust 1.95 (the repo pins 1.94), `cmake`, and `ninja`; the first build
  downloads about 1 GB of CEF into `~/Library/Caches/tauri-cef`. That CDN build
  has no H.264, HEVC, or AAC, so most videos won't play in a local build; set
  `CEF_PATH` to an extracted codec distribution (below) to test media.
- Releases embed CEF built with proprietary codecs, pinned in `cef-codecs.json`
  and laid out by `nix/tauri-desktop.nix`; Nix evaluation fails if that pin
  doesn't match the `cef` crate in `Cargo.lock`. While `sha256` is empty, Nix
  warns and builds with the codec-less CDN CEF. To bump the `cef` crate, put
  the new CDN version (`cefVersion`, its `g<hash>` as `cefCommit`, the Chromium
  branch) and a new `releaseTag`/`asset` in the manifest with an empty `sha256`
  on a PR. The `Build CEF with codecs` workflow then builds and publishes it
  (several hours on the large Mac runner); copy the sha256 from its run summary
  into the manifest.
- Nix pins Rust 1.95 and the `macro-cef` Tauri CLI separately for macOS. Keep
  `nix/tauri-desktop.nix` on this workspace and CLI; the stock CLI omits the CEF
  framework and helper apps from macOS bundles.
- Keep `entitlements.plist` on the CEF config and the Nix DMG signing step. The
  release signs the unsigned Nix app after bundling, and Chromium needs the JIT
  entitlements under the hardened runtime. Calls and dictation need its camera
  and audio-input entitlements, plus the usage descriptions in
  `../src-tauri/icons/macos/Info.plist`; without either, macOS refuses capture.
  The ast-grep rules `plist-media-entitlements` and `plist-media-usage-strings`
  check both.
- Keep the HTTP/WebSocket fork revision and Nix source hash aligned with the
  shared native workspace; native cookies use Application Support as documented
  in `../src-tauri/README.md#native-authentication-cookies`.
- The app hosts Chromium in Alloy style, which has no screen picker and refuses
  `getDisplayMedia()`. Screen sharing goes through Macro's picker and
  `../src-tauri/src/screen_capture.rs`: `main.rs` registers
  `on_desktop_capture_request` (a hook of the `macro-cef` fork), which grants a
  desktop capture only right after the user picks a source.
- Keep `tauri.conf.json` aligned with `../src-tauri/tauri.conf.json` and
  `tauri.macos.conf.json`: the CLI bundles from this file, while the app's
  runtime config still comes from `../src-tauri`.
- Keep `SecretStorage::Mock` in `src/main.rs`. With the system store, Chromium
  keeps its cookie key in a "Chromium Safe Storage" keychain item and macOS asks
  for keychain access on launch. The app's sign-in uses the native HTTP cookie
  jar, so Chromium's own cookies (embeds) are all the mock key covers;
  switching key sources drops those cookies once.
