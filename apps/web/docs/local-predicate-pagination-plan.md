# Revision-Safe Local Predicate Pagination Plan

Status: **optimistic predicate-index prerequisite complete; ready for implementation**

## Objective

Extend the browser Turso/OPFS-backed `soup-flat-v1` predicate index from an initial-page-only evaluator into a revision-safe local paginator.

When a flat GraphQL Soup query is locally supported and complete, the UI must be able to load every local page without issuing a GraphQL Soup network request. A network response remains authoritative while its cache revision is current. If the cache advances, the UI switches to a local page chain evaluated entirely at one cache-engine generation and revision. A later live network response replaces that local chain and becomes authoritative again.

This plan builds on:

- `apps/web/docs/entity-filter-cache-index-plan.md`;
- `apps/web/docs/soup-flat-v1-support-manifest.md`;
- the completed prerequisite [`optimistic-predicate-fact-index-plan.md`](./optimistic-predicate-fact-index-plan.md), which provides an exact effective authoritative-plus-optimistic SQL universe;
- the existing cache revision propagated through `cache-core`, WASM, worker hosts, urql result metadata, `entityFilter`, and `readRecordsByKeys`;
- the current revision-authority state machine in `apps/web/src/lib/queries/soup/graphql/items.ts`.

## Current state

Local predicate pagination does not exist today:

- `predicate_index::IndexQuery` has a bounded initial-page `limit`, but no cursor;
- `item_filter_index::SoupFlatRequest` rejects `has_cursor` with `UnsupportedReason::Cursor`;
- `soup-filter-cache-adapter` always compiles with `has_cursor: false`;
- Turso predicate SQL orders and limits matches but has no keyset boundary;
- the frontend calls `entityFilter` only for GraphQL `initial` inputs;
- once a local projection becomes authoritative, `fetchNextPage` discards it and returns to the stale server page chain.

After the optimistic fact-index prerequisite is complete, the index has the required effective document universe and ordering basis: one integer sort fact plus a stable normalized-record-key tie-breaker. The remaining work is cursor representation, keyset execution, revision validation, browser transport, and local page-chain ownership.

## Confirmed decisions

1. Local predicate cursors are separate from opaque server GraphQL Soup cursors. Neither cursor is translated into the other.
2. A local page chain is valid only within one cache-engine generation and one exact cache revision.
3. Any cache revision or engine-generation change discards the complete local continuation chain and reevaluates its initial page. Pages from different revisions are never merged.
4. A live network response tagged with the current cache revision replaces the local chain and becomes authoritative again.
5. Local pagination remains all-or-network. Unsupported compilation, incomplete projections, malformed cursors, storage errors, or query-relevant uncertainty never produce an approximate page.
6. Cursor pagination uses keyset semantics over `(sort_value, record_key)`, matching the existing ordering exactly.
7. The local cursor is opaque to Soup UI code. The cache boundary validates its version, query identity, generation, revision, and boundary values.
8. Every local page returns normalized keys and is materialized through the generated `SoupItemFields` cache fragment. The frontend does not reimplement filter semantics.
9. Browser Turso/OPFS is the first persistence target. Grouped Soup, Tauri predicate execution, and REST Soup are out of scope.
10. Authorization remains server-side. Pagination can only traverse entities already present in the identity-scoped authorized cache.
11. Pagination consumes the effective predicate query supplied by `optimistic-predicate-fact-index-plan.md`; it does not introduce a second optimistic composition path.

## Authority and page-chain model

The flat Soup query has two mutually exclusive page chains:

```text
network chain
  server cursor + GraphQL pages

local chain
  cache generation + cache revision + local predicate cursor + local pages
```

Authority transitions are:

```text
live network result at revision R
        │
        ▼
network authoritative at R
        │ cache advances to R+1
        ▼
retain network page visibly as stale while evaluating
        │ complete local initial page at R+1
        ▼
local authoritative chain at R+1
        │ local next-page requests use local cursors
        │
        ├── cache advances to R+2 ──► discard chain and reevaluate page 1
        │
        └── live network result at R+2 ──► network authoritative again
```

