# fig_engine_wasm

## What it is

The browser build of `fig_engine` (the Figma viewer's worker module). It holds only the `cdylib`
that wasm-pack builds; the code and its wasm-bindgen exports live in
[`fig_engine`](../fig_engine/AGENTS.md). Keeping the cdylib here means native
builds of `fig_engine` link no shared library, and builds of different
services no longer overwrite each other's uplifted `libfig_engine.so`.

## Checks

- `just build-fig-engine-wasm` in `apps/web` (wasm-pack, `--out-name fig_engine`).
