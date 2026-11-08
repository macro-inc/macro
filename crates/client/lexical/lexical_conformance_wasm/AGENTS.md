# Lexical conformance WASM

## What it is

Development-only raw-model transaction facades for differential conformance.
Never import them from production crates or bundles.

## Start here

- `src/host.rs`: native-core EditorHandle indexed dispatch over a moved-out Session lease; JS conversions run outside that lease. Runtime transforms/listeners use scoped current-hook reborrows; foreign node classes and read-only API scopes are not wired yet.
- `src/host_commands.rs`: opaque JS application-command envelope over the model extension pipeline, filtering identities before JS; the future shim supplies identity strings and handles parent-editor propagation.
- `src/host_callbacks.rs`: single-threaded JS transform ownership, exact-owner scoped reborrows, callback identity dedup and opaque exception transport. Never recover an ancestor transaction pointer or hold a metadata lock over JS.
- `src/host_packet.rs`: development postcard envelope carrying the existing flat diff and changed base-record/mutation/selection metadata; production uses the session codec.
- `examples/export_host_types.rs`: generate/check the Specta packet declaration with the web formatter.
- `src/debug.rs`: actual export-entry, logical payload-byte and editor-facade lifetime counters; raw WASM must pass through instrument_exports before crossing measurements.
- `build.rs`: build-time syn derivation of fixed scalar/receiver input sizes and string ABI locations; unsupported signatures or unknown exports fail instrumentation.
- `src/compat.rs`: model-derived foreign-hook IDs and format flags and one WASM-instance key counter for shim host allocation/reset; Tier C handles retain their isolated counters.
- `src/lib.rs`: isolated `CoreHandle`, JSON transaction boundary and build identity.
- `examples/instrument_exports/main.rs`: native export counter postprocessor; run after bindgen/wasm-opt and never optimize afterward. Preserve internal model indices; only bindgen throw imports gain outgoing-string wrappers. Keep the reserved counter helper unwrapped so generated raw ABI types stay accurate.
- `src/rich.rs` and `src/rich/input.rs`: rich profile, history, markdown and explicit
  package operations for the external differential harness.
- `src/command.rs`: text/paragraph commands and explicit host-resolved view inputs.
- `src/snapshot.rs`: state, selection, identities and commit records with pre-cache mutations.
- `packages/lexical-conformance/diff/`: loader, reproducible build and JS oracle.

## Boundaries

- Keep `publish = false`, `cdylib` plus `rlib`, and client workspace-hack exclusion.
- Enable the reserved `foreign-nodes` feature only here; WP-54 supplies JS hooks.
- WP-07 uses raw `Editor` transactions. WP-14 replaces v0 JSON commands with
  EditorCore and the session codec. `RichHandle` separately composes the actual
  rich-node, table, clipboard, history and markdown APIs; neither facade
  implements the session codec or Tier B rendering contract.
- Keep S1's UTF-16 edit validation. Interior selection offsets are allowed; edits
  splitting a surrogate pair fail atomically. The differential generator uses
  valid edit boundaries and separately verifies the S1 rejection cases.
- Inputs are development data; never use production credentials or documents.

## Checks

- `TMPDIR=/home/wolf/tmp cargo run -p lexical_conformance_wasm --example export_host_types -j4 -- --check`
- `TMPDIR=/home/wolf/tmp cargo test -p lexical_conformance_wasm -j4`
- `TMPDIR=/home/wolf/tmp cargo test -p lexical_conformance_wasm --example instrument_exports -j4` (Bun executes actual synthetic WASM exports)
- `TMPDIR=/home/wolf/tmp cargo clippy -p lexical_conformance_wasm --all-targets -j4 -- -D warnings`
- `TMPDIR=/home/wolf/tmp cargo check -p lexical_conformance_wasm --target wasm32-unknown-unknown -j4`
- `cargo tree --workspace -i lexical_conformance_wasm -e normal`: only itself.
- `cargo x deps --check`, `just check`.
- `STEPS=10000 bunx vitest run --config packages/lexical-conformance/diff/vitest.config.mts`

## Gotchas

- Build artifacts live in this worktree's `target/` and the ignored package `pkg/`.
- Compare mutations before DOM cache reconciliation and dirty sets from the final commit, matching upstream listeners.
- Keep WP-07 failing tapes under `packages/lexical-conformance/fixtures/fuzz/`.
- Keep the rich differential harness and its failing tapes outside the repository
  under `/home/wolf/tmp/lexical-port/difffuzz`; never copy that harness here.

Rich snapshots retain dangling table selection points with null paths after final row/column deletion.

Count strings as UTF-16 units times two, typed scalar values by their facade width,
and returned object keys/values recursively (JS numbers are f64). Pointer/length,
allocator and generated control metadata carry no payload. Reserved counter-hook
arguments are measurement adjustments, not ordinary payload. Keep return/error
accounting in src/debug.rs helpers when adding exports; raw-input accounting is
derived and runs before receiver validation. Optional strings use pointer zero as
absence even when bindgen leaves a stale length. Each artifact must contain one
unshared memory32 when strings are accounted. Run the postprocessor after optimization.

The native indexed host accepts `{args: [...], this?: encodedHandle}` as one call
envelope. Its JS host owns namespace/editability/theme and discrete scheduling.
Only the core registry is accepted until foreign definitions are wired; unknown
node types fail explicitly. The development commit packet is versioned separately
from its unchanged S1 flat diff. Its metadata currently covers base record fields;
foreign payloads and NodeState identity descriptors still need the full host.
Packet and Postcard encoding run through Session::commit_prepared before the
current model transition publishes; errors discard its writes and pending handles.
Previously published preceding transitions remain published. Make delivery failures,
backlogged preceding transitions and chained state/version/tag ownership explicit
before enabling foreign-class commit-time hooks or model follow-up queues here.

Transform registrations share the original JS function identity. Registration and
unregistration inside a callback use its current transaction; type-transform
snapshots remain owned by the model. Exception values stay opaque and are returned
unchanged after normal Rust rollback, including undefined. Do not inspect error
properties or use JS throw intrinsics that bypass Rust destructors. Registration
dirties attached types in the current transaction, or queues that
work for the next explicit begin_update when idle. Scheduling that update, nested
editor.update queues and commit listeners still belong to the future shim.

`register_listener` and `dispatch_command` host opaque JS application commands
through the model's extension-command pipeline. The shim assigns unique identity
strings to JS command objects; diagnostic command names are not identities.
Payloads retain JS identity and never pass through JSON or property inspection.
Only the explicit pending-update, single-editor route is implemented here; the
shim still owns automatic updates and parent-editor command propagation.
Builtin native commands and Tier A indexed fixture dispatch keep their existing
codecs. No production codec carries opaque JS values. Opaque reference transfers
count four logical bytes; listener results cross as a truthiness boolean.

Host packet format2 carries a model-derived changed flag for JS commit-listener
scheduling. A transition can have effects without field diff ops (selection,
composition or reconciliation); never infer no-op status from record/op counts.
Reject the earlier unreleased packet format instead of maintaining a fallback.

finish_noop preserves detached API values while closing a truly unchanged update
without allocating a model commit; false leaves the pending update open.

Count indexed JSON inputs at serde visitor delivery, including map keys and
prefixes consumed before a later error. Keep the wrapped deserializer requests
and error text unchanged; do not count only the final normalized JSON value.

Read foreign_hook_index in override-bit order; it is generated from the model trait, including its explicit upstream aliases. Never hand-maintain another host hook list.
