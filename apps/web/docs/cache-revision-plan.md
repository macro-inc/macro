# Cache Revision Plan

## Objective

Add an in-memory cache revision to `cache-core` and propagate it through the browser cache stack so consumers can distinguish these states without issuing a new API request:

1. a live network response written at the current cache revision is authoritative;
2. a later cache mutation makes that network response stale;
3. an exact local predicate evaluation at the latest revision may become authoritative;
4. a newer live network response restores network authority.

The first consumer is flat GraphQL Soup. The revision mechanism itself must remain independent of Soup, GraphQL entity types, filter literals, Turso, and OPFS.

## Motivation

The normalized cache currently emits an unversioned `cache-changed` event. `createGraphqlSoupAstItemsQuery` converts that event into a component-local counter and reruns `entityFilter`, but the counter does not establish which cache snapshot produced any of the following:

- a live network query result;
- predicate-index keys;
- records selected after predicate evaluation;
- a cross-tab cache notification.

This creates two gaps:

- a non-optimistic local result is hidden once `query.data` exists, so a realtime-created entity may not appear in the UI;
- `entityFilter` and `readRecordsByKeys` are separate requests, so a cache mutation between them can combine keys and records from different logical snapshots.

A cache revision supplies the ordering and validation primitive needed to solve both gaps. It is also a prerequisite for safe local predicate pagination, but pagination is deferred until revisioning is complete.

## Confirmed decisions

1. `cache-core::Engine` owns the revision counter and revision semantics.
2. The revision exists only in application memory. It is not stored in Turso, OPFS, `Storage`, or normalized records.
3. Every new cache engine starts at revision `0` regardless of the durable cache contents it opens.
4. The single elected cache engine and its serialized request handling provide the required ordering. Turso remains responsible only for transactionally committing durable cache data.
5. The engine advances its revision after a successful logical cache mutation and before returning the result to the worker.
6. If the engine dies after a storage commit but before advancing or publishing the revision, the revision domain dies with it. Replacement handling invalidates all old revision watermarks before the new engine serves authoritative results.
7. Revisions are compared only within one engine generation. Consumers use equality, not ordering across generations.
8. The existing coordinator owner epoch fences old engine messages. Engine replacement must additionally clear consumer revision state.
9. Conservative advancement is acceptable: a successful mutating command may advance the revision even when its payload is idempotent. False-positive local reevaluation is safe; a missed advancement is not.
10. Reads, dependency registration, teardown, mutation claim, and mutation defer do not advance the revision because they do not change the effective cached view.
11. Authoritative writes, optimistic changes and settlement, deletion, clear, and external view refresh/invalidation advance the local engine revision.
12. Predicate evaluation and subsequent record selection report their engine revisions. The frontend accepts the composed result only when both revisions equal the current engine revision.
13. Only a live network response observed by the current urql operation establishes network authority. A reconstructed normalized-cache hit is fallback data, not evidence that its membership is current.
14. Local predicate pagination is out of scope. Future local cursors are valid only within the engine generation and revision that created them.

## Why the revision is not persistent

The revision does not identify a durable database snapshot across application lifetimes. It orders logical cache observations handled by one live cache engine.

The browser topology already supplies the needed atomicity boundary:

```text
coordinator admits request
  -> one elected engine handles request
  -> cache-core awaits any storage transaction
  -> cache-core advances its in-memory revision
  -> engine returns result and publishes cache change
  -> coordinator routes the next request
```

No other cache read or write can interleave between the successful logical mutation and its revision assignment. The shell also holds exclusive mutable engine state across each asynchronous engine call.

Persistence would add schema changes and recovery semantics without improving the required behavior:

- after a full application-memory wipe there are no surviving network-authority or local-result watermarks to compare;
- a new engine can treat the durable cache it opens as its revision-`0` initial state;
- local predicate evaluation at revision `0` still sees all durable records and projections;
- offline startup does not need to know how many mutations occurred in a previous application lifetime;
- a crash between durable commit and revision publication destroys the old engine generation, so replacement invalidation prevents a mixed comparison.

