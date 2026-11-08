# Lexical development shim

Private compatibility work over the Rust conformance host. The backend and update
controller run real model transactions, JavaScript transforms and application
commands. The drop-in `lexical` facade and foreign-class adapters are still being
implemented; this package is not a production dependency.

Run from this directory:

```sh
bun install --frozen-lockfile
TMPDIR=/home/wolf/tmp CARGO_BUILD_JOBS=4 bun run test
bun run check
```

Tests build the fingerprinted optimized web WASM artifact using the shared
conformance build script. Updates batch until the microtask boundary, except
discrete updates and composition ownership changes. Nested update bodies run
before transforms finish; publication precedes update listeners and deferred
callbacks. Listener-enqueued updates begin after that callback phase. Errors
discard pending writes before invoking the error handler. Unchanged updates close
without publishing or leaking tags into later work, while detached API values
remain usable. Disposal cancels queued work and releases the model after any
active callback returns.

The production view lives in `lexical-wasm-view`; DOM code belongs there.
