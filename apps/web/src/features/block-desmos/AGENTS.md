# block-desmos

In-browser graphing calculator. File-backed `desmos` documents (`application/x-macro-desmos`) edited with a Rust wasm engine.

## Start here

- `definition.ts`: registry, DSS load, flag-off `text: null`
- `views/desmos-editor.tsx`: worker session, expression list + graph paper
- `crates/desmos_engine`: parse, eval, plot

## Scope

- Owns: graph JSON, create/save, calculator UI
- Not here: search parser and AI tools (v1) → `crates/documents` / search processing

## Checks

- `bun run test -- src/features/block-desmos`
- `cargo test -p desmos_engine` (`SQLX_OFFLINE` unset)
- `just build-desmos-engine-wasm` from `apps/web` after engine changes

## Gotchas

- Construct the engine `Worker` on first use, never at module load (iOS WKWebView).
- `definition.ts` imports only types from the engine. Vitest must not load wasm; mock the client.
- Gate create + load with `enableDesmosEditor` (`ENABLE_DESMOS_EDITOR`).
- Last-write-wins `simpleSave`. Hide, color, viewport, and new rows must persist through the editor `onChange`.
