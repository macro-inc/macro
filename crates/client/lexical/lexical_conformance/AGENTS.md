# Lexical conformance

## What it is

Development-only schema-2 fixture interpreter for the pinned upstream oracle.

## Start here

- `src/fixture.rs`: recorder wire schema.
- `src/replay.rs`: operation ordering, identities and callback tapes.
- `src/api/`: explicit dispatch to model APIs, including caret object identity and metadata.
- `src/snapshot.rs`: full observable-state comparison.
- `tests/replay.rs`: one libtest-mimic trial per recorded fixture.

## Boundaries

- Read fixtures from `packages/lexical-conformance`; merge recorder updates rather than editing its files here.
- Fix model divergences in `lexical_model`; never change expected values or skip observable comparisons to turn a failure green.
- Unmapped APIs fail loudly. Ledger entries require an exact test identity, reason and spec decision; stale entries fail.
- Native loading lives in `source.rs`; the interpreter itself has no filesystem dependency.

## Checks

- `TMPDIR=/home/wolf/tmp cargo test -p lexical_conformance -j4`
- `TMPDIR=/home/wolf/tmp cargo test -p lexical_model -j4`
- `TMPDIR=/home/wolf/tmp cargo check -p lexical_conformance --target wasm32-unknown-unknown -j4`
- `TMPDIR=/home/wolf/tmp cargo clippy -p lexical_conformance --all-targets -j4 -- -D warnings`
- `cargo x deps --check`, `cargo shear`, `just check`, `just pr-privacy`

## Gotchas

- Preserve callback argument/order checks, versioned handles, exact errors and JSON property order.
- Report pass/fail/ledger totals by source package; ledgered cases do not count toward the 50-fixture core gate.
