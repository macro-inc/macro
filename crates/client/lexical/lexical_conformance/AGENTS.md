# Lexical conformance

## What it is

Development-only schema-2 fixture interpreter for the pinned upstream oracle.

## Start here

- `src/fixture.rs`: recorder wire schema.
- `src/replay.rs`: operation ordering, identities and callback tapes.
- `src/api/`: explicit dispatch to model APIs, including caret object identity and metadata.
- `src/snapshot.rs`: full observable-state comparison.
- `tests/replay_wasm.rs`: complete embedded corpus in wasm-bindgen-test via `just lexical-replay-wasm`.
- `tests/replay.rs`: one libtest-mimic trial per recorded fixture.
- `tests/flat_diff.rs` and `tests/flat_diff/decoder.ts`: native Rust producer versus the independent Bun/TypeScript consumer of the flat ABI.

## Boundaries

- Read fixtures from `packages/lexical-conformance`; merge recorder updates rather than editing its files here.
- Replay code and mark factories, mark wrapping and tree traversal through their package APIs; direct `exportJSON` returns retain undefined fields while document snapshots omit them.
- Route rich-node constructors and handlers through `lexical_rich_nodes`; replay editor-level command transactions at the recorded enqueue/commit boundary.
- Fix model divergences in `lexical_model` or `lexical_rich_nodes`; never change expected values or skip observable comparisons to turn a failure green.
- Reset write bookkeeping for each replay transaction, including read-only discrete updates.
- Route markdown conversions and normalization through lexical_markdown with decoded standard transformer identifiers; the expanded corpus reports unsupported or divergent markdown cases explicitly.
- Link fixtures use real link transforms and MarkNode descendants; no link ledger entries remain.
- Unmapped APIs fail loudly. Ledger entries require an exact test identity, reason and spec decision; stale entries fail.
- Native loading lives in `source.rs`; the interpreter itself has no filesystem dependency.

## Checks

- `TMPDIR=/home/wolf/tmp cargo test -p lexical_conformance -j4`
- `TMPDIR=/home/wolf/tmp cargo test -p lexical_model -j4`
- `TMPDIR=/home/wolf/tmp cargo test -p lexical_conformance --test flat_diff -j4` (requires Bun)
- `TMPDIR=/home/wolf/tmp cargo check -p lexical_conformance --target wasm32-unknown-unknown -j4`
- `TMPDIR=/home/wolf/tmp cargo clippy -p lexical_conformance --all-targets -j4 -- -D warnings`
- `cargo x deps --check`, `cargo shear`, `just check`, `just pr-privacy`

- `just lexical-replay`: complete native run plus fingerprinted per-case evidence; failures retain a nonzero exit status.

## Gotchas

- Preserve callback argument/order checks, versioned handles, exact errors and JSON property order.
- Report pass/fail/ledger totals by source package; ledgered cases do not count toward the 50-fixture core gate.
