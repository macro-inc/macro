# Cache Revision Plan

## Objective

Add a generic, monotonic cache revision to `cache-core` and propagate it through the browser cache stack so consumers can distinguish these states without issuing a new API request:

1. a live network response written at the current cache revision is authoritative;
2. a later cache mutation makes that network response stale;
3. an exact local predicate evaluation at the latest revision may temporarily become authoritative;
4. a newer live network response restores network authority.

The first consumer is flat GraphQL Soup. The revision mechanism itself must remain independent of Soup, GraphQL entity types, filter literals, and Turso schema details.

## Motivation

The normalized cache currently emits an unversioned `cache-changed` event. `createGraphqlSoupAstItemsQuery` converts that event into a component-local counter and reruns `entityFilter`, but the counter does not establish which cache snapshot produced any of the following:

- a network query result;
- predicate-index keys;
- records selected after predicate evaluation;
- a cross-tab cache notification.

This creates two gaps:

- a non-optimistic local result is hidden once `query.data` exists, so a realtime-created entity may not appear in the UI;
- `entityFilter` and `readRecordsByKeys` are separate requests, so a cache mutation between them can combine keys and records from different snapshots.

A cache revision provides the ordering and validation primitive needed to solve both gaps. It is also a prerequisite for revision-safe local predicate pagination, but pagination is explicitly deferred until revisioning is complete.

## Confirmed decisions

1. `cache-core` owns the revision type and revision semantics.
2. The revision is generic cache metadata. Soup-specific code only consumes it.
3. Revisions are monotonic within one physical cache incarnation and are serialized on the JavaScript wire as decimal strings, not JavaScript numbers.
4. A physical reset, identity reset, or owner-loss recovery invalidates prior revision comparisons through the existing reset lifecycle. Revisions from different physical incarnations must never be ordered against each other.
5. Revision advancement is atomic with the storage transaction that mutates durable cache-visible state.
6. Conservative advancement is acceptable: a successful mutating command may advance the revision even if its payload is idempotent. False-positive local reevaluation is safe; a missed advancement is not.
7. Reads, dependency registration, teardown, mutation claim, and mutation defer do not advance the revision because they do not change the effective cached view.
8. Authoritative record/projection writes, optimistic enqueue, optimistic commit/rollback, explicit deletion, and clear advance the revision.
9. Cross-context invalidation of in-memory state observes the writer's revision; it must not independently create a second revision for the same durable mutation.
10. Predicate evaluation and subsequent record selection must report their read revisions. The frontend accepts the composed result only when both revisions equal the current cache revision.
11. Only a live network response observed by the current urql operation establishes network authority. A reconstructed normalized-cache hit is useful fallback data but is not treated as proof that no later realtime membership change occurred before the component mounted.
12. Local predicate pagination is out of scope for this change. Its future cursor must carry the cache revision introduced here.
13. Browser Turso/OPFS is the first end-to-end host. In-memory storage remains the reference implementation. Tauri must continue compiling and may expose the revision later with its cache host implementation.

## Revision semantics

### Core type

Add a small opaque type in `cache-core`, for example:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct CacheRevision(u64);
```

Required operations:

- construct the initial revision (`0`);
- read the raw value only at storage/wire boundaries;
- checked successor generation;
- display/parse as a decimal string;
- reject malformed or overflowing wire/storage values.

Do not expose arithmetic to application consumers. Consumers compare revisions only for equality or ordering within the current cache incarnation.

### What advances the revision

Advance once in the durable transaction for each successful cache-view mutation:

| Operation | Advance? | Reason |
| --- | --- | --- |
| authoritative query/hydration/subscription write | yes | durable normalized records and projections may change |
| optimistic enqueue | yes | effective normalized/projection view changes |
| optimistic commit | yes | optimistic state is replaced by authoritative state |
| optimistic rollback | yes | optimistic state is removed |
| explicit record/projection deletion | yes | visible membership/data may change |
| clear/logout/identity reset | yes | all prior cached state becomes invalid |
| mutation claim/defer | no | lease/retry metadata is not part of the effective view |
| read/search/filter/selection | no | observation only |
| dependency registration/teardown | no | operation bookkeeping only |
| hot-tier eviction/invalidation after another writer | no | observe the writer's existing revision |

If a stale optimistic claim fails, do not advance. If a mutating transaction rolls back, do not advance.

### Reset boundary

A numeric revision alone does not identify a physical database incarnation. Existing cache reset and owner-epoch-loss behavior must remain the boundary:

- `reset: true` invalidates every consumer watermark;
- physical storage replacement invalidates host state before the replacement engine serves reads;
- a new physical cache begins at revision `0`;
- no code compares a pre-reset revision to a post-reset revision.

If later consumers need revisions to survive without an explicit reset signal, introduce an incarnation token then. Do not add a random UUID or epoch to `cache-core` speculatively in this phase.

## Architecture

```text
cache-core
  CacheRevision + revisioned engine outcomes
       ▲                         ▲
       │                         │
