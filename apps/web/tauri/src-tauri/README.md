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

From `apps/web`, use `just ios-dev` (or `PORT=3001 just ios-dev`) to open Xcode
with the native toolchain configured. It prepares WASM with the original shell
environment, then uses the same Xcode compiler/linker setup as `just ios-build`.
This also applies to macOS build scripts and proc macros compiled for the host;
mixing Nix's linker with Xcode's SDK can fail with `library not found for -liconv`.
Tauri starts and manages the Vite server after preparation. Keep `just ios-dev`
running while building in Xcode, and restart it after changing these scripts.

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

From `apps/web`, use `just ios-build` for a release build or
`just ios-build --no-update` to disable automatic bundle updates.
`just ios-build-no-update` remains a compatibility alias. Both modes build the
frontend with the current shell's toolchain, then select Xcode's compiler,
linker, and tools for the native build and the opened Xcode session. This avoids
Nix's macOS compiler wrapper injecting `-mmacos-version-min` into an iOS build.
The system `xcode-select` selection is used unless `DEVELOPER_DIR` explicitly
selects an Xcode installation. Keep the recipe running while building in Xcode
so Tauri's options server can supply the build configuration and tool paths.
The native build keeps the selected Rust toolchain and forwards its compiler
to Xcode. Both device and simulator targets are declared in the root
`rust-toolchain.toml`, which also defines Nix's pinned Fenix toolchain. Re-enter
`nix develop` after pulling target changes; Nix's `rustup` shim cannot install
targets into an existing shell. The launcher fails early if the device standard
library is missing. These are local Xcode build recipes; reproducible release
builds also require a pinned Xcode/SDK environment.

The iOS recipes and Xcode's Rust build phase both set `TMPDIR` to macOS's
per-user temporary directory (`getconf DARWIN_USER_TEMP_DIR`). Tauri CLI finds
its options server there before restoring the build environment. Inheriting
Nix's shell-specific `TMPDIR` can leave Xcode connecting to a stale server after
restarting `nix develop`, even while the new CLI process is running. Keep the
build phase in `gen/apple/project.yml` and the generated project in sync.
For direct `cargo tauri ios` invocations from Nix, first run
`export TMPDIR="$(/usr/bin/getconf DARWIN_USER_TEMP_DIR)"` as well.

The Rust library emits `staticlib` for iOS and `cdylib` for Android. Cargo emits
both outputs on iOS, but Xcode links only the static archive into the app.
CallKit's Swift package is part of Xcode's dependency graph, so `build.rs` permits
its initializer to remain unresolved only in the unused iOS dylib. The final
Xcode app link must still resolve `init_plugin_call_kit` from the Swift package.
Do not remove Android's `cdylib` output or disable undefined-symbol checking
globally to work around an iOS link failure.

GraphQL hydration checkpoints require the native
`graphql_cache_current_storage_generation` command. When shipping this frontend
through the bundle updater, set `MIN_NATIVE_BUILD` to the first native build that
includes that command. Older binaries must receive a native update before this
bundle; they cannot validate a saved hydration cursor against the cache database.

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

## Desktop memory recording (macOS)

The frontend tags traces and logs with `app.runtime=tauri`, `app.platform`,
`service.instance.id` (a new UUID per native launch), `macro.native.pid`, and
`macro.native.version`. The shared `service.name=web-app` remains unchanged.
Browser sessions instead have `app.runtime=browser`.

Quit an existing Macro instance first, then launch the built **app bundle**:

```sh
open -a /absolute/path/to/Macro.app --args --record-memory \
  --otel-traces-url https://macro-prox-prod.macroverse.workers.dev/i/otlp/v1/traces
```

For dev telemetry use `https://macro-prox-dev.macroverse.workers.dev/i/otlp/v1/traces`;
for a local collector use its full HTTP `/v1/traces` URL. The endpoint is required
and applies to this launch only; the corresponding `/v1/logs` endpoint is derived
from it. No collector credentials are embedded in the app. Selecting a telemetry
endpoint does not change which backend the frontend uses.

Recording explicitly enables the frontend OTel SDK regardless of the normal
PostHog/build-time enablement gate and uses an always-on sampler for emitted
frontend spans. This does not override sampling/drop policies in a downstream
collector or backend, or add traces to operations that have no instrumentation.
The title bar shows `Recording <short ID>`; the full `macro.recording.id` and
`service.instance.id` appear in the startup telemetry log. Quit to stop recording.
Launching again creates new IDs. A second launch while Macro is already running
is handled by the existing single-instance plugin and does **not** enable recording
in the running instance. Automatic bundle updates are disabled for a recording
launch so the measured frontend stays on the embedded build.

A native thread samples once per second, retaining at most one hour in memory.
The frontend drains the samples, emits timestamped `app.memory.sample` spans, and
attaches the latest reading to every frontend span at start and at end (the latter
attributes end in `.end`). Readings older than five seconds are tagged `stale` and
are not attached as current memory. Buffer overflow is reported in a telemetry
warning. Reloads reuse the native session; a per-webview sessionStorage cursor
avoids replaying samples already handed to the exporter. Export uses the existing
bounded, best-effort OTel batch transport; this is not a durable local recording,
and abrupt exit, export failures, or buffer overflow can lose telemetry.

Memory fields (bytes):

- `macro.memory.native.{rss_bytes,footprint_bytes}`: Rust host process.
- `macro.memory.web_content.{rss_bytes,footprint_bytes}`: frontend WebContent processes.
- `macro.memory.gpu.*` / `macro.memory.network.*`: attributed WebKit helpers.
- `macro.memory.frontend.footprint_bytes`: sum of measured WebKit helper footprints.
- `macro.memory.app.footprint_bytes`: native + frontend footprint sum, present only
  when the native host and WebContent were measured with no helper-read failures.
- `macro.memory.frontend.status`: `available`, `partial`, or `unavailable`.
- `macro.memory.timestamp_ms` / `sample_age_ms`: native sample time and its age.

These are process memory measurements, not JavaScript heap/allocation profiles.
RSS and macOS physical footprint have different accounting; sums are explicitly
process sums and need not equal Activity Monitor's app total.

macOS sampling uses `proc_pid_rusage`. WebKit helpers are XPC processes, so PPID
alone is insufficient. Attribution resolves the optional private libSystem SPI
`responsibility_get_pid_responsible_for_pid` at runtime and includes only known
WebKit helpers whose responsible PID is this app. If the SPI, permissions, or
attribution are unavailable, frontend coverage is explicitly unavailable. Never
sum every WebKit process on the machine. Launch through `open`/LaunchServices:
executing the binary directly from a terminal may attribute helpers to Terminal.
Memory recording is currently macOS-only; normal runtime identification works on
all Tauri platforms. The private attribution API is a compatibility consideration
for future App Store distribution.
