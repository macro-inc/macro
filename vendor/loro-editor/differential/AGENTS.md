# Loro editor differential

## What it is

A seeded differential property test: the editor's patched `../loro-internal`
against crates.io loro-internal 1.17.1, built side by side in one binary
(renamed `loro_patched` / `loro_upstream`). Outside the root workspace.

## Start here

- `src/lib.rs`: operation model, generator, comparison and shrinker.
- `src/side.rs`: the two instantiations; only the editor commit (opt-in
  suppressed recording + projected checkpoint) and the injected undo clock use
  patched-only API.
- `src/side_body.rs`: the shared runner, `include!`d once per crate.
- `tests/differential.rs`: random scripts and bulk shallow scripts.
- `tests/regressions.rs`: minimized divergences as literal scripts.
- `src/test.rs`: the byte-acceptance rules of the comparison.

## Checks

Run from this directory, through build-slot and under a memory cap:
`CARGO_TARGET_DIR=... cargo test --offline -j2`. Size with `LORO_DIFF_CASES`,
`LORO_DIFF_BULK_CASES`, `LORO_DIFF_LEN`, `LORO_DIFF_FIRST_SEED`; replay one seed
with `LORO_DIFF_SEED` / `LORO_DIFF_BULK_SEED`.

## Why decoded comparison is safe for shallow exports

A cached-prefix shallow export may encode root text in fewer fragments than
upstream's reverse checkout. The runner still requires identical decoded state
(latest value, shallow root, versions, state at the root, retained history).
Byte differences are accepted per peer lineage, never case-wide:

- an eligible cached-prefix export may differ; exporting does not change the
  exporting peer, so it taints nothing;
- a peer that reloads from differing bytes becomes fragmented, but only when
  the source export was eligible or its source peer was already fragmented;
  reloading from identical bytes clears it;
- only a fragmented peer's own snapshot-type exports may then differ.

Update exports, events, versions and undo stay exact for every peer, and other
peers' snapshots stay byte-exact (`src/test.rs`). The runner shows a
fragmented peer's later behaviour is identical. This is sound because no
consumer reads shallow snapshot bytes by identity (../README.md lists them).

## CI

`just test-loro-editor-differential` (the default seeds, the regressions and
the comparison unit tests) runs in the `loro-pair` job whenever
vendor/loro-editor changes. Run larger seed ranges locally after changing
../loro-internal.

## Gotchas

- Exports commit pending transactions, so the runner exports only after barrier
  steps and drains events after exporting.
- `oplog_vv()` already includes pending ops; use `get_pending_txn_len()`.
- Error and panic messages embed the crate path; compare them normalized.
- Detached editing renews to a random peer id; the runner pins each renewal.
- A suppressed commit delivers no events on the patched side by design.
