# pptx_engine_wasm

## What it is

The browser build of `pptx_engine` (the presentation editor's worker module). It holds only the `cdylib`
that wasm-pack builds; the code and its wasm-bindgen exports live in
[`pptx_engine`](../pptx_engine/AGENTS.md). Keeping the cdylib here means native
builds of `pptx_engine` link no shared library, and builds of different
services no longer overwrite each other's uplifted `libpptx_engine.so`.

## Checks

- `just build-pptx-engine-wasm` in `apps/web` (wasm-pack, `--out-name pptx_engine`).
