# Document session WASM

## What it is

The production cdylib for portable editor and generic document sessions.
The generated Bebop schema and flat Diff stream are the only cold wire contract.
Hot editor inputs use wasm-bindgen primitives and reject lone UTF-16 surrogates.
TextFromView returns zero only for an exact accepted DOM edit; all other outcomes
include authoritative text or full view repair, including permission rejection,
stale/non-text keys and malformed UTF-16. A cold `initialize` rebuilds only the
view. ABI major 2 includes static type predicate flags and initialize markers.

## Start here

- `abi/session.bop`: authoritative ABI, generated constants and messages.
- `src/machine.rs`: clocks, lifecycle and one handle call per input.
- `src/output.rs`: owned output envelope and raw framed socket bytes.
- `src/editor_input.rs`: explicit cold model input adapter; Input has no wire derives.
- `src/query.rs`: portable HTML, Markdown, clipboard and model queries.
- `src/router.rs`: shared RouterCore boundary; outer protocol remains unframed.
- `src/telemetry.rs`: content-free cold native spans forwarded to the host.
- `src/storage.rs`: durable metadata conversions; no storage I/O in Rust.
- `packages/collaboration/src/session/`: JS executor and browser adapters.

## Boundaries

Sync policy, authorization, history and retries remain in document_session/doc_sync_core.
Hosts own clocks, identities, transport, storage and telemetry. Generated artifacts ship
with their glue in one bundle. ABI major mismatch is fatal; no fallback decoding.
Carry the exact WAL adoption selection across the ABI, including delivered flags and bytes.
Compile release WASM tracing at INFO to match HostSubscriber; preserve emitted cold spans and native tracing.
Preserve keystroke work counters when changing code-generation or post-processing settings.

## Checks

- `cargo test -p document_session_wasm -j4`
- `cargo check -p document_session_wasm --target wasm32-unknown-unknown -j4`
- `cargo clippy -p document_session_wasm --all-targets -j4 -- -D warnings`
- `just -f apps/web/justfile build-document-session-wasm`
- `bun packages/collaboration/scripts/generate-session-schema.ts --check`
- `cargo x deps --check`, `cargo shear`, `just check`, `just pr-privacy`

Set TMPDIR for cargo. Never edit generated files by hand. Keep package registration,
preload rules and size checks aligned with nix/tauri-desktop.nix and apps/web/justfile.