Accordingly, this plan requires:

- no Turso `meta` row;
- no `STORAGE_SCHEMA_VERSION` bump;
- no cache migration or physical reset;
- no revision fields in storage traits;
- no revision restoration during engine initialization.

## Revision and generation semantics

### Core revision

Add a small opaque counter type in `cache-core`, for example:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct CacheRevision(u64);
```

Required operations:

- initial revision `0`;
- checked successor generation;
- display/parse as a canonical decimal string at the WASM boundary;
- equality comparison;
- rejection of overflow rather than wrapping.

Do not expose arithmetic to application consumers. Although the counter is monotonic within one engine generation, frontend authority logic should rely on equality with the current revision rather than greater-than comparisons.

### Engine generation

A revision is meaningful only while its cache engine remains active. The existing coordinator `ownerEpoch` defines that engine generation and already fences stale responses and pushes.

The revision itself does not need to contain or persist the owner epoch. Instead:

- the worker host handles the existing `engine-replaced` event before accepting replacement results;
- replacement clears all consumer cache-revision, network-authority, local-projection, and local-cursor state;
- the replacement engine starts at revision `0`;
- old-epoch responses remain rejected by the coordinator;
- queued replacement requests execute only after replacement invalidation is delivered.

If it is difficult to guarantee that lifecycle ordering at every consumer boundary, qualify the wire value with the existing owner epoch:

```ts
type CacheVersion = {
  ownerEpoch: number;
  revision: CacheRevision;
};
```

This is a transport safeguard, not persistence. Prefer explicit replacement invalidation if the current coordinator ordering makes it reliable; use an epoch-qualified wire version if tests expose ambiguity.

### What advances the revision

Advance once after each successful logical command that can change the effective local cache view:

| Operation | Advance? | Reason |
| --- | --- | --- |
| authoritative query/hydration/subscription write | yes | normalized records and projections may change |
| optimistic enqueue | yes | effective normalized/projection view may change |
| optimistic commit | yes | optimistic state is replaced by authoritative state |
| optimistic rollback/discard | yes | optimistic state is removed |
| explicit record/projection deletion | yes | visible membership/data may change |
| clear/logout/identity reset | yes | prior local authority becomes invalid |
| external optimistic queue refresh | yes when accepted | the local effective view may change |
| external hot-tier invalidation/view refresh | yes | subsequent local observations may change |
| mutation claim/defer | no | lease/retry metadata is not part of the effective view |
| read/search/filter/selection | no | observation only |
| dependency registration/teardown | no | operation bookkeeping only |
| failed or stale mutation settlement | no | no logical mutation was accepted |

A failed storage operation does not advance. A panic or engine termination after storage commits is handled as engine-generation loss rather than by recovering a counter.

Clear and identity reset do not reset the active engine counter to zero; they advance it and emit the existing reset semantics. Only creation of a replacement `Engine` starts a new counter at zero.

## Architecture

```text
cache-core::Engine
  in-memory CacheRevision
  logical mutation advancement
  revisioned read/write outcomes
          │
          ▼
cache-wasm shell
  decimal-string serialization
          │
          ▼
dedicated cache engine worker
  serialized request handling
          │
          ▼
SharedWorker coordinator
  one owner + owner-epoch fencing
  revision push fan-out
          │
          ▼
normalized-cache exchange
  live-network authority tagging
          │
          ▼
