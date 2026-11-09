# Compatibility measurements

## What it is

Opt-in raw counters for the actual production compatibility bridge. The collector
and generated-glue transform are separate from production fixture acceptance.

## Start here

- `metrics.ts`: versioned immutable entries, byte transfers, reference slots and nested windows.
- `runtime.ts`: diagnostic-only binding and wrappers; throws if no collector is bound.
- `gate.ts`: recomputes numeric limits; does not attest source, plugin or GC provenance.
- `../../scripts/measurement/README.md`: transform, raw schema and commands.

## Boundaries

- Keep imports out of shipping hot paths unless a compile-time guard removes them.
- Count one entry per invocation, including failed entries and every glue helper;
  reverse return-byte direction without counting another entry.
- Keep API events byte-free; numeric ABI, payload and reference observations are
  separate physical records. Label the 8-byte reference cost as accounting.
- Preserve between-entry payload transfers even when their enclosing invocation
  is an API call; the parent ID is not byte ownership.
- Preserve all setup, measurement, GC and diagnostic entries in published raw data.
- Keep deferred commit, output, callback and wake work inside its causal key window.
- Do not claim a native GC barrier from a request or cold snapshot; require actual
  finalizer/release/pruning acknowledgement and source-matched runtime evidence.

## Checks

- Run the focused test command in the scripts README against real generated
  glue/WASM. Missing artifacts fail; never substitute a model or skip that case.
- Run package-pinned TypeScript with `tests/measurement/tsconfig.json` and `just check`.
- Emit declarations only to an external directory with the explicit configured root.

## Gotchas

The full Macro plugin document route and coherent production initializer are
required before these counters can satisfy the fail-closed compatibility gate.
The session-boundary equivalence test is narrower evidence.
