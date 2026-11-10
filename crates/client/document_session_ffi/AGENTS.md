# Document session FFI

## What it is

Typed UniFFI adapter for native-view editors and generic document sessions.
Swift and Kotlin bindings ship beside their matching staticlib/cdylib.

## Boundaries

Keep sync, authorization and editing policy in document_session/doc_sync_core.
Handle holds the session mutex only for synchronous model work, never host I/O.
Native view inputs use Native ViewEngine; chatter is disabled. Optional in-process
storage requires doc_store_turso; reject store_path when no executor is configured.
Use typed UniFFI records/enums. Never encode FFI inputs or effects with Bebop or
postcard. Remote definitions mirror native types and are checked by Rust.

## Checks

- `TMPDIR=/home/wolf/tmp cargo test -p document_session_ffi -j2`
- `TMPDIR=/home/wolf/tmp cargo clippy -p document_session_ffi --all-targets -j2 -- -D warnings`
- `TMPDIR=/home/wolf/tmp cargo check -p document_session_ffi --target aarch64-apple-ios-sim -j2`
- `TMPDIR=/home/wolf/tmp cargo check -p document_session_ffi --target aarch64-linux-android -j2`
- `cargo x deps --check`, `just check`, `just pr-privacy`

On Linux, iOS validation stops before linking. Android linking requires an NDK.
Generated bindings live under this crate; Android host integration lives in apps/web/tauri/.

Preserve current commit tags, resolved peer cursors, forced composition end and WAL adoption expected rows at the boundary. Reattach views through ViewDiff without resetting history or synchronization.

Select the actual surface with FfiApplicationConfig; reuse document_session::application_editor_config rather than duplicating registry/policy/clock/entropy setup. Application command/query and plugin payloads cross as typed values.

Read sync_defaults when constructing host configuration; keep timeout, retry, WAL and recovery constants in the shared core.

Use EditorSurface.namespace for rich clipboard export and paste; keep application and portable profile defaults distinct.

Generate application paste facts through clipboard_paste_facts; never mirror their MIME/JSON wire fields in native hosts.

Expose element alignment through its public names: lower unknown raw model numbers to Unset, preserving source empty alignment semantics and leaving stored model bits unchanged.

Resolve snippets through the typed source-state API and return every effect; keep fetch, permission rechecks and source/request lifetime in the host.

Keep production native FFI dependencies on explicit default-features=false with application policy only; never enable session compatibility or foreign nodes in native builds.

Enable model-segmentation explicitly for a feature-stable exhaustive ModifyTarget mirror; never substitute it for a missing required host layout answer.

Observe live authorization through effective_access on either session object; never treat the returned Access as a token for a later input or infer it from construction config or UI locks.