The UI must never append a local page to a network chain or a network continuation to a local chain. While a local reevaluation is in flight, the previous rendered data may remain visible as stale, but it is not extended.

## Local cursor contract

### Generic boundary

Add a storage-neutral keyset boundary to `predicate-index`:

```rust
pub struct PredicateCursor {
    pub sort_value: i64,
    pub record_key: RecordKey,
}

pub struct PredicatePage {
    pub hits: Vec<PredicateHit>,
    pub next_cursor: Option<PredicateCursor>,
}

pub struct PredicateHit {
    pub record_key: RecordKey,
    pub sort_value: i64,
}
```

`IndexQuery` gains an optional `after: PredicateCursor`. The cursor is exclusive: the cursor record is never repeated on the next page.

The pure reference evaluator and every storage adapter must implement identical cursor semantics. The generic IR does not know Soup fields, GraphQL cursors, browser workers, or cache revisions.

### Browser/cache boundary

Expose an opaque, versioned `EntityFilterCursor` through the browser protocol. Its validated payload binds at least:

- cursor format version;
- active `soup-flat-v1` profile version;
- cache-engine generation;
- cache revision;
- canonical query fingerprint excluding page limit and cursor;
- sort value;
- normalized record key.

The query fingerprint prevents a cursor from one filter, sort, or direction from being reused with another. Generation binding prevents revision `"3"` from an old engine from matching revision `"3"` in a replacement engine. The existing `onCacheGenerationChanged` lifecycle must clear frontend cursor state; the worker boundary must also reject stale-generation cursors rather than relying only on UI ordering.

Extend the browser API conceptually to:

```ts
type EntityFilterCacheArgs = {
  filters: Record<string, unknown>;
  sortMethod: 'CREATED_AT' | 'UPDATED_AT' | 'VIEWED_AT' | 'VIEWED_UPDATED';
  sortDirection: 'ASC' | 'DESC';
  limit: number;
  cursor?: EntityFilterCursor;
};

type EntityFilterCacheResult =
  | {
      kind: 'complete';
      revision: CacheRevision;
      keys: string[];
      nextCursor: EntityFilterCursor | null;
      optimistic: boolean;
    }
  | { kind: 'unsupported' }
  | { kind: 'incomplete'; revision: CacheRevision }
  | { kind: 'stale-cursor'; revision: CacheRevision };
```

A stale cursor is a recoverable control-flow result: clear the local page chain and request its first page at the reported current revision. It is not a user-visible error and must not silently continue from the stale boundary.

## Keyset semantics

For a cursor `(cursor_sort, cursor_key)`, Turso adds a strict boundary matching the requested directions.

For descending sort and descending tie-break:

```sql
AND (
  s.value < ?
  OR (s.value = ? AND d.record_key < ?)
)
```

For ascending sort and ascending tie-break, both comparisons use `>`. The generic compiler must also correctly support mixed sort and tie-break directions even though `soup-flat-v1` currently sets both to the same direction.

The final order remains:

```sql
ORDER BY s.value <sort direction>, d.record_key <tie direction>
```

Fetch one extra effective result. Return at most the requested page size and derive `next_cursor` from the final returned hit only when another effective hit exists. The page-size bound must reserve capacity for this one-row lookahead; if it cannot, return `Incomplete` rather than guessing whether another page exists.

## Optimistic fact-index prerequisite

Implement and verify [`optimistic-predicate-fact-index-plan.md`](./optimistic-predicate-fact-index-plan.md) before beginning this plan. Pagination assumes predicate storage already evaluates one exact effective authoritative-plus-optimistic document universe in SQL.

The pagination implementation must apply its cursor boundary, ordering, and `limit + 1` to that effective universe. It must not restore touched-record overfetch, per-page projection loading, queue replay, or Rust-side optimistic sorting. Enqueue, commit, rollback, and settlement continue to advance cache revision and therefore invalidate every existing local cursor.

## Revision consistency

The existing revision-qualified reads provide the required consistency checks:

