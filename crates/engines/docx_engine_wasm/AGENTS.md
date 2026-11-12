# docx_engine_wasm

## What it is

The browser build of `docx_engine` (the Word document editor's worker module). It holds only the `cdylib`
that wasm-pack builds; the code and its wasm-bindgen exports live in
[`docx_engine`](../docx_engine/AGENTS.md). Keeping the cdylib here means native
builds of `docx_engine` link no shared library, and builds of different
services no longer overwrite each other's uplifted `libdocx_engine.so`.

## Checks

- `just build-docx-engine-wasm` in `apps/web` (wasm-pack, `--out-name docx_engine`).
