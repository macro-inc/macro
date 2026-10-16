# psd_engine

## What it is

Part of the Documents feature (image editing). A from-scratch Photoshop
(`.psd`/`.psb`) engine — read, composite, edit with undo, collaborate, and
save — compiled both natively and to WebAssembly for the browser Photoshop
editor.

## Start here

- `README.md`: the PSD format primer and module map — read before
  `src/lib.rs`.
- `src/document.rs`: the editable document model edits and rendering go
  through.
- `src/edit/ops.rs`: the edit operation vocabulary.
- `src/collab.rs` + `src/collab/tile.rs`: the CRDT mapping and fractional
  tile ordering (uses `fig_engine`'s fractional positions).
- `src/wasm.rs`: the wasm-bindgen API surface for the browser worker.

## Scope

- Owns: `.psd`/`.psb` parsing, compositing, editing, collaboration mapping,
  and saving.
- Not here: font registry, glyph outlines, image decoding, the JPEG encoder,
  and fractional-position ordering primitives → `fig_engine`; the browser
  worker → `apps/web/src/lib/core/psd-engine`.

## Boundaries

- Depends on: `fig_engine` (default features off).
- Used by: `documents` (AI tools), `services/search_processing_service`.

## Recipes

- Add an edit operation: `src/edit/ops.rs` → `src/edit.rs`/the relevant
  `src/edit/<area>.rs` → `src/edit/test.rs`.
- Add a codec feature (a new tagged block or resource): `src/codec/<area>.rs`
  → `src/model/<area>.rs` → `src/render/` if it affects compositing.

## Checks

- `cargo test -p psd_engine` (`SQLX_OFFLINE` unset).
- `cargo test -p psd_engine --features cli` for the `psd_render` CLI.

## Related

- Docs: `README.md`
