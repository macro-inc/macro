# Lexical Loro projection

## What it is

Portable incremental projection between lexical_model commits and Loro 1.17.1.
It preserves the persisted loro-mirror node schema and takes explicit clocks.

## Start here

- `src/golden.rs`, `mirror.rs`, `snapshot.rs`: frozen ancestor and server snapshot reconciliation.
- `reconstruct_initial_state`: one read-only walk reports persisted transparent wrappers; `mirror::set_synced_state` performs explicit full cleanup with protected local fields retained.
- `src/policy.rs`: synced editor view and application exclusions.
- `src/schema.rs`: fresh/existing container inference and text splicing.
- `src/local.rs`: dirty commit projection and corrected list moves.
- `src/remote.rs`: buffered Loro events and id-keyed raw editor changes.
- `src/cursor.rs`: Unicode/UTF-16 conversion and awareness cursor codec.

## Boundaries

- Keep application node types, canonical editor serialization and ownership policy behind SyncPolicy.
- Canonicalize source own-undefined aliases to null on both model and persisted JSON reads; retain every underlying Loro value and operation.
- Apply source own-undefined storage fields through SyncPolicy before writing; retain strict attach equality and keep PlainPolicy unchanged.
- Verify client Loro 1.17.1 separately from the server's preserved JavaScript 1.16.3 dependency in the pair test.
- No network, database, async runtime or host callbacks; native Loro subscription only.
- Set peer immediately after new/fork; disable live-session recorded timestamps and pass commit timestamps.
- Retain recorded timestamps only in server-created snapshot helpers; never regenerate the frozen Markdown ancestor.
- Treat empty snapshot IDs as unkeyed; match source insertion and duplicate retention.
- Compute snapshot list move sources after deletions and preserve surviving container identities.
- Never enable loro-internal's wasm feature; native Loro positions are Unicode scalars.
- WASM builds of Loro itself require a JavaScript host for its internal clock.
- Preserve inference/container kinds, foreign children and unexported fields.
- Keep client crate excluded from workspace-hack.

## Checks

Install root Bun dependencies before running tests; the differential oracle must
run the current mirror source and must never be replaced with expected values.
The editor pair uses workspace Loro1.17.1; the isolated Worker transcript driver
remains1.16.3 beside the vendored1.16.2 server encoder to preserve C0 bytes.


- `TMPDIR=/home/wolf/tmp cargo test -p lexical_loro -j4`
- `TMPDIR=/home/wolf/tmp PROPTEST_CASES=256 cargo test -p lexical_loro -j4`
- `TMPDIR=/home/wolf/tmp cargo check -p lexical_loro --target wasm32-unknown-unknown -j4`
- `TMPDIR=/home/wolf/tmp cargo clippy -p lexical_loro --all-targets -j4 -- -D warnings`
- `cargo x workflows --check` after changing the generated `loro-pair` job.
- `cargo x deps --check`, `cargo shear`, `just check`, `just pr-privacy`

## Gotchas

Use explicit literal tests before generated differential streams. Application-specific plugins stay in macro_document_model; history grouping is
WP-49. Keep literal tests for each intentional S11 delta. Strict checks must
report unrepresentable newer own fields while preserving them in Loro.
Use saved event paths for unindexed filtered wrappers; reconcile final policy
visibility before emitting updates or retaining their model bindings.

Remote Create JSON retains an empty children marker for native elements so
opt-in unknown types keep their structural kind through EditorCore.

Snapshot ownership of affected child lists before initializing new subtrees;
rebinding a moved descendant must not turn its old container into a foreign child.

Local projection uses debug metrics without per-keystroke tracing spans; cold session
flows own the parent spans.
