# Lexical WASM development shim

## What it is

Development-only Lexical compatibility facade over the Rust conformance host.
The package is being assembled; the full lexical export surface is not ready.

## Start here

- `src/backend/conformance.ts`: the only backend and the only runtime WASM import.
- `src/backend/index.ts`: model boundary; packet types come from Rust generation.
- `src/update.ts`: JS update scheduling, batching and callback phases.
- `src/__tests__/setup.ts`: synchronous pinned WASM initialization and editor leak checks.

## Boundaries

- Never import this private package from production apps, packages or Rust crates.
- Use the shared production lexical-wasm-view package for DOM work; do not copy it.
- Keep JS command identity in a WeakMap; diagnostic names are not identities.
- Keep node/selection identity caches per version, never in a global Map.
- Keep opaque JS values out of the portable JSON fixture encoding.

## Checks

- In this package: `TMPDIR=/home/wolf/tmp CARGO_BUILD_JOBS=4 bun run test`, `bun run check`.
- `bun install --frozen-lockfile`, `just check`.
- Tests execute the real optimized web WASM artifact; never replace the model with a mock.

## Gotchas

WASM builds are shared with packages/lexical-conformance and fingerprinted there.
The final lexical facade, foreign classes and production view adapter remain in scope.
