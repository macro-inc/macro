# Lexical WASM development shim

## What it is

Development-only Lexical compatibility facade over the Rust conformance host.
The package is being assembled; the full lexical export surface is not ready.

## Start here

- `src/backend/conformance.ts`: the only backend and the only runtime WASM import.
- `src/backend/index.ts`: model boundary; packet types come from Rust generation.
- `scripts/derive-hooks.ts`: checksum-pinned upstream AST inventory versus the actual model hook enum; generates `src/hooks.generated.ts`.
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

Use backend foreignHookIndex for override-bit order; the model trait and independent upstream inventory must agree. `bun run check` verifies committed hook evidence as well as TypeScript. Regenerate with `bun run derive-hooks` after a source or contract change; per-hook hosting tests remain a separate requirement.

Derive polymorphic methods from actual inherited overrides, distinguishing static/instance membership and nearest base kind; ordinary calls to native accessors do not make hooks. Resolve import aliases and reexports with the source compiler, never a flat class-name map. Keep the three S4 reserved extension points and the two explicitly required ListItemNode predicates even when the pinned sources lack overrides or callers. Keep native root traversal and S1 non-hooks out of the virtual set.

Use backend callNative for an explicit native-super node hook; it shares the indexed ABI and current callback lease. native-super.test.ts covers actual WASM dispatch and transform reentry; model literals separately prove foreign-chain bypass and nested virtual calls. Pure hosted callbacks and lifecycle constructor scopes are still required.

Native-super currently selects the nearest registered native ancestor. Explicit older-prototype targeting (for example a TextNode base method on a TabNode) is still required with the native facade/overlay; do not count this primitive as full native-class hosting acceptance.

Use foreign/registry.ts for class ancestry and prototype masks. Capture NativeNodeCatalog before patches, consume ForeignClassRegistry.beforeUpdate before opening a model update, and keep the generated hook order. Prototype traps use weak registry owners; recheck descriptor replacements before updates and preserve non-writable/accessor/non-extensible prototype semantics. Kind-specific non-hooks (text/element getTextContent and element setFormat) do not set bits. This metadata still needs connection to the JS facade and Rust foreign-node adapter; registry literals are not per-hook hosting acceptance.
