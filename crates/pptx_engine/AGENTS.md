# pptx_engine

## What it is

Part of the Documents feature (presentations). A from-scratch PowerPoint
(`.pptx`) engine — parse, render, edit, and save — compiled both natively
and to WebAssembly for the browser presentation editor.

## Start here

- `README.md`: architecture, the editing model, testing, and known gaps —
  read before `src/lib.rs`.
- `src/edit/ops.rs`: the `EditOp` vocabulary shared by the browser editor and
  the `EditPresentation` AI tool.
- `src/model.rs` + `src/opc.rs` + `src/xml.rs`: the part/model/XML layers
  edits and rendering both go through.
- `src/wasm.rs`: the wasm-bindgen API surface for the browser worker.

## Scope

- Owns: `.pptx` parsing, the editable presentation model, rendering,
  editing, collaboration mapping, and fidelity scoring.
- Not here: the browser worker that hosts this engine →
  `apps/web/src/lib/core/pptx-engine`; AI tool wiring → `documents`.

## Boundaries

- Used by: `docx_engine` (shared containers/fonts/rasterizer), `documents`
  (AI tools), `services/convert_service`.

## Recipes

- Add an edit operation: `src/edit/ops.rs` (variant + schema) →
  `src/edit.rs`/the relevant `src/edit/<area>.rs` (apply logic) →
  `src/edit/test.rs` → corpus round-trip check.
- Add a render feature: `src/model/` (data) → `src/render/` (scene/paint) →
  `src/render/test.rs` + the corpus baseline (`tests/corpus/README.md`).

## Checks

- `cargo test -p pptx_engine` (`SQLX_OFFLINE` unset) — includes the corpus
  regression test against `tests/corpus/baseline.json`.
- `cargo test -p pptx_engine --features cli` for the `pptx_corpus` CLI.
- `just build-pptx-engine-wasm` (from `apps/web`) for the wasm build.

## Related

- Docs: `README.md`, `tests/corpus/README.md`