InMemoryStorage             cache-turso
reference counter       persisted meta counter,
                         atomic transaction bumps
                                  │
                              cache-wasm
                                  │
                         worker/coordinator protocol
                                  │
                         normalized-cache exchange
                                  │
                    GraphQL Soup authority state machine
```

Dependency boundaries remain unchanged:

- `cache-core` knows only generic records, projections, searches, operations, and revisions;
- `cache-turso` owns persistence and atomic revision advancement;
- `cache-wasm` converts typed Rust revisions to decimal wire strings;
- TypeScript cache protocol and hosts transport opaque revisions;
- Soup code decides when a revision mismatch should trigger local predicate evaluation.

## Phase 1: Add revision types and storage contracts

### Generic outcomes

Introduce a generic revisioned observation type where useful:

```rust
pub struct Revisioned<T> {
    pub revision: CacheRevision,
    pub value: T,
}
```

Add `revision: CacheRevision` to `cache_core::engine::WriteResult`.

Revise storage contracts so the storage implementation, not the engine after the fact, assigns the revision committed by a mutating transaction. Candidate APIs may return `Revisioned<()>`, `Revisioned<bool>`, or a dedicated mutation outcome. Preserve stale-claim information without advancing the counter.

At minimum, make these observations revision-aware:

- engine write results;
- predicate query results;
- record selection results used after predicate evaluation;
- current revision lookup during engine initialization/recovery.

Avoid changing every generic read API unless it needs snapshot validation. The first correctness boundary is predicate evaluation followed by normalized record selection.

### In-memory reference storage

Add a revision field to `InMemoryStorage` and apply exactly the same advancement table as Turso.

Tests must establish the semantics before implementing Turso:

- initial revision is zero;
- each successful view mutation advances once;
- reads and lease-only mutation operations do not advance;
- stale claims and failed writes do not advance;
- clear advances while removing cached data;
- predicate and record-selection reads report the revision they observed;
- revision overflow is rejected rather than wrapped.

## Phase 2: Persist revisions atomically in Turso

### Schema

Use the existing `meta` table with a required `cache_revision` row. A new database initializes it to `0`.

Because the storage schema is frozen and validated exactly:

- increment `STORAGE_SCHEMA_VERSION`;
- update expected metadata validation;
- allow the existing compatibility/reset path to replace older physical databases;
- do not hand-edit or partially migrate an incompatible browser database.

### Transaction helpers

Add internal helpers that run only inside the current Turso transaction:

```text
read_cache_revision(connection) -> CacheRevision
advance_cache_revision(connection) -> CacheRevision
```

`advance_cache_revision` must:

1. validate the stored decimal value;
2. checked-increment it;
3. persist the successor;
4. return the successor before the transaction commits.

All durable view-changing methods advance in the same transaction as their existing record, projection, queue, or deletion changes. `clear` deletes cache data but preserves and increments the revision metadata row.

Revision reads required for predicate evaluation must occur in the same read transaction as completeness checking and SQL evaluation. Record-selection reads used by Soup must likewise return the revision observed by their read transaction.

### Fault and conformance tests

Extend storage conformance and fault-injection tests to prove:

- data/projection changes and revision advancement commit together;
- injected rollback leaves both data and revision unchanged;
- optimistic queue/layer writes and revision advancement commit together;
- stale claim settlement does not advance;
- clear preserves the metadata row and advances exactly once;
- healthy reopen preserves the revision;
- physical reset starts a new revision sequence;
- in-memory and Turso implementations produce identical revision traces.

## Phase 3: Integrate revisions into `cache-core::Engine`

The engine should maintain the latest observed revision as a hot value, hydrated from storage when necessary. It must update that value only from successful storage outcomes.

Update all `WriteResult` construction sites, including:

- ordinary and registered network writes;
- hydration;
- optimistic enqueue;
- optimistic queue refresh;
- optimistic commit and rollback;
- direct record/projection writes;
- explicit deletion and clear;
- external reset/invalidation paths.

Rules:

- the returned revision describes the effective cache state after the operation;
- a write result and its `changed`/`affected_ops` sets refer to the same committed transition;
- refreshing state written by another engine observes the durable revision and does not increment it;
- external invalidation accepts or reloads the writer revision and never moves the engine revision backward;
- reset clears in-memory revision assumptions before hydrating the replacement storage state.

### Predicate-to-selection consistency

Change the local filter workflow from:

```text
entityFilter -> keys
readRecordsByKeys(keys) -> records
```

to a validated revision sequence:

```text
entityFilter -> { revision: R, keys }
readRecordsByKeys(keys) -> { revision: S, records }
accept only when R == S == current cache revision
```

If the revisions differ, retry the complete filter-and-selection sequence with a bounded latest-wins request id. Do not render a mixed snapshot.

A future optimization may combine filter execution and selection into one engine request/transaction. That is not required for the first revision implementation.

## Phase 4: Propagate revisions through WASM and the worker protocol

### WASM boundary

Serialize revisions as decimal strings in all JavaScript-facing structures. Extend at least:

- `JsWriteResult`;
- entity-filter complete/incomplete outcomes;
- record-selection results;
- clear/reset outcomes where a cache-change event is emitted;
- optimistic refresh/settlement outcomes.

Do not convert a `u64` revision to `f64` or a JavaScript number.

### TypeScript protocol

Add an opaque branded or nominal wire type:

```ts
export type CacheRevision = string & { readonly __cacheRevision: unique symbol };
```

Strictly validate decimal canonical form and bounds at protocol ingress.

Update:

- `WriteResult` with `revision`;
- `EntityFilterCacheResult` with the evaluated revision when cache execution occurs;
- record-selection response with `revision` and `records`;
- `CachePush` to `{ kind: 'cache-changed'; revision }`;
- `CacheHost.onCacheChanged` to receive the revision;
- worker/coordinator validators, routers, fakes, and browser harnesses.

The worker must fan out the exact revision returned by the engine mutation. It must not synthesize a second increment. Message ordering must guarantee that the cache-change push and RPC response for one mutation carry the same revision, regardless of which arrives at a page first.

`invalidate` and cross-context refresh paths must propagate the writer's revision or read the current durable revision. They must not emit an unversioned cache-change event.

## Phase 5: Tag normalized-cache query results

The normalized-cache exchange currently awaits `host.writeQuery` but discards the write result when forwarding the GraphQL `OperationResult` to observers.

After a successful network query write:

1. retain the returned cache revision;
2. attach it to private normalized-cache result metadata/extensions;
3. preserve it through `createUrqlInfiniteQuery.onResult`;
4. distinguish a live network response from a reconstructed cache hit and an affected cache-only reread.

Do not infer network authority solely from `stale === false`; cache-driven rereads may also be non-stale. Add explicit private result-source metadata at the exchange boundary.

Subscription writes also carry revisions, but their operation results do not establish authority for an active Soup query. They advance the cache revision and trigger local reevaluation.

A persisted per-query network-authority watermark is out of scope. On component mount:

- normalized cached query data may be displayed as fallback;
- an exact local filter may replace it;
- only a newly observed live network response establishes network authority at a revision.

This avoids adding per-field revision metadata to normalized `Record` values in the first phase.

## Phase 6: Add the Soup authority state machine

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
| cache changes to `R+1` | network remains visible but stale while local evaluation runs |
| complete filter and selection both evaluate at current `R+1` | local authoritative |
| incomplete/unsupported local evaluation | retain stale network fallback and continue/fail through existing network policy |
| newer live network result written at current `R+2` | clear older local authority; network authoritative |
| cache changes while local evaluation is in flight | discard old evaluation and restart for latest revision |
| reset/identity change | clear all authority watermarks and local projections |

Rendering precedence becomes revision-based rather than `optimistic`-based:

```text
fresh live network at current revision
    > complete local projection at current revision
    > stale normalized/network fallback
    > undefined
