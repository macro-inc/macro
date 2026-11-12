# ai_engine_wasm

## What it is

The browser build of `illustrator_engine` (the Illustrator editor's worker module). It holds only the `cdylib`
that wasm-pack builds; the code and its wasm-bindgen exports live in
[`illustrator_engine`](../illustrator_engine/AGENTS.md). Keeping the cdylib here means native
builds of `illustrator_engine` link no shared library, and builds of different
services no longer overwrite each other's uplifted `libai_engine.so`.

## Checks

- `just build-ai-engine-wasm` in `apps/web` (wasm-pack, `--out-name illustrator_engine`).
