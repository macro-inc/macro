# Lexical WASM development shim

## What it is

Development-only Lexical compatibility facade over the Rust conformance host.
The package is being assembled; the full lexical export surface is not ready.

## Start here

- `src/index.ts`, `src/editor.ts` and `src/nodes/`: native facade foundation over the backend; foreign construction and the complete export surface remain unfinished.
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

- In this package: `TMPDIR=/home/wolf/tmp CARGO_BUILD_JOBS=2 bun run test`, `bun run check`.
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

Use installForeign/setForeignMask for the wired mutable text and structural hooks; backend owns original callbacks and Rust receives weak forwarding functions. hosting.test.ts exercises real optimized WASM dispatch, native-super and opaque errors; full prototype-driven class instantiation, other hooks and per-hook hosting acceptance remain in scope.

Structural hosting covers append, splice, remove, setIndent, updateFromJSON and resetOnCopyNodeFrom. Preserve variadic append versus nested splice arrays, and encode model-triggered node arguments with the same callback identity store. Node-returning replace/insertAfter/insertBefore/createParentElementNode hooks validate results through the shared captured identity store; unit hooks ignore arbitrary returns. Pure hooks still require their own adapters.

Mutable insertNewAfter/collapseAtStart callbacks receive the existing selection slot handle; static transform callbacks run through the same exact transaction frame. Optional node returns accept null and reject undefined; collapse results use JS truthiness. Full pure and clone hosting and class construction remain unfinished.

Use hosting-import.test.ts for the actual WASM static importJSON bridge: null receiver, serialized argument, recursive child import/append, inherited factory fallback and invalid/opaque result recovery. This does not replace full class construction or explicit native-super import acceptance.

Use hosting-selection-transform.test.ts for previous/current identity, anchor-to-focus movement, native-super and opaque recovery over the actual WASM artifact. Previous selection/point handles first captured in a later aborted update belong to their committed version.

Exercise pure exportJSON against the real WASM read peer, including nested exports, mutable-to-pure reentry, opaque throws, local detached values and node/effect rejection. Keep inherited-selection restrictions explicit until the full synchronization protocol lands; committed-state captures require the exact state-read or publication lease.

Cover node-result conversion with opaque top-level/nested getter and proxy throws, then verify mutable reentry and disposal. Return conversion must stay inside the callback frame and preserve null/undefined behavior.

Verify attached foreign exports at commit, previous/current selections, opaque conversion rollback and ViewAttached writable-handle/cache identity. Unrelated originless captures and derived captures after preparation must reject.

Verify input getter/proxy exceptions for calls, native super, construction and update tags, followed by usable calls and disposal. Preserve lazy input access and the differential suite's prefix-byte observations.

Use state-read.test.ts for real WASM associated reads: old/current graphs, latest previous-selection ownership, nested success/error restoration, suspended writes, foreign callbacks and opaque body returns. readState is the associated-editor primitive; editor-less reads still need explicit facade behavior.

Exercise hosted isInline with original arguments, read guards, native super, opaque returns/throws, no later callback after failure, nested caught failures and fixed text/line-break inline flags. Keep remaining pure hooks disabled until their failure and mutation paths are verified.

Use hosting-empty.test.ts for native child-removal dispatch of canBeEmpty, native super and falsy returns. After a throw, the child remains detached while the empty parent stays attached until an explicit later edit.

Use hosting-predicates.test.ts for individual no-argument boolean hook dispatch/native-super literals, and hosting-format-predicate.test.ts for native range-format denial, throw suppression and recovery.

Node-argument canMergeWith/canReplaceWith/canInsertAfter predicates retain original indexed arguments; internal native calls encode their node through the shared owned read peer. Exercise native list append failure and retry in hosting-node-predicates.test.ts.

Use hosting-scalars.test.ts for owned-peer getIndent/getTextContent reads and excludeFromCopy destinations. Scalar hooks require their declared primitive type; reject objects without getters/coercion, invalid u32 indents, and preserve opaque throws/recovery.

Exercise clone staging, original-version reads, native copyNode fresh keys, read guards, opaque throws and retry in hosting-clone.test.ts. Class construction/opaque custom fields remain part of the full facade.

Use hosting-extract.test.ts for child/selection/destination dispatch and native markdown extraction with selection identity, native super and opaque failure/retry. These backend literals do not replace full subclass acceptance.

Keep native node graph methods on the active runtime; captured raw fields and is() use their original record keys. Save the actual state handle at publication for historical toJSON. Editor-less reads expose state helpers without an active editor. Native constructor field accessors currently read captured versions; writable fields and explicit older-native-prototype dispatch still require their model bridges.