1. `entityFilter` returns page keys, cursor, and revision `R`;
2. `readRecordsByKeys` materializes those keys and returns revision `R`;
3. the frontend confirms `currentRevision()` is still `R` before publishing the page;
4. a mismatch discards the page and retries from the current revision;
5. a generation-change notification invalidates all revision and cursor watermarks.

Continuation requests additionally require that the cursor revision equals the engine's current revision before predicate execution. Because engine commands are serialized, a successful predicate call observes one revision. Record selection is a separate command and retains the existing post-selection revision check.

Do not attempt MVCC snapshots across revisions. Revision change means reset and reevaluate, not continue reading an old snapshot.

## Frontend local page state

Replace the single `LocalProjection` in `apps/web/src/lib/queries/soup/graphql/items.ts` with a revision-qualified local chain:

```ts
type LocalPredicatePage = {
  keys: string[];
  data: SoupAstItemsData;
  nextCursor: EntityFilterCursor | null;
};

type LocalPredicateChain = {
  generation: CacheGeneration;
  revision: CacheRevision;
  inputIdentity: string;
  optimistic: boolean;
  pages: LocalPredicatePage[];
};
```

The exact generation representation should reuse the cache host's replacement lifecycle; it must not compare revisions across generations.

Behavior:

- initial local evaluation replaces the entire local chain;
- local `fetchNextPage` evaluates with the last page's local cursor and appends only after revision checks pass;
- duplicate concurrent next-page calls share or reject behind one in-flight promise;
- a filter, sort, limit, feature-option, revision, or generation change invalidates the chain;
- local pages are flattened in order with defensive key deduplication at the page boundary;
- `hasNextPage` comes from the authoritative chain: local `nextCursor` while local, urql while network;
- `isFetchingNextPage` combines local and urql fetch state;
- `resetToInitialPage` drops local continuation pages as well as urql continuation pages;
- `refresh` remains a network-only authority refresh;
- a live initial network result clears the local chain;
- a local incomplete/error result retains stale visible data and marks continuation unavailable until a network refresh establishes a current server cursor.

`fetchNextPage` must never pass a local cursor into `makeGraphqlSoupInput`, and it must never use a stale server cursor after local authority has invalidated the network chain.

## Implementation phases

### Phase 0: Update the support contract

Update the earlier plan and support manifest to replace "initial requests only" and "no local continuation cursor" with the revision-safe pagination contract. Do not expand supported literals or partitions in this work.

Files:

- `apps/web/docs/entity-filter-cache-index-plan.md`;
- `apps/web/docs/soup-flat-v1-support-manifest.md`.

### Phase 1: Add generic cursor and page types

In `predicate-index`:

- add validated cursor and page/hit types;
- add an optional exclusive cursor to `IndexQuery`;
- validate cursor record-key and bounded values;
- update the reference evaluator;
- preserve stable ordering for equal sort values and multiple partitions;
- define bounded page size and one-row lookahead capacity explicitly.

Files:

- `crates/predicate_index/src/lib.rs`;
- `crates/predicate_index/src/test.rs`.

### Phase 2: Add effective Turso keyset execution

In `cache-turso` and `cache-core`:

- return sort value with every predicate hit;
- compile parameterized keyset predicates for all direction combinations;
- apply the boundary to the prerequisite's effective authoritative-plus-optimistic universe;
- fetch one bounded extra result for next-cursor detection;
- retain completeness and relevant-uncertainty checks in the same read transaction;
- return revision-qualified `PredicatePage` values;
- validate expected cursor revision/generation before execution;
- return typed stale-cursor and incomplete outcomes;
- verify relevant authoritative and optimistic indexes with `EXPLAIN QUERY PLAN`;
- avoid scanning normalized record blobs, queue JSON, or projection blobs.

Files:

- `crates/client/cache-core/src/predicate.rs`;
- `crates/client/cache-core/src/engine.rs`;
- `crates/client/cache-core/tests/predicate.rs`;
- `crates/client/cache-core/tests/optimistic.rs` where queue transitions affect cursor validity;
- `crates/client/cache-turso/src/storage.rs`;
- `crates/client/cache-turso/src/storage/test.rs`;
- `crates/client/cache-turso/tests/predicate.rs`.

