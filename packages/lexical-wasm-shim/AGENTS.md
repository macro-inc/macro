# Lexical WASM development shim

## What it is

Development-only Lexical compatibility facade over the Rust conformance host.
The package is being assembled; the full lexical export surface is not ready.

## Start here

- `src/backend/conformance.ts`: the only backend and the only runtime WASM import.
- `src/backend/index.ts`: model boundary; packet types come from Rust generation.
- `src/handles.ts`: per-editor weak captured-node identity and collected-version ownership.
- `src/update.ts`: JS update scheduling, batching and callback phases.
- `src/__tests__/setup.ts`: synchronous pinned WASM initialization and editor leak checks.
- `src/__tests__/surface.test.ts`: literal node API observations from the pinned upstream oracle, exercised through the real backend.

## Boundaries

- Never import this private package from production apps, packages or Rust crates.
- Use the shared production lexical-wasm-view package for DOM work; do not copy it.
- Keep JS command identity in a WeakMap; diagnostic names are not identities.
- Keep node/selection identity caches per version, never in a global Map.
- Keep opaque JS values out of the portable JSON fixture encoding.
- Keep callback ownership in JS; Rust-retained forwarding functions hold weak callback references so closures cannot keep an editor alive through Rust.
- Retain unregistered callback owners through the current job for in-flight model snapshots, and defer explicit disposal until active Rust calls return.

## Checks

- In this package: `TMPDIR=/home/wolf/tmp CARGO_BUILD_JOBS=4 bun run test`, `bun run check`.
- `bun install --frozen-lockfile`, `just check`.
- Tests execute the real optimized web WASM artifact; never replace the model with a mock.

## Gotchas

WASM builds are shared with packages/lexical-conformance and fingerprinted there.
The final lexical facade, foreign classes and production view adapter remain in scope.

Lifetime tests run with --expose-gc and await the actual facade-release notification
after crossing the WeakRef keep-alive job boundary; do not replace them with polling.

Defer collected-version release through an open update and recheck JS ownership before releasing; keep record metadata until the native release succeeds.

Own exactly one node-handle cache per backend, retained until disposal; never let independent caches release the same model version.

Use selection.test.ts to check captured selection fields across suspension, replacement and rollback against the real backend.

Keep mutations.test.ts literals tied to the pinned upstream observations; assert D-6/D-7 differences as specified errors, not upstream success cases.
