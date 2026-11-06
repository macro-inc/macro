# docx_engine

## What it is

Powers Word-document editing within the Documents feature: a from-scratch
`.docx` engine — parse, lay out, render, edit, save. Runs natively (tests,
the corpus CLI) and as WebAssembly in the web app's DOCX editor worker.

## Start here

- `README.md`: design (attributed-string paragraphs, block tree, the
  collaborative shape), the full directory map, current fidelity numbers,
  and known gaps — read this before the source.
- `src/document.rs`: the package, body story, headers/footers/notes.
- `src/edit.rs` + `src/edit/txn.rs`: `Session::apply`, the edit-operation
  transaction model.
- `src/collab.rs`: the document as Loro containers; `src/wasm.rs`: the
  wasm-bindgen API the browser worker calls.

## Scope

- Owns: everything Word-specific — model, layout, render, edit, collab, wasm
  bridge.
- Not here: the shared Office foundation (ZIP/OPC, DrawingML, fonts,
  rasterizer) → `crates/pptx_engine`.

## Boundaries

- Depends on: `pptx_engine` (default-features disabled).
- Used by: `services/convert_service` natively; the web app's DOCX editor
  worker (`apps/web/src/lib/core/docx-engine`) via the wasm build.

## Recipes

- Add an edit operation: `src/edit.rs` (`EditOp` variant) → the matching
  `src/edit/<area>.rs` → `src/edit/test.rs`.
- Rebuild the wasm bundle after a native change: `just build-docx-engine-wasm`
  from `apps/web` (or `just ensure-docx-engine-wasm` to rebuild only if stale).

## Checks

- `cargo test -p docx_engine`.
- Fidelity scoring against reference renders: `cargo run -p docx_engine
  --bin docx_corpus --features cli` (see `tests/corpus/README.md`).

## Gotchas

- `#![deny(missing_docs)]`: every public item needs a doc comment.
- Content the engine doesn't interpret is kept as opaque XML and written back
  unchanged — don't drop unknown attributes or children while editing a block.

## Related

- Docs: `README.md` (this crate) · `apps/web/AGENTS.md` for the browser
  editor side.
