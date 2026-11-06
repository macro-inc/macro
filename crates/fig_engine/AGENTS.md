# fig_engine

## What it is

Backs the Design feature's `.fig` file viewer/editor: a from-scratch Figma
file engine that decodes, expands instances, renders, inspects, edits, and
saves `.fig` files, built both as native Rust and as wasm for the web viewer.

## Start here

- `README.md`: read this first — the file format, the module map ("Design"
  section), editing/saving, collab, and the `fig_render` CLI are all explained
  there in depth; this file only adds what the README doesn't.
- `src/lib.rs`: the module list matches the README's "Design" table exactly.
- `src/testing.rs`: the from-scratch kiwi encoder and test schema every test
  builds files with — there is no third-party `.fig` data in the repo.

## Scope

- Owns: everything under `src/` — decode, scene, render, edit, export, save,
  collab, library, prototypes.
- Not here: the web app's viewer/editor UI and worker wiring →
  `apps/web/src/lib/core/fig-engine`.

## Recipes

- Add an edit operation: `src/edit.rs` (`Op` variant) → the relevant
  `src/edit/<area>.rs` → `src/save.rs` if it touches new fields →
  `fig_render roundtrip` to check save fidelity.
- Add an export format: `src/export.rs` → new `src/export/<format>.rs`.
- Change decoded model fields: `src/model.rs` / `src/model/<area>.rs` →
  `src/decode/<area>.rs` → `src/save.rs` (fields not modeled must survive a
  save byte-for-byte).

## Checks

- `cargo test -p fig_engine`.
- After a decode/edit/save change: `cargo run -p fig_engine --features cli
  --release --bin fig_render -- roundtrip FILE.fig…` against local `.fig`
  files (not committed — third-party).
- Wasm build: `just build-fig-engine-wasm` from `apps/web`.

## Gotchas

- Regenerate committed fixtures after a model change:
  `cargo test -p fig_engine --lib write_showcase_fixture -- --ignored` and
  `write_prototype_fixture -- --ignored`; a test fails when they're stale.

## Related

- Docs: `README.md` (this crate's primary guide — read before editing)