### Phase 3: Compile and transport local cursors

In the Soup adapter and browser composition boundary:

- stop rejecting eligible local continuation requests;
- compile the same canonical GraphQL filters and sort for every page;
- generate and validate the query fingerprint;
- encode/decode a bounded versioned opaque cursor;
- add `cursor` and `nextCursor` to WASM and TypeScript protocol types;
- propagate stale-cursor and revision outcomes through worker/coordinator/host validation;
- update no-op and Tauri hosts to return unsupported unless they implement the capability.

Likely files:

- `crates/item_filter_index/src/lib.rs` and tests;
- `crates/soup_filter_cache_adapter/src/lib.rs` and tests;
- `crates/client/cache-wasm/src/shell.rs` and tests;
- `apps/web/src/lib/graphql-cache/protocol.ts` and tests;
- `apps/web/src/lib/graphql-cache/worker/wasm-module.ts`;
- worker/coordinator protocol and core tests as required;
- `apps/web/src/lib/graphql-cache/host/types.ts`;
- `apps/web/src/lib/graphql-cache/host/worker-host.ts` and tests;
- no-op/Tauri host adapters.

### Phase 4: Add the local page chain to flat Soup

In the frontend:

- replace the one-page local projection with `LocalPredicateChain`;
- route `hasNextPage` and `fetchNextPage` by current authority;
- materialize each page with revision-qualified `readRecordsByKeys`;
- reset on cache revision, generation, or input identity changes;
- retain stale visible data during reevaluation without extending it;
- allow a current live network result to retake authority.

Files:

- `apps/web/src/lib/queries/soup/graphql/items.ts`;
- `apps/web/src/lib/queries/soup/graphql/items.test.ts`;
- `apps/web/src/lib/urql-solid/*` only if the existing public observer API cannot represent local next-page state cleanly. Prefer keeping local predicate pagination inside the Soup adapter rather than adding Soup behavior to the generic urql observer.

### Phase 5: Verification and rollout

Run generic, storage, WASM, worker-host, and frontend tests before enabling local continuation behavior. Add telemetry before broad rollout.

Track at least:

- local continuation request count and page depth;
- complete, incomplete, unsupported, stale-cursor, and error outcomes;
- local page latency by page depth;
- revision and generation reset counts;
- optimistic versus authoritative local pages;
- network requests avoided by local pagination;
- cursor decode/query-fingerprint failures;
- duplicate-key defense activation.

## Test matrix

### Generic/reference tests

- concatenating local pages equals one unpaginated reference evaluation at the same revision;
- ascending and descending sort;
- all generic sort/tie-break direction combinations;
- equal sort values across entity partitions;
- exclusive cursor boundary with no duplicates;
- short final page, exact-size final page, and empty continuation;
- malformed and oversized cursor components;
- cursor from a different query is rejected.

### Turso conformance tests

- Turso pages equal reference pages for generated predicates and projections;
- authoritative and optimistic fixtures paginate over the same effective universe;
- keyset predicates use bound parameters;
- `Not`, `And`, and `Or` remain exact after a cursor;
- completeness markers and relevant optimistic uncertainty force `Incomplete` on every page;
- `EXPLAIN QUERY PLAN` uses authoritative and optimistic fact indexes and does not scan record blobs, queue JSON, or projection blobs;
- cursor ordering remains stable after close/reopen at the same stored state.

### Optimistic pagination tests

- optimistic insertion before and after the cursor;
- optimistic deletion from a full page exposes the next effective result without touched-key overfetch;
- optimistic sort change crosses the cursor in both directions;
- optimistic predicate membership change crosses the cursor;
- enqueue, commit, rollback, and authoritative settlement invalidate old cursors;
- query-relevant unknown state returns `Incomplete` while unrelated uncertainty remains queryable;
- concatenated pages equal one unpaginated effective-index evaluation at the same revision.

### WASM and protocol tests

