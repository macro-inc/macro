# Tauri / Mobile Frontend

This crate wraps the shared web client that lives in `src`. There is a
single Vite build that runs identically for web, desktop, iOS, and Android — the
platform is detected at runtime via `getPlatform()` rather than baked into the
bundle.

## Native authentication cookies

The native HTTP plugin stores its cookie jar at `$APPLOCALDATA/.cookies`, which
resolves to `Library/Application Support/<bundle-identifier>/.cookies` on iOS
and macOS. Keep credentials out of `$APPCACHE`: iOS may purge that directory
under storage pressure. The same native jar supplies HTTP and WebSocket cookies;
this is separate from the WebView's browser storage.

Macro passes `$APPLOCALDATA` to the plugin fork's `init_with_cookie_store_dir`;
the plugin owns the `.cookies` filename within that directory. Its default
`init()` still uses the cache directory. Macro deliberately does not migrate
the old cache file, so the first launch after this native update requires
sign-in again. Cookie expiry, refresh, and write behavior are unchanged. This
requires a native app release; an OTA frontend bundle cannot relocate the jar.

## Desktop app icons

Only desktop icons carry the ALPHA badge; iOS and Android icons are unbadged.
The macOS icon uses the badged artwork in the Icon Composer source
`icons/macos/Macro.icon`; this artwork is no longer copied from iOS. The macOS-only
Tauri configuration bundles its compiled `Assets.car` and `Macro.icns`, and
declares the icon names in the hand-maintained `icons/macos/Info.plist`, which
the script below does not overwrite. Tahoe uses the icon
composition; older macOS uses the generated fallback. The artwork has no
baked-in rounded tile or transparent border for macOS to place inside another
enclosure.

After changing the macOS artwork or composition, regenerate with Xcode 26.2:

```sh
bash icons/macos/regenerate.sh
```

The Linux and Windows icons composite the badge from that artwork onto the
unbadged tile in `icons/app-icon.png`. Regenerate them after either changes:

```sh
bash icons/regenerate.sh
```

Commit the source and generated files together. They are checked in so desktop
release builds do not need Icon Composer. Verify Finder and Dock rendering at
both 1× and 2× display scale on Tahoe, and on a pre-Tahoe Mac.

## Diagnosing unexpected WebView reloads

Each frontend startup emits `native_webview_started` to PostHog and a
`native.webview.start` OTel span. The event records the loaded HTML bundle build,
native version and launch ID, and navigation type. Native diagnostics retain
WebContent termination counts/timestamps and bundle-update reload dispatch
counts/last source across WebView replacements. Compare counters within the same
native launch: an increased termination count identifies web content process
recovery; an increased updater count identifies an app-requested update reload
attempt.
Dispatch does not prove the JavaScript reload completed. A new native launch ID
means the host process restarted. Missing counters on an older binary mean
unknown, not zero. The properties are also attached to subsequent PostHog events.
Termination reporting is available on iOS and macOS, including Chromium macOS.
Other platforms mark it unavailable and omit termination counts/timestamps even
when the native snapshot includes an unused zero-valued counter.

The Apple termination callback preserves Tauri's default reload behavior and adds
the native evidence before reloading. It does not establish why the web content
process terminated (for example, memory pressure versus a crash); device
crash/termination reports are needed for that distinction. Native counters
require a full app release, while the frontend remains compatible with older
binaries.

`frontend_instance_id` is generated once per document and attached to every
PostHog event (including automatic exceptions/pageviews) and OTel resource.
`native_instance_id` joins both systems to the host launch. A new frontend ID
with the same native ID establishes a document replacement; SPA navigation
keeps both. OTel export still obeys the existing browser telemetry gate.

Frontend reloads go through `reloadApp(reason)`: automatic cache replacement,
accepted update, failed-load recovery, user recovery, or logout. It saves a
one-shot session-storage marker and asks native to record the request before
reloading, waiting at most 250ms for user-requested reloads. Automatic idle
reloads keep their synchronous timing and send native evidence best effort.
An individual diagnostic IPC timeout stops waiting for that event; three
cumulative timeouts disable further writes for the document. Timed-out requests
remain charged against the 32-request budget because the native invocation may
still be pending.
A native command rejection disables writes immediately. Logout cleanup can
bypass the budget, with the same 250ms wait limit.
The next native startup reports
`requested_reload_*`; stale markers older than 30 minutes are discarded. Native
bundle reload dispatches have their own `native_bundle_reload_last_id` and
`native_bundle_reload_last_dispatch_ms`. These are evidence of intent/dispatch,
not proof of the cause of a termination.

