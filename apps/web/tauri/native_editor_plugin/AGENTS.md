# Native Android editor host

## What it is

Android text view and Tauri placement adapter over document_session_ffi.
The native host is under development; application-wide parity remains an
acceptance requirement before changing the feature-flag admission.

## Start here

- `android/src/main/java/com/macro/editor/EditorProjection.kt`: keyed diff and UTF-16 mapping.
- `android/src/main/java/com/macro/editor/NativeEditorView.kt`: Android input and session effects.
- `android/src/main/java/com/macro/editor/NativeSessionHost.kt`: serialized callbacks, timers and graceful lifetime.
- `android/src/main/java/com/macro/editor/NativeSessionStorage.kt`: transactional SQLite and live-owner leases.
- `crates/client/document_session_ffi`: generated native API and binding regeneration.

## Boundaries

- Keep editing, history and synchronization policy in the shared Rust session.
- Execute host effects after the FFI call returns, and report durable writes only
  after the storage transaction commits.
- Match mount generations before applying asynchronous callbacks or focus changes.
- Check the process-wide lease registry before opening a lease file; use one channel per live OS lease.
- Use a non-destructive SQLite corruption handler and preserve the original database files.
- Preserve composing spans when applying text patches and Android selection handles.
- Do not enable reduced node rendering as a substitute for application parity.

## Checks

- Use Java 21, Android platform/Build Tools 36 and NDK 30.
- Limit Gradle to `--max-workers=4`, and Cargo to `-j2`.
- Run unit and connected instrumentation tests; compile instrumentation when no
  emulator is available. Record the distinction in the acceptance report.
