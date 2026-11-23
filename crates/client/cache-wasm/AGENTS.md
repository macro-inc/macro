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
- `prepareHydrate`/`commitHydrate` in `src/shell.rs`: `hydrateQuery` in two halves, so the engine worker can answer reads between them (`hydrate` in `worker-core.ts`). The commit writes as a `hydrateQuery` issued at commit time: it reads the projections again when the WAL position moved or a clear, reset or authority transition marked them stale. `prepareHydrate` normalizes the response once and reads the rows it sets itself; `stepHydrate` runs one projection pass (`WritePasses::step`: notifications, Mail, properties) and resolves whether one ran, and stops once the WAL position moved, leaving the commit to read them again whole. `stageHydrate` and `commitHydrate` run any passes left first, so a host that never steps behaves as before. `stageHydrate` between them computes the write while it only reads (`Engine::stage_hydrate` in cache-core), and the commit writes that staged write as it is while the WAL position and the engine (`staged_hydrate_current`) are unchanged; otherwise it runs the hydrate whole.
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
- Browser upgrade cost: serve the directory `CACHE_MIGRATION_OUT` filled (see
  `cache-turso`'s Checks) with CORS, then
  `CACHE_MIGRATION_URL=<url of one tier> cargo test --release --target wasm32-unknown-unknown -p cache-wasm --lib -- carry_forward_and_upgrade_cost --include-ignored --nocapture`
  times a reopen, the carry-forward alone, and the carry-forward with the 11 to 12
  upgrade over real OPFS.

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
- An ordinary open whose database does not exist yet first carries the newest
  upgradable older storage version forward (`carry_forward` in `src/shell.rs`,
  after the storage grant), holding the older name's lock until the first open
  ends, then opens it, which upgrades it in place; it first resumes a move an
  earlier open left unfinished. A whole older pair with a marker of its own
  stays with its build (`older-in-use`); a marker beside no whole pair lets the
  scan go on. So moved files are at the version of the name they came from.
  Moved files an open would reset go back to the
  older name (`hand_back`) only when the failed open left them at the version
  they moved at (`TursoStorageOpenFailure::stored_storage_version`); at a newer
  version they are discarded. A recovery open decides the same before wiping
  (`recover_adoption`): it counts an attempt (`record_attempt`) and keeps the
  marker until it has read the version and acted on it. Whatever leaves either
  open unsure (an unreadable adoption state or version, a split needing the
  busy older lock, a failed connect, a WAL with frames) fails the open and
  keeps the files for the coordinator's next recovery, which discards them
  unopened once more than `RECOVERY_ATTEMPTS` (3) were counted (the fourth); when the marker does not
  read, their version is unknown. An attempt that cannot be counted decides as
  any other, and only where it would keep the files discards them once
  `UNCOUNTED_RECOVERY_MS` (10 minutes) passed since the adoption began (by the
  marker's time, read alone when the files beside it do not read), except
  after a version probe that met a file another context holds open (a wipe
  would meet it too) or gave the owner up (an open whose cleanup was uncertain,
  or a failed connect, close or reset): only the count bounds those; one that
  could not read the adoption reads it again first (`unreadable_adoption`), and
  with neither marker nor count readable it keeps them. Either open that keeps
  moved files marks its error `cacheRecoveryDeferred` (`recovery_deferred`),
  which the worker reports as `movedFilesKept` beside its failure code; the
  coordinator then keeps the scope instead of failing for good until an open
  succeeds, so the page's cache recovery runs it again later. It does the same
  after an open that reached storage ended without any report, until an open
  that reaches storage reports anything but `storage-busy`; an unmarked failure
  from such an open is a report that nothing was kept. A version probe
  that meets a busy sync handle fails as `storage-busy` too, which ends the
  coordinator's retries the same way, so the count can span page loads. Mark
  every error such an open returns, the owner's release included.
  The result's `outcome` is
  `upgraded-existing` with `fromStorageVersion`;
  `carryForward` (`moved`, `resumed`, `older-in-use`, `unsupported`,
  `unreadable`, `failed`, `returned`, `discarded`) and
  `carryForwardStorageVersion` (absent when unknown) say what happened to the
  older file; add a new value to the web app too, in both
  `CACHE_CARRY_FORWARDS` (`telemetry.ts`) and the `CacheOpenResult` wire type
  (`worker/wasm-module.ts`).
  The carry-forward tests in `shell/test.rs` cover each path over real OPFS.
- Stale cleanup (`remove_stale_cache_database`) removes a split adoption at an
  older name (`OpfsErrorKind::SplitAdoption` from the open) as it removes a
  one-sided pair, rather than rejecting, which ends the web app's sweep.
- The engine is guarded by an async mutex so overlapping JS calls serialize
  instead of causing reentrancy — don't bypass it with a second entry point.
- Compiles to an empty shell off-wasm specifically so plain `cargo test` across
  the workspace stays green; don't make the non-wasm cfg path do real work.

## Related

- Rules: `.agents/rules/rust/architecture.md`