New binaries retain 128 diagnostic events and a separate latest frontend
heartbeat in native memory. Events
cover native foreground/background, WebContent termination, iOS memory warnings,
frontend visibility/connectivity, and explicit reload requests. Keep reload
diagnostics at document/native lifecycle boundaries; UI mount state and streamed
text changes do not establish a reload cause and should not generate native IPC.
The schema accepts no message text, URLs, or content identifiers.
Heartbeats record visibility and connectivity every five seconds while visible
and at visibility transitions; background throttling is expected. They provide
a last-known responsive timestamp, not proof of a hang or its cause.
Heartbeats cannot evict history. Logout clears history and rejects late callbacks.
Recovery also requires a session-storage lease matching the previous document;
logout deletes it before awaiting native IPC. A missing/blocked lease suppresses
replay, so even a failed native clear cannot export the previous account's history.

After replacement, `native_diagnostic_recovered` PostHog events and
`native.diagnostic.recovered` OTel samples report the buffered evidence.
`source_frontend_instance_id` identifies the old document,
`recovered_by_frontend_instance_id` the uploader, and
`native_event_timestamp_ms` the original observation time. OTel samples use that
original timestamp; PostHog captures recovery now and retains the observation
timestamp as a property. Session storage avoids repeated exports; stable
`native_event_id` values permit deduplication if storage is lost. Export is best
effort, not a server-acknowledged delivery queue. The buffer survives WebContent
replacement but not host termination, and a full ring reports dropped events.

UIKit memory warnings support a memory-pressure hypothesis but are not a WebKit
kill reason. No warning does not rule out memory-related termination. Native
history and memory warnings require a rebuilt app; older binaries report
unavailable coverage and receive no periodic diagnostic commands. These additions
are optional and do not raise the minimum native build for OTA bundles.

The new wire types are generated from Rust (Specta is a dev dependency). After
editing the contract, run from the repository root with the development native
environment configured:

```sh
UPDATE_NATIVE_DIAGNOSTIC_TYPES=1 cargo test --manifest-path apps/web/tauri/Cargo.toml --locked -p app -p macro_bundle_updater_plugin --lib --no-default-features diagnostic_wire_types
```

The same tests without that environment variable check for drift.

## Running in development