GraphQL Soup authority state machine
```

Dependency boundaries remain unchanged:

- `cache-core` knows only generic records, projections, operations, and an in-memory revision;
- `cache-turso` continues implementing durable storage without revision awareness;
- `cache-wasm` converts typed Rust revisions to wire strings;
- the worker and coordinator transport revisions and handle generation replacement;
- Soup code decides when a revision mismatch should trigger local predicate evaluation.

## Phase 1: Add the in-memory revision to `cache-core`

### Engine state

Add `revision: CacheRevision` to `cache_core::Engine` and initialize it to zero in every constructor.

Add internal helpers resembling:

```rust
fn current_revision(&self) -> CacheRevision;
fn advance_revision(&mut self) -> Result<CacheRevision, EngineError<_>>;
```

The helper is called only after the underlying logical mutation has succeeded. The resulting revision is included in the operation outcome before exclusive access to the engine is released.

### Revisioned outcomes

Introduce a generic observation type where useful:

```rust
pub struct Revisioned<T> {
    pub revision: CacheRevision,
    pub value: T,
}
```

Add `revision: CacheRevision` to `cache_core::engine::WriteResult`.

At minimum, make these operations revision-aware:

- all engine write results;
- predicate query results;
- record selection used after predicate evaluation;
- clear/reset and external refresh outcomes that produce cache-change pushes;
- a current-revision observation needed by initialization and tests.

Do not change `Storage` return types. The engine assigns revisions around successful storage-backed commands.

### Logical-operation boundaries

Advance once per public engine command, not once per low-level storage call. This is an advantage over a persistent transaction counter: identity binding, normalized records, projection updates, and operation dependency updates can be represented by the revision of the completed logical command.

Audit every `WriteResult` construction and every mutating method, including:

- ordinary and registered network writes;
- hydration and subscription writes;
- optimistic enqueue;
- optimistic queue refresh;
- optimistic commit and rollback;
- direct record/projection writes;
- explicit deletion;
- clear and identity mismatch;
- external invalidation/reset paths.

Rules:

- the returned revision describes the engine view after the command;
- `changed`, `affected_ops`, `reset`, `revalidations`, and `revision` refer to one logical transition;
- stale claims and failed commands return the unchanged current revision when a result is required;
- no command can publish a revision it has not installed as the engine's current revision.

### Core tests

Add tests proving:

- a new engine starts at revision zero even when its storage is pre-populated;
- each successful view mutation advances once;
- a logical command with multiple storage calls advances once;
- reads and lease-only operations do not advance;
- failed writes and stale claims do not advance;
- clear advances but does not restart the counter;
- a replacement engine over the same storage starts again at zero;
- overflow fails rather than wraps;
- predicate and record-selection reads report the revision they observe.

Use `InMemoryStorage` for deterministic revision traces. Existing Turso tests only need to continue passing because its contract is unchanged.

## Phase 2: Guarantee predicate-to-selection consistency

Change the local filter workflow from:

```text
entityFilter -> keys
readRecordsByKeys(keys) -> records
```

to:

```text
entityFilter -> { revision: R, keys }
readRecordsByKeys(keys) -> { revision: S, records }
accept only when R == S == current engine revision
```

The engine revision cannot change during either individual request because engine access is serialized. It may change between the two requests, which is exactly what the comparison detects.

If revisions differ:

1. discard both keys and selected records;
2. restart the full filter-and-selection sequence;
3. use a latest-wins request id so an older asynchronous completion cannot render;
4. bound retries and retain stale fallback data if mutations remain continuous.

A future optimization may combine filter execution and selection into one engine request. It is not required for initial correctness.

## Phase 3: Propagate revisions through WASM and the worker protocol

### WASM boundary

Serialize the in-memory `u64` as a canonical decimal string. Extend at least:

- `JsWriteResult`;
- entity-filter complete/incomplete outcomes;
- record-selection results;
- clear/reset outcomes where a cache-change event is emitted;
- optimistic refresh and settlement outcomes.

Do not serialize the revision as `f64` or a JavaScript number.

### TypeScript protocol

Add an opaque wire type:

```ts
export type CacheRevision = string & {
  readonly __cacheRevision: unique symbol;
};
```

Validate canonical decimal form and the Rust `u64` range at protocol ingress.

Update:

- `WriteResult` with `revision`;
- `EntityFilterCacheResult` with the revision used for cache execution;
- record-selection responses with `revision` and `records`;
- `CachePush` to `{ kind: 'cache-changed'; revision }`;
- `CacheHost.onCacheChanged` to receive the revision;
- worker/coordinator validators, routers, fakes, and browser harnesses.

The engine worker must fan out the exact revision returned by `cache-core`. It must not maintain or increment a second counter.

Message ordering must ensure that the RPC response and cache-change push for one command carry the same revision. Consumers must tolerate either arrival order by comparing equality with the latest observed revision.

### Engine replacement

Extend the existing `engine-replaced` recovery path so revision consumers are invalidated before replacement results are used.

The worker host should expose either:

- a dedicated `onCacheGenerationChanged` callback; or
- a reset-flavored cache-change notification that cannot be mistaken for an ordinary numeric successor.

On replacement, Soup and other consumers clear:

- `currentCacheRevision`;
- `networkAuthorityRevision`;
- in-flight local filter requests;
- local projections;
- future local pagination cursors.

Tests must cover both graceful owner handoff over preserved storage and abrupt loss followed by physical storage reset.

## Phase 4: Tag normalized-cache query results

The normalized-cache exchange currently awaits `host.writeQuery` but discards the write result when forwarding the GraphQL `OperationResult`.

After a successful live network query write:

1. retain the returned engine revision;
2. attach it to private normalized-cache result metadata/extensions;
3. preserve it through `createUrqlInfiniteQuery.onResult`;
4. label the result source explicitly as live network, normalized-cache hit, or affected cache reread.

Do not infer network authority solely from `stale === false`; cache-driven rereads may also be non-stale.

Subscription writes carry and publish revisions, but subscription operation results do not establish authority for an active Soup query. They make the older query revision stale and trigger local reevaluation.

A persisted per-query authority watermark remains out of scope. On component or application startup:

- normalized cached query data may be displayed as fallback;
- an exact local filter evaluates the durable cache as the new engine's current revision;
- only a newly observed live network response establishes network authority.

This is why restarting the in-memory revision at zero is safe.

## Phase 5: Add the Soup authority state machine

Implement the first consumer in:

- `apps/web/src/lib/queries/soup/graphql/items.ts`;
- `apps/web/src/lib/queries/soup/graphql/items.test.ts`.

Track:

```ts
type LocalProjection = {
  revision: CacheRevision;
  data: SoupAstItemsData;
  optimistic: boolean;
};