- first and continuation pages cross the JS boundary with exact revisions;
- stale revision and stale generation cursors are rejected;
- cursor query fingerprints cannot be reused with changed filters or sort;
- filter page and selected records carry the same revision;
- realtime Soup items can appear on a later local page without a Soup query fetch;
- malformed wire cursors fail validation without crashing the worker.

### Frontend tests

- a cache revision change switches from stable network authority to local page 1;
- local `fetchNextPage` appends page 2 without increasing GraphQL execution count;
- `hasNextPage` follows the local cursor while local authority is active;
- rapid duplicate `fetchNextPage` calls do not append twice;
- revision change during filter or record selection discards the result and restarts page 1;
- revision change after multiple pages clears every continuation page;
- engine-generation replacement clears the local chain;
- a live network result clears the local chain and retakes authority;
- unsupported/incomplete local continuation refreshes the network chain before using a server cursor;
- offline locally complete queries paginate without transport success;
- filter/sort/limit changes cannot reuse an old local cursor.

### End-to-end browser test

Using the real WASM/Turso host:

1. populate enough supported Soup projections for at least three pages;
2. establish a stable network-authoritative first page;
3. apply a realtime cache write that advances the revision;
4. observe local page 1;
5. request all local continuation pages;
6. assert exact ordering, no duplicates, and no Soup HTTP request after the realtime write;
7. apply another write mid-chain and assert reset to a new revision-consistent first page.

## Failure behavior

- **Unsupported request:** use the existing network path.
- **Incomplete local scope:** retain stale visible data and obtain a fresh network initial page before server continuation.
- **Stale cursor:** discard the local chain and reevaluate page 1 at the current revision.
- **Revision race during page record selection:** discard and retry within the existing bounded retry policy.
- **Generation replacement:** discard all local revision and cursor state immediately.
- **Storage or cursor decode error:** report telemetry and fall back to a fresh network chain.
- **Network unavailable after local incompleteness:** keep stale visible data, expose no unsafe continuation, and preserve normal retry/error UI.

No failure mode may append a page from an unknown or mismatched revision.

## Performance constraints

- No normalized record blob scan during predicate membership or ordering.
- Keyset pagination, not SQL `OFFSET`.
- Bounded cursor size and decode work.
- No touched-record candidate overfetch, projection batch load, or queue replay on the prerequisite's effective predicate path.
- One effective-index predicate query and one bounded record-selection read per local page in the normal case.
- No automatic prefetch in the first implementation.
- Preserve the existing initial-page latency targets; establish separate p95/p99 targets for continuation pages before rollout.

## Non-goals

- Compatibility between local and server cursors.
- Snapshotting an old cache revision after the cache changes.
- Grouped Soup pagination.
- Expanding `soup-flat-v1` literals or partitions.
- Adding a TypeScript predicate evaluator.
- Persisting UI page chains across reloads or engine generations.
- Local pagination for fuzzy Quick Access search, which already has a separate cursor model.
- Changing server authorization or treating the local cache as corpus authority.

## Acceptance criteria

- Every local cursor is bound to one query, cache generation, and revision.
- Concatenated local pages equal the reference evaluator and Turso result at that revision.
- No duplicate or skipped keys occur at stable revision boundaries.
- Revision or generation changes reset rather than mix local pages.
- The prerequisite's effective optimistic facts preserve exact paginated membership and ordering or return `Incomplete`.
- Local `fetchNextPage` performs no GraphQL Soup network request.
- A current live network response retakes authority and restores server pagination.
- Unsupported or incomplete requests retain all-or-network behavior.
- Cache and Turso layers remain generic; Soup semantics remain in the profile/compiler and adapter crates.
- Browser tests exercise the real WASM/Turso path.

## Revision discipline

First complete every acceptance criterion in [`optimistic-predicate-fact-index-plan.md`](./optimistic-predicate-fact-index-plan.md). Then implement this plan in independently verified Jujutsu revisions:

1. generic cursor/reference evaluator;
2. effective Turso keyset execution and revision handling;
3. Soup adapter/WASM/protocol transport;
4. frontend local page-chain integration;
5. browser end-to-end evidence and telemetry.

After each successful verification step, follow repository policy with `jj desc -m "..." && jj new`.