```sh
# Linux and Windows desktop shell (from this directory)
cargo tauri dev

# macOS desktop shell (from ../desktop-cef, using the macro-cef cargo-tauri CLI)
RUSTUP_TOOLCHAIN=1.95.0 cargo-tauri dev

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
# macOS desktop bundle (Chromium; from the repository root)
nix build --option sandbox false .#tauri-desktop-cef-app

# Linux and Windows desktop bundles (system webview; from this directory)
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
`just ios-build-no-update` remains a compatibility alias. Both modes use
`VITE_POSTHOG_API_KEY` from the environment, fetching it from
Doppler `web-release/prd` if it is unset or empty. Install the Doppler CLI and
authenticate with read access to that config, or supply the variable explicitly.
An unavailable or empty key stops the build before frontend compilation.

Both modes build the frontend with the current shell's toolchain, then select
Xcode's compiler, linker, and tools for the native build and the opened Xcode
session. This avoids Nix's macOS compiler wrapper injecting
`-mmacos-version-min` into an iOS build.
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

GraphQL schema SDL is loaded from the frontend bundle through
`graphql_cache_init_with_schema`; the cache engine and Turso remain native.
Set `MIN_NATIVE_BUILD` to the first native release containing this command before
shipping the corresponding OTA bundle. See [runtime schema behavior](../../../../crates/client/README.md#runtime-graphql-schema)
for compatible additions, queued work, and rollback behavior.

GraphQL hydration checkpoints require the native
`graphql_cache_current_storage_generation` command. When shipping this frontend
through the bundle updater, set `MIN_NATIVE_BUILD_ANDROID` to the first Android
versionCode that implements the command and `MIN_NATIVE_BUILD_IOS` to the first
iOS CFBundleVersion that implements it. Set both together: build numbers are
independent. Production builds (`just build-prod`) read both from
`apps/web/min-native-build.json`; `just ios-bump` raises the iOS one (see
`apps/web/docs/ios-releases.md`). The schema 3 manifest carries
`minNativeBuilds: { android, ios }`;
the endpoint returns the requesting platform's minimum in its existing response.
The updater checks that minimum during extraction, restore, and application.
Old schema 2 updaters reject schema 3 and continue using their existing bundle.
Android cannot receive legacy schema 2 updates because their shared minimum
cannot establish Android compatibility. `MIN_NATIVE_BUILD` remains supported
for iOS/desktop-only schema 2 releases.

Every new native command used by shared JS must raise the corresponding
platform minimum to a binary that implements it. Optional reachability falls
back to browser connectivity if an older native binary lacks the command.
Deploy the updated native_app_service before publishing schema 3 archives;
an old server returns the legacy minimum and the client rejects the mismatch.
Never lower a minimum to force an incompatible update to apply.

macOS notification delivery requires `send_macos_notification`, which uses
UserNotifications for both authorization and delivery. Ship a full macOS native
release containing this command; a frontend-only update cannot repair the legacy
sender. Before publishing this frontend in a desktop OTA archive, set
`MIN_NATIVE_BUILD` to the first native release containing the command. Older
binaries show an update-required notice instead of falling back to the legacy
notification API, which macOS rejects after UserNotifications has been used.

macOS notification activation additionally requires the retained
UserNotifications response delegate, installed before the event loop starts.
`send_macos_notification` embeds the optional `notificationId` in each unique
request identifier. A click restores/focuses the main window and sends the
destination through the existing buffered deep-link bridge. The frontend queues
it until notification navigation is ready, including on cold launch. Dismissal
does not navigate. Ship this native change with the frontend and raise the macOS
`MIN_NATIVE_BUILD` to that release before publishing an OTA archive; older native
builds ignore the added ID and cannot navigate. Previously delivered alerts have
no destination to recover. Verify the [notification walkthrough](../../../../docs/agent-guide/notifications.md)
in an installed macOS bundle before release.

`send_macos_notification` also takes an optional `subtitle` (the conversation),
`threadId` (stacks a conversation's alerts), and `sender` (`id`, `name`,
`avatarUrl`). A sender makes it a communication notification, as on iOS: the
downloaded avatar replaces the app icon and group conversations show their name.
The new arguments are optional, so older frontends and native builds keep
working together. macOS honors this only for an app signed with the restricted
`com.apple.developer.usernotifications.communication` entitlement and
`INSendMessageIntent` in `NSUserActivityTypes`; local and ad-hoc builds show the
plain title and subtitle. A Developer ID build carries the entitlement only with
an embedded provisioning profile, so the release workflow requires the
`MACOS_DEVELOPER_ID_PROVISIONING_PROFILE_BASE64` secret next to the certificate.
Create it in the Apple Developer portal: enable **Communication Notifications**
on the `com.macro.app.prod` App ID, create a **Developer ID** macOS provisioning
profile for that App ID and the certificate, and store the base64 profile as the
secret. The DMG build fails if the profile is missing or does not grant the
entitlement to the bundle identifier; renew the secret when the profile expires.

Linux notification activation requires `send_linux_notification` and
`close_linux_notification`. Ship a full native AppImage containing these commands;
a frontend-only update cannot add clickable system notifications. Before publishing
this frontend as a desktop OTA archive, raise `MIN_NATIVE_BUILD` to that release.
Older Linux binaries show an update-required error rather than silently sending
notifications that cannot be activated. The native sender retains the D-Bus
connection, advertises the default Open action, and forwards activation tokens to
GTK before the existing frontend notification callback navigates. Dismissal never
navigates. This supports the running app, not relaunch after the process exits.

Extraction writes a sibling `<directory>.complete` record only after checksum,
extraction, manifest, and entrypoint validation succeed. Directories without a
matching completion record cannot be reused or restored. Previously cached OTA
bundles lack this record and fall back to embedded assets on the first native
upgrade; a compatible update can then be downloaded again.

Durable email-draft recovery additionally requires
`graphql_cache_inspect_mutations` and queued `client_metadata` support. Set
`MIN_NATIVE_BUILD` to the first full native build containing both before publishing
this frontend as an OTA bundle. The frontend probes this command before claiming
or enqueueing mutations. An older binary uses the existing uncached fallback and
shows an update-required notice; its existing mutation queue stays intact until
the user installs the native update.

## Desktop window state

The desktop window reopens at its last size, position, maximized, and
fullscreen state (`src/window_state.rs`, backed by `tauri-plugin-window-state`).
The `tauri.conf.json` window size only applies to the first launch. A saved
position that no longer lands on a connected monitor is ignored and the OS
places the window. State is written to `.window-state.json` in the app config
directory on quit; delete that file to reset. Mobile is unaffected.

## Desktop native updates

Release builds for macOS Apple Silicon and Linux AppImage check for native updates
after startup and every six hours. Downloads are verified with Tauri's updater
signature before becoming eligible for installation. A ready update installs on
normal app quit; closing/hiding a window only installs if it actually exits the
app. Force-killing loses the in-memory download and the next launch checks again.
No network work is started during quit. Errors retry with backoff.

The ready notification and Settings → Account offer **Restart to update**. Explicit
restart waits for registered canvas/PDF saves and local query persistence, and is
blocked during calls, uploads and imports. Native installation closes the native
cache and excludes concurrent frontend OTA reloads. Neither update channel wipes
user data. Mobile updates remain managed by the app stores. Debug, recording,
branch, and `--no-default-features` builds do not auto-install native updates.

`../desktop-release.json` is the public release configuration; its checked-in
defaults disable updates for local builds. `bun apps/web/scripts/desktop-release.mjs prepare <ref>`
(run from the repository root) updates this tracked file in CI
before Nix evaluates either package. Both packages receive the same native version,
OTA compatibility build number, and source commit timestamp for the embedded
frontend. Existing `vYEAR.MONTH.DAY.REVISION` tags map to
`YEAR.MMDD.REVISION` SemVer, e.g. `v2026.10.6.1` → `2026.1006.1`. Three-part stable
SemVer tags also work. Each component must be at most 9999. Do not reuse a version
or rebuild an already published tag; publish a higher version for fixes/reverts.

The combined desktop workflow is the only publisher. It exports the final
relocated/signed macOS app, notarizes and staples it, and archives it as
`.app.tar.gz`. The Linux AppImage and macOS archive receive updater signatures
outside Nix. `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
live in Doppler `macos-release/prd`, read using the existing
`MACOS_RELEASE_DOPPLER_TOKEN` CI secret. Only the corresponding public key is
committed. Keep this private key: changing the embedded key requires a transition
release signed with the old key.

