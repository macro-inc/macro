# psd_engine_wasm

## What it is

The browser build of `psd_engine` (the Photoshop viewer's worker module). It holds only the `cdylib`
that wasm-pack builds; the code and its wasm-bindgen exports live in
[`psd_engine`](../psd_engine/AGENTS.md). Keeping the cdylib here means native
builds of `psd_engine` link no shared library, and builds of different
services no longer overwrite each other's uplifted `libpsd_engine.so`.

## Checks

- `just build-psd-engine-wasm` in `apps/web` (wasm-pack, `--out-name psd_engine`).
