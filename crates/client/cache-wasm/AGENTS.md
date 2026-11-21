# cache-wasm

## What it is

Part of the web client's shared infrastructure: the browser-only
wasm-bindgen shell exposing `cache-core` + `cache-turso` + `turso-opfs` as a
`CacheEngine` JS class to the web worker glue in
`apps/web/src/lib/graphql-cache/`.

## Start here

- `src/shell.rs`: the `CacheEngine` wasm-bindgen class — translates JS calls
  into `cache-core` engine calls behind an async mutex.
- `src/shell/people.rs`: scoped person-context state/update/search, bounded label-reference reads and local Turso SQL (`peopleReadSql`) under the same engine lock; `shell/test/people.rs` exercises the real browser ABI and stale-generation rejection.
- `src/query_telemetry.rs`: slow-query callback exposed to JS.
- `checkpointIfDue` in `src/shell.rs`: cache-turso's idle WAL copy, called by the engine worker once it has been quiet after a request that can write (`scheduleIdleCheckpoint` in `apps/web/src/lib/graphql-cache/worker/worker-core.ts`).
- `prepareHydrate`/`commitHydrate` in `src/shell.rs`: `hydrateQuery` in two halves, so the engine worker can answer reads between them (`hydrate` in `worker-core.ts`). The commit writes as a `hydrateQuery` issued at commit time: it reads the projections again when the WAL position moved or a clear, reset or authority transition marked them stale. `stageHydrate` between them computes the write while it only reads (`Engine::stage_hydrate` in cache-core), and the commit writes that staged write as it is while the WAL position and the engine (`staged_hydrate_current`) are unchanged; otherwise it runs the hydrate whole.
- `src/shell/authority.rs`: durable policy transitions and interrupted CRM retirement. The shared TS worker compares response generations before writes; queued enqueue/settlement require an explicit generation and call the shared core `_in_generation` methods under the WASM engine lock so stale commands settle without copied snapshots while retaining fresh query revalidations. Reads do not request proof. `tests/authority.rs` covers first-proof offline preservation and reads normalized records after stale-generation enqueue/settlement through real OPFS. Coordinator protocol 18 carries the generation independently of existing hydration/person scopes.
- `apps/web/src/lib/graphql-cache/`: the JS/TS worker that owns this engine.

## Scope

- Owns: the wasm boundary — operation-id interning (`"{clientId}:{urqlKey}"` →
  internal `u64`), Promise-based method signatures, and composing `soup-filter-cache-adapter`
  at the browser composition edge.
- Not here: cache engine logic → `crates/client/cache-core`; Soup-specific
  projection policy → `soup_filter_cache_adapter`, `soup_filter_projection`
  (composed here, not reimplemented); OPFS storage → `crates/client/cache-turso`,
  `crates/client/turso-opfs`.

## Boundaries

- Depends on: `cache-core` (all targets), `cache-turso`/`turso-opfs`/
  `soup-filter-cache-adapter` (wasm32 target only).
- Used by: `apps/web` only, through the generated wasm-bindgen glue — no other
  Rust crate depends on this one.

## Recipes

- Expose a new engine capability to JS: implement it in `cache-core` first →
  add the wasm-bindgen method in `src/shell.rs` → update the TS caller in
  `apps/web/src/lib/graphql-cache/`.

## Checks

- Off-wasm: `cargo test -p cache-wasm` compiles the empty non-wasm shell only.
- Real coverage is wasm32: `cargo test --target wasm32-unknown-unknown -p cache-wasm`
  (see `crates/client/turso-opfs/README.md` for the `wasm-bindgen-test` pattern
  this crate also follows).

## Gotchas

- Keep first account binding without a stored policy generation-neutral, including after reopening OPFS; policy-bearing binding and account replacement retain the shared core's fence.

- Preserve successful hydration replies when optional window-proof computation
  fails; empty proofs retain broad invalidation after the durable write.
- Pass the existing entity-filter `baseline` to Mail pagination too; `retainedKeys`
  tells the frontend which server rows still lack canonical local metadata.

- Mail profiles v5/v6 require the corresponding native engine for offline behavior.
  The server emits v5 only after explicit HTTP/WS capability negotiation; unadvertised
  clients receive v2 so old engines retain durable offline draft admission.

- Email send persistence and cancellation belong to the frontend email journal, not the normalized cache or its mutation queue.

- Person search uses the shared core's indexed policy-7 name/list/recency reader; reference evidence keeps its independent policy-4 contract. Ordinary title search retains its bounded scorer. Browser parity coverage lives in `cache-turso/tests/web.rs`.
- Hydration forwards an optional shared-core `HydrationScope`; stale pages reject before persistence without changing identity. `shell/test/hydration_scope.rs` covers the real browser ABI. Coordinator protocol 17 also carries contact snapshots/reconciliation and local people SQL without dropping hydration/person-policy scopes. Missing sync, SQL or reference support is independent of existing person search support; none may fall back to directory enumeration, unguarded contact writes or remote SQL. `contactSnapshot` captures admission before fetching; `contactReconcile` publishes ordinary committed invalidations for removals. Contact hydration must forward `HydrationScope.contactFence` unchanged.
- The engine is guarded by an async mutex so overlapping JS calls serialize
  instead of causing reentrancy — don't bypass it with a second entry point.
- Compiles to an empty shell off-wasm specifically so plain `cargo test` across
  the workspace stays green; don't make the non-wasm cfg path do real work.

## Related

- Rules: `.agents/rules/rust/architecture.md`
