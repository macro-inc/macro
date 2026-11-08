# Lexical Loro projection

## What it is

Portable incremental projection between lexical_model commits and Loro 1.17.1.
It preserves the persisted loro-mirror node schema and takes explicit clocks.

## Start here

- `src/golden.rs`, `mirror.rs`, `snapshot.rs`: frozen ancestor and server snapshot reconciliation.
- `src/policy.rs`: synced editor view and application exclusions.
- `src/schema.rs`: fresh/existing container inference and text splicing.
- `src/local.rs`: dirty commit projection and corrected list moves.
- `src/remote.rs`: buffered Loro events and id-keyed raw editor changes.
- `src/cursor.rs`: Unicode/UTF-16 conversion and awareness cursor codec.

## Boundaries

- Keep application node types and ownership policy behind SyncPolicy.
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
