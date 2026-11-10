# Native Android editor host

## What it is

Android text view and Tauri placement adapter over document_session_ffi.
The native host is under development; application-wide parity remains an
acceptance requirement before changing the feature-flag admission.
Android registration exposes bridge commands; it does not select native editing surfaces.

## Start here

- `android/src/main/java/com/macro/editor/EditorProjection.kt`: keyed diff and UTF-16 mapping.
- `android/src/main/java/com/macro/editor/NativeEditorView.kt`: Android input and session effects.
- `android/src/main/java/com/macro/editor/NativeEditorMenu.kt`: native popup navigation and generation-bound provider replies.
- `android/src/main/java/com/macro/editor/NativeInputConnection.kt`: SDK-isolated modern IME methods.
- `android/src/main/java/com/macro/editor/NativeSessionHost.kt`: serialized callbacks, timers and graceful lifetime.
- `android/src/main/java/com/macro/editor/NativeSessionStorage.kt`: transactional SQLite and live-owner leases.
- `android/src/main/java/com/macro/editor/NativeSessionAdapters.kt`: storage worker and direct WebSocket I/O.
- `android/src/main/java/com/macro/editor/NativeEditorSurfaces.kt`: account/surface lifetime, permissions and callbacks.
- `android/src/sharedTest/java/com/macro/editor/NativeClipboardPolicyScenario.kt`: real clipboard code/large-plain policy controls.
- `android/src/androidTest/java/com/macro/editor/NativeEditorTestActivity.kt`: standalone device test window; never a production surface.
- `schema/bridge.schema.json`: source of the Rust, Kotlin and TypeScript bridge types.
- `crates/client/document_session_ffi`: generated native API and binding regeneration.

## Boundaries

- Keep editing, history and synchronization policy in the shared Rust session.
- Execute host effects after the FFI call returns, and report durable writes only
  after the storage transaction commits.
- Reject stale menu identities at both bridge endpoints and validate the exact native query span again in the shared model; close popups on blur, locks and unmount.
- Release pending menu picks only on their matching commit or explicit row rejection; finish active composition and revalidate identity before selecting a row.
- Match mount generations independently of session generations before placement, focus or unmount; clear pending mount configuration on unmount.
- Retain retired surface generations until the account changes; never reuse a stopped generation.
- Check the process-wide lease registry before opening a lease file; use one channel per live OS lease.
- Use a non-destructive SQLite corruption handler and preserve the original database files.
- Preserve composing spans when applying text patches and Android selection handles.
- Route physical editing shortcuts through KeyDown with their real modifier facts before the typed command; preserve model-returned history selection and subtree identities.
- Keep decorators atomic in the editable buffer; cache model-owned facts by generation-aware key and invalidate them from decorator/property effects before repainting.
- Do not enable reduced node rendering as a substitute for application parity.
- Keep editor editability, content-interaction permission and comment capability distinct; recheck permission when committing gestures or asynchronous results.
- Observe effective session access through the generated getter after authorization changes; initial configuration and UI locks are not current authorization, and each later input must still pass normal session admission.

## Checks

- Use Java 21, Android platform/Build Tools 36 and NDK 30.
- Run `scripts/check-android-apk.py APK` on linked APKs to check ABI completeness, 64-bit ELF alignment and 16 KB ZIP alignment.
- Limit Gradle to `--max-workers=4`, and Cargo to `-j2`.
- Run unit and connected instrumentation tests; compile instrumentation when no
  emulator is available. Record the distinction in the acceptance report.
- Run `scripts/generate-bridge.ts --check` and `scripts/android-check.ts` from the configured devshell.
- Check and strictly lint `tauri-plugin-native-editor` in the Tauri Cargo workspace for the Android target.

Consume full-width decorator revision operations exhaustively and refresh cached model facts on native sidecar invalidation keys; a native diff alone does not acknowledge signature consumption.
