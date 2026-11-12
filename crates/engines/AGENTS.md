# crates/engines

## What it is

File-format engines: PowerPoint, Word, Figma, Photoshop and Illustrator readers, renderers and writers. Each compiles to wasm for the web app's editors and viewers and links natively for conversions and tests, so they depend only on the `types` layer and each other.

Layer: `engines` in [`.config/layers.toml`](../../.config/layers.toml), which
lists what this group may depend on. `cargo x deps` reports edges that break it.

## Crates

| Crate | What it is |
| --- | --- |
| [`ai_engine_wasm`](ai_engine_wasm/AGENTS.md) | The browser build of `illustrator_engine` (the Illustrator editor's worker module). |
| [`docx_engine`](docx_engine/AGENTS.md) | Powers Word-document editing within the Documents feature: a from-scratch `.docx` engine — parse, lay out, render, edit, save. |
| [`docx_engine_wasm`](docx_engine_wasm/AGENTS.md) | The browser build of `docx_engine` (the Word document editor's worker module). |
| [`fig_engine`](fig_engine/AGENTS.md) | Backs the Design feature's `.fig` file viewer/editor: a from-scratch Figma file engine that decodes, expands instances, renders, inspects, edits, and saves `.fig` files … |
| [`fig_engine_wasm`](fig_engine_wasm/AGENTS.md) | The browser build of `fig_engine` (the Figma viewer's worker module). |
| [`illustrator_engine`](illustrator_engine/AGENTS.md) | Part of Documents: the engine behind the web app's Illustrator editor — a from-scratch Illustrator (`.ai`) implementation that reads Illustrator's PDF-based files … |
| [`pptx_engine`](pptx_engine/AGENTS.md) | Part of the Documents feature (presentations). |
| [`pptx_engine_wasm`](pptx_engine_wasm/AGENTS.md) | The browser build of `pptx_engine` (the presentation editor's worker module). |
| [`psd_engine`](psd_engine/AGENTS.md) | Part of the Documents feature (image editing). |
| [`psd_engine_wasm`](psd_engine_wasm/AGENTS.md) | The browser build of `psd_engine` (the Photoshop viewer's worker module). |

## Recipes

- Add a crate here: create `crates/engines/<name>` with its own `AGENTS.md`
  (from `.agents/templates/AGENTS.md`), add it to the root `members` and run
  `cargo x deps`, which adds its `[workspace.dependencies]` entry once
  something depends on it. Add it to the table above.
