# graphql-cache/headless

## What it is

The production cache chain in one Node test process, for measuring how much
work a data path does: the page host, the SharedWorker coordinator and the
engine worker running `CacheWorkerCore` over the real cache-wasm build, with
OPFS and Web Locks held in memory. No browser, no stand-in engine.

## Start here

- `runtime.ts`: `installHeadlessCacheRuntime()` stubs the worker, OPFS and lock
  globals and returns `openHost(scope)`; dispose it per test.
- `real-engine.ts`: loads `../wasm` from disk, records every engine call (its
  method, the records it returned, and for reads the view it serves, keyed by
  query and variables or by request, so `viewReadsSince` counts a view read
  twice) and reads the engine's SQL counters (`sqlCounters()`: statements
  executed and rows they stepped, from `cache-turso`'s `sql_counts`). A call
  that throws or rejects is recorded as finished with its `error`
  (`log.errors()`), so a wait for open calls never hangs on it.
- `memory-opfs.ts`: in-memory sync access handles and locks, with I/O counters.
  `installHeadlessCacheRuntime({ reopen })` loads the next page over a
  disposed runtime's files (`reopenMemoryOpfs`).
- `fixture-network.ts`: the network as `graphql-js` over the production schema
  and a fixture's resolvers: an urql exchange, a websocket client for
  `sessionSubscriptionExchange`, and `push` for subscription frames. Invalid
  documents and resolver errors land in `log.errors`.
- `solid-allocations.ts`: Solid owners, signals and store nodes created while
  counting, from the development build's `DEV.hooks`.
- `setup.ts`: mocks `../worker/wasm-module` so `loadCacheWasm` returns the real
  engine; every `*.harness.ts` run gets it through `vitest.config.ts`.

## Checks

- From `apps/web`: `just test-cache-harness`, which builds the engine first
  (`build-cache-wasm`) and runs every `*.harness.{ts,tsx}`; they are kept out
  of `bun run test`. PR CI runs it as the web checks' **Cache Harness** job.

## Gotchas

- Workers are linked message ports on one event loop: messages cross the same
  validation and dispatch as in a browser, without the thread hop. Timings here
  are not browser timings; count work instead.
- Load the wasm by file path, never `new URL(..., import.meta.url)`: Vite
  rewrites that into a served URL the Node loader refuses.
- A cold open over a seeded cache is a second runtime with `reopen`, in a fresh
  module graph (`vi.resetModules`): app modules keep per-page state (the query
  client, the session generation) that a second host on one runtime would share.
- Each runtime loads its own engine instance (the glue imported under a
  distinct URL, so its module state is new) over one `WebAssembly.Module`
  compiled per process; the current one is on `globalThis`, because the
  engine worker's mock and the runtime can sit in different module graphs.
- `vi.mock` factories outlive `vi.resetModules`: a mock that reads harness
  state must find it on `globalThis`, not in a module variable.
- Mocks of a module only replace what other modules import from it; a call
  inside the module still reaches its own function.
- Type check from `apps/web` with typescript-native under `ulimit -c 0`
  (`bun ../../node_modules/typescript-native/bin/tsc --noEmit --skipLibCheck`):
  `bunx tsc` on the whole app dumps core.
- `console.log` from a harness is swallowed by the reporter; write results to a
  file.