Versioned GitHub Release assets are immutable. Publication retries reuse and
verify any already-published signatures, since newly generated signatures include
the signing time. The stable manifest is uploaded last to the dedicated
`desktop-stable` prerelease's `latest.json` asset, after both packages and signatures
exist. Promotions are serialized and reject older/equal versions; unrelated SDK
or daemon releases cannot move the desktop update feed. A brief missing manifest
during replacement is treated as a retryable check error.

Bootstrap requires one manual native upgrade: older binaries cannot acquire the
Rust updater through a frontend OTA. Before promoting the first release, test two
consecutive signed builds on installed macOS and Linux apps, including offline
launch, read-only install locations, quit, restart, and preservation of local data.
Builds run directly from a mounted DMG or the Nix store are not writable installed
apps. For a broken release, stop promotion and release the last working code under
a higher version. No automatic crash rollback is implemented.

The Rust coordinator tests exercise the pinned updater against a local HTTP
server with a test-only public key and signed fixture (the test private key is
discarded), including corrupt signatures and older versions. Release metadata tests
run from `apps/web` with `bunx vitest run --project scripts scripts/desktop-release.test.ts scripts/desktop-signing.test.ts`.
Frontend preparation tests are in the web `tauri` Vitest project. Native replacement/notarization still
requires platform release testing; mocked HTTP tests never replace the test runner.

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

macOS sampling uses `proc_pid_rusage`. The sampler recognizes WebKit helpers in
older WKWebView builds; Chromium desktop builds currently report only native
process memory and mark frontend coverage unavailable. WebKit helpers are XPC
processes, so PPID alone is insufficient. Attribution resolves the optional
private libSystem SPI
`responsibility_get_pid_responsible_for_pid` at runtime and includes only known
WebKit helpers whose responsible PID is this app. If the SPI, permissions, or
attribution are unavailable, frontend coverage is explicitly unavailable. Never
sum every WebKit process on the machine. Launch through `open`/LaunchServices:
executing the binary directly from a terminal may attribute helpers to Terminal.
Memory recording is currently macOS-only; normal runtime identification works on
all Tauri platforms. The private attribution API is a compatibility consideration
for future App Store distribution.
