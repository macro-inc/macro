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

## Checks

Run from this directory, through build-slot and under a memory cap:
`CARGO_TARGET_DIR=... cargo test --offline -j2`. Size with `LORO_DIFF_CASES`,
`LORO_DIFF_BULK_CASES`, `LORO_DIFF_LEN`, `LORO_DIFF_FIRST_SEED`; replay one seed
with `LORO_DIFF_SEED` / `LORO_DIFF_BULK_SEED`.

## Why decoded comparison is safe for shallow exports

A cached-prefix shallow export may encode root text in fewer fragments than
upstream's reverse checkout. The runner still requires identical decoded state
(latest value, shallow root, versions, state at the root, retained history),
and after a peer reloads from such bytes every later step must still match
exactly: events, versions, undo and update-export bytes. Only snapshot-type
bytes may then differ, and only when they decode identically. This is sound
because no consumer reads shallow snapshot bytes by identity
(../README.md lists them).

## CI

Not run in CI: it builds outside the workspace and the default run takes
about a minute and a half. Run it after any change under ../loro-internal; the
regressions in `tests/regressions.rs` are the minimum.

## Gotchas

- Exports commit pending transactions, so the runner exports only after barrier
  steps and drains events after exporting.
- `oplog_vv()` already includes pending ops; use `get_pending_txn_len()`.
- Error and panic messages embed the crate path; compare them normalized.
- Detached editing renews to a random peer id; the runner pins each renewal.
- A suppressed commit delivers no events on the patched side by design.