```

Optimistic projections naturally advance the revision and therefore use the same local path. Keep explicit optimistic state only for UI status and mutation-settlement behavior, not as the sole reason local data may override `query.data`.

### Pagination behavior in this phase

The predicate index still returns only an initial page. When local authority replaces a network result:

- reset loaded continuation pages to prevent mixing revisions;
- do not reuse a server continuation cursor with local data;
- preserve existing network fetch behavior if the user requests further pages;
- document that fully offline continuation waits for the later predicate-pagination phase.

## Phase 7: Verification

### `cache-core`

- revision starts at zero and advances according to the table;
- failed transactions and stale claims do not advance;
- write result revision matches the effective record/projection view;
- external refresh observes rather than duplicates revisions;
- reset invalidates prior revision assumptions;
- filter and selection revision mismatch is detectable.

### `cache-turso`

- metadata schema validation includes `cache_revision`;
- all mutating transaction fault sites preserve revision atomicity;
- reopen preserves revision;
- clear advances without deleting revision metadata;
- reference and Turso revision traces match.

### WASM/protocol/worker

- revisions round-trip beyond JavaScript's safe integer range;
- malformed, negative, non-canonical, and overflowing strings are rejected;
- every cache-change push includes the engine revision;
- push/RPC ordering cannot create different revisions for one transition;
- coordinator forwarding preserves revisions across tabs;
- worker replacement/reset clears stale watermarks.

### Exchange

- a network operation result receives the revision returned by its cache write;
- cache hits and affected rereads are not mislabeled as live network authority;
- subscription writes advance cache revision without becoming query authority;
- query and subscription write ordering is deterministic.

### Solid Soup integration

Add a regression test that:

1. receives an initial network Soup result at revision `R`;
2. confirms it remains authoritative while revision `R` is stable;
3. receives a realtime Soup item and cache-change revision `R+1`;
4. evaluates the local filter and selects records at `R+1`;
5. confirms the new item appears reactively;
6. confirms the GraphQL query execution count did not increase;
7. receives a newer network result at `R+2` and confirms network authority resumes;
8. changes revision during an in-flight local evaluation and confirms the stale result is discarded.

Also cover incomplete local scope, deletion, reorder, optimistic settlement, reset, and component mount after an earlier realtime update.

## Observability

Add low-cardinality telemetry for:

- authority source: `network`, `local`, or `stale-fallback`;
- local evaluation discarded due to revision mismatch;
- filter/selection revision retry count;
- local evaluation latency;
- cache revision advancement category, without logging revision values as metric attributes;
- stale fallback duration before local or network authority resumes.

Do not include entity ids, filter payloads, user ids, or raw revision values in telemetry dimensions.

## Deferred work

- local predicate continuation cursors and page chains;
- per-query or per-field persisted network-authority watermarks;
- partition/attribute-scoped revisions to reduce false-positive reevaluation;
- atomic combined predicate evaluation and record selection;
- Tauri host revision transport if its normalized cache implementation diverges;
- server/client revision comparison;
- revision history, snapshots, or multi-version concurrency.

Future local predicate cursors must include at least:

```text
cache revision + query fingerprint + sort value + stable record-key tie-breaker
```

A continuation whose revision differs from the current cache revision must be rejected or reset.

## Implementation order and revision discipline

Implement in independently verified Jujutsu revisions:

1. cache revision type, semantics, and in-memory conformance tests;
2. Turso metadata counter, schema reset, and transaction fault tests;
3. revisioned engine write/filter/selection outcomes;
4. WASM serialization and TypeScript protocol propagation;
5. worker/coordinator revision fan-out and recovery behavior;
6. normalized-cache live-network result tagging;
7. Soup authority state machine and no-network realtime regression test;
8. browser WASM and cross-tab end-to-end verification;
9. telemetry and documentation updates.

After each successful verification step, follow repository policy:

```bash
jj desc -m "description of verified cache revision change" && jj new
```

## Acceptance criteria

- Every durable cache-visible mutation has one committed revision outcome.
- A rolled-back or rejected mutation cannot advance the revision.
- Cache-change pushes are never unversioned.
- The worker does not invent revisions independently of `cache-core`/storage.
- Predicate keys and selected normalized records are rendered only from the same current revision.
- A live network response remains authoritative while its revision is current.
- A later realtime revision can make an exact local Soup result authoritative without another network request.
- A newer live network response restores network authority.
- Reset and owner-loss paths cannot compare revisions across cache incarnations.
- No Soup semantics enter `cache-core` or `cache-turso`.
- Local predicate pagination is not implemented until revision semantics and browser propagation are verified.