currentCacheRevision: CacheRevision | undefined;
networkAuthorityRevision: CacheRevision | undefined;
localProjection: LocalProjection | undefined;
```

State transitions:

| Event | Result |
| --- | --- |
| live network result written at `R`, current revision is `R` | network authoritative |
| cache changes to another revision | network remains visible but stale while local evaluation runs |
| filter and selection both complete at the current revision | local authoritative |
| incomplete/unsupported local evaluation | retain stale fallback and follow existing network policy |
| newer live network result is written at the current revision | clear older local authority; network authoritative |
| cache changes while local evaluation is in flight | discard old evaluation and restart for the current revision |
| engine generation changes | clear every revision watermark and local projection |
| clear/identity reset within one engine | invalidate authority using the advanced revision and reset flag |

Rendering precedence becomes revision-based rather than optimistic-only:

```text
live network result whose revision equals current revision
    > complete local projection whose revision equals current revision
    > stale normalized/network fallback
    > undefined
```

Optimistic projections naturally advance the engine revision and therefore use the same local path. Keep explicit optimistic state only for UI status and mutation settlement, not as the sole reason local data may override `query.data`.

### Pagination behavior in this phase

The predicate index still returns only an initial page. When local authority replaces a network result:

- reset loaded continuation pages to prevent mixing revisions;
- do not reuse a server continuation cursor with local data;
- preserve existing network fetch behavior if the user requests further pages;
- document that fully offline continuation waits for the predicate-pagination phase.

A future local cursor must include an engine-generation marker, cache revision, query fingerprint, sort value, and stable record-key tie-breaker. It is discarded on generation replacement or revision mismatch; it is never expected to survive application restart.

## Verification

### `cache-core`

- counter lifecycle and advancement table are enforced;
- one logical command advances at most once;
- failed commands and stale claims do not advance;
- write result revision matches the effective engine view;
- filter and selection revision mismatch is detectable;
- a replacement engine over unchanged durable storage starts at zero safely.

### Storage regression

- all existing `cache-turso` tests pass unchanged in semantics;
- no schema version or metadata changes are introduced;
- durable records, projections, and optimistic layers still hydrate correctly into a revision-zero engine;
- storage faults do not produce successful engine revisions.

### WASM/protocol/worker

- revisions round-trip beyond JavaScript's safe integer range;
- malformed, negative, non-canonical, and overflowing strings are rejected;
- every ordinary cache-change push includes the engine revision;
- push and RPC response use the same revision;
- coordinator forwarding preserves revisions across tabs;
- old-owner messages remain fenced;
- graceful and abrupt engine replacement invalidate old consumer watermarks before replacement results are accepted.

### Exchange

- a live network operation result receives the revision returned by its cache write;
- cache hits and affected rereads are not mislabeled as live network authority;
- subscription writes advance cache revision without becoming query authority;
- result/push arrival order does not change final authority.

### Solid Soup integration

Add a regression test that:

1. receives an initial network Soup result at revision `R`;
2. confirms it remains authoritative while `R` is current;
3. receives a realtime Soup item and a new cache revision;
4. evaluates the local filter and selects records at that revision;
5. confirms the new item appears reactively;
6. confirms the GraphQL query execution count did not increase;
7. receives a newer network result and confirms network authority resumes;
8. changes revision during an in-flight local evaluation and confirms the stale result is discarded;
9. replaces the engine, restarts at revision zero, and confirms old authority is not reused.

Also cover incomplete local scope, deletion, reorder, optimistic settlement, clear, identity reset, and component mount over pre-existing durable cache data.

## Observability

Add low-cardinality telemetry for:

- authority source: `network`, `local`, or `stale-fallback`;
- local evaluation discarded because its revision is no longer current;
- filter/selection retry count;
- local evaluation latency;
- engine generation replacement;
- revision advancement category, without using revision values as metric attributes;
- stale fallback duration before local or network authority resumes.

Do not include entity ids, filter payloads, user ids, owner epochs, or raw revision values in telemetry dimensions.

## Deferred work

- local predicate continuation cursors and page chains;
- per-query or per-field persisted network-authority watermarks;
- durable revisions or cursors across application restarts;
- partition/attribute-scoped counters to reduce false-positive reevaluation;
- atomic combined predicate evaluation and record selection;
- Tauri host revision transport if its normalized cache implementation diverges;
- server/client revision comparison;
- revision history, snapshots, or multi-version concurrency.

## Implementation order and revision discipline

Implement in independently verified Jujutsu revisions:

1. `CacheRevision`, in-memory engine state, and core tests;
2. revisioned engine write/filter/selection outcomes;
3. WASM serialization and TypeScript protocol propagation;
4. worker/coordinator fan-out and engine-generation invalidation;
5. normalized-cache live-network result tagging;
6. Soup authority state machine and no-network realtime regression test;
7. browser WASM, owner-handoff, and cross-tab verification;
8. telemetry and documentation updates;
9. revision-bound predicate pagination as a separate follow-up project.

After each successful verification step, follow repository policy:

```bash
jj desc -m "description of verified cache revision change" && jj new
```

## Acceptance criteria

- `cache-core::Engine` starts an in-memory revision counter at zero.
- Every successful logical cache-view mutation produces one installed revision outcome.
- A failed or rejected command cannot advance the revision.
- No revision state or counter is added to Turso, OPFS, storage traits, or normalized records.
- The worker does not invent a second revision independently of `cache-core`.
- Ordinary cache-change pushes are versioned.
- Engine replacement invalidates all old revision comparisons before a revision-zero replacement is used.
- Predicate keys and selected records are rendered only when their revisions match the current engine revision.
- A live network response remains authoritative while its revision is current.
- A later realtime revision can make an exact local Soup result authoritative without another network request.
- A newer live network response restores network authority.
- No Soup semantics enter `cache-core`, `cache-turso`, or worker coordination.
- Local predicate pagination is not implemented until in-memory revision semantics and generation replacement are verified.
