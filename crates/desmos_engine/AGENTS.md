# desmos_engine

## What it is

Part of the Documents feature (graphing). A Desmos-style graphing calculator
engine — parse expressions, evaluate, sample plots, and serialize documents —
compiled both natively and to WebAssembly for the browser Desmos block.

## Start here

- `src/parse.rs`: Desmos-like math (implicit multiply, `^`, comparisons).
- `src/plot.rs`: explicit curves, implicit contours, inequalities, points.
- `src/document.rs`: expressions, sliders, viewport, color cycle.
- `src/wasm.rs`: the wasm-bindgen API for the browser worker.

## Scope

- Owns: expression parsing/evaluation (LaTeX-lite, `|x|`, piecewise, polar,
  parametric), plot sampling, and the `.desmos` JSON
  document.
- Not here: the browser worker → `apps/web/src/lib/core/desmos-engine`; the
  graph paper UI → `apps/web/src/features/block-desmos`.

## Checks

- `cargo test -p desmos_engine` (`SQLX_OFFLINE` unset).
- `just build-desmos-engine-wasm` (from `apps/web`) for the wasm build.

## Related

- Docs: `docs/guides/add-block.md`, `docs/agent-guide/documents.md`
