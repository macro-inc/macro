# ai_engine

## What it is

Part of Documents: the engine behind the web app's Illustrator editor — a
from-scratch Illustrator (`.ai`) implementation that reads Illustrator's
PDF-based files, builds an editable model, renders it, edits with undo,
collaborates, and saves files Illustrator and any PDF reader open. Runs
natively and as WebAssembly.

## Start here

- `README.md`: the format background and the full module map — read this
  first, it documents every module's role.
- `src/model.rs`: artboards, layers, groups, paths, text, images.
- `src/build.rs` + `src/interp.rs`: PDF content stream → model.
- `src/edit.rs` + `src/collab.rs`: operations/undo and shared editing.
- `src/save.rs`: writing the model back out as a PDF-based `.ai`.
- `src/wasm.rs`: the wasm-bindgen shell (wasm32 only).

## Scope

- Owns: the entire `.ai`/PDF read-edit-render-save pipeline. Third-party
  code is limited to small single-purpose libraries (`tiny-skia`,
  `miniz_oxide`, `png`, `zune-jpeg`, `skrifa`); text layout shares
  `fig_engine`'s font registry rather than duplicating it.
- Not here: the web editor UI and worker wiring →
  `apps/web/src/lib/core/ai-engine`.

## Boundaries

- Depends on: `fig_engine` (fonts, boolean ops, image decoding, JPEG
  encoding).
- Used by: `documents`, `search_processing_service` (native, for indexing),
  the web app's Illustrator editor worker (wasm).

## Recipes

- Add support for a PDF feature: `src/pdf/` (parse) → `src/interp.rs`
  (interpret) → `src/build.rs` (model it) → `src/render.rs` (draw it) →
  `src/save.rs` (round-trip it).
- Add an edit operation: `src/edit/nodes.rs` / `src/edit/shapes.rs` →
  `src/edit/tree.rs` (undo/redo) → `src/collab.rs` if shared.

## Checks

- `cargo test -p ai_engine` (`SQLX_OFFLINE` unset not relevant; no DB).
- The `ai_render` CLI (`cli` feature) round-trips and fidelity-scores
  against reference renders — use it after parser/render changes.

## Related

- Docs: `crates/ai_engine/README.md`
