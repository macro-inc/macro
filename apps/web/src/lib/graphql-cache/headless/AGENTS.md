# graphql-cache/headless

## What it is

The production cache chain in one Node test process, for measuring how much
work a data path does: the page host, the SharedWorker coordinator and the
engine worker running `CacheWorkerCore` over the real cache-wasm build, with
OPFS and Web Locks held in memory. No browser, no stand-in engine.

## Start here

- `runtime.ts`: `installHeadlessCacheRuntime()` stubs the worker, OPFS and lock
  globals and returns `openHost(scope)`; dispose it per test.
- `real-engine.ts`: loads `../wasm` from disk, records every engine call and
  reads the engine's SQL counters (`sqlCounters()`: statements executed and
  rows they stepped, from `cache-turso`'s `sql_counts`).
- `memory-opfs.ts`: in-memory sync access handles and locks, with I/O counters.
- `setup.ts`: mocks `../worker/wasm-module` so `loadCacheWasm` returns the real
  engine; every `*.harness.ts` run gets it through `vitest.config.ts`.

## Checks

- `just build-cache-wasm`, then from `apps/web`:
  `bunx vitest run --config src/lib/graphql-cache/headless/vitest.config.ts --maxWorkers=4`.
  Files are `*.harness.{ts,tsx}`, kept out of `bun run test`.

## Gotchas

- Workers are linked message ports on one event loop: messages cross the same
  validation and dispatch as in a browser, without the thread hop. Timings here
  are not browser timings; count work instead.
- Load the wasm by file path, never `new URL(..., import.meta.url)`: Vite
  rewrites that into a served URL the Node loader refuses.
- A second host on the same runtime reopens the same in-memory files, which is
  how a harness measures a cold open over a seeded cache.
- `console.log` from a harness is swallowed by the reporter; write results to a
  file.
