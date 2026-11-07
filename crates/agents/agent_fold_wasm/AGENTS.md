# agent_fold_wasm

## What it is

The browser build of `agent_fold` (the agent transcript fold the web app runs in a worker). It holds only the `cdylib`
that wasm-pack builds; the code and its wasm-bindgen exports live in
[`agent_fold`](../agent_fold/AGENTS.md). Keeping the cdylib here means native
builds of `agent_fold` link no shared library, and builds of different
services no longer overwrite each other's uplifted `libagent_fold.so`.

## Checks

- `just build-agent-fold-wasm` in `apps/web` (wasm-pack, `--out-name agent_fold`).
