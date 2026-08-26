# Materialized Optimistic Predicate Fact Index Plan

Status: **implementation prerequisite for [`local-predicate-pagination-plan.md`](./local-predicate-pagination-plan.md)**

## Objective

Replace per-request optimistic predicate projection composition with a durable, generic optimistic fact index parallel to the authoritative predicate fact index.

When an optimistic mutation is enqueued, cache-core will materialize each touched record's effective predicate projection once and cache-turso will persist that projection in optimistic index-document and fact tables. Predicate reads will query one effective authoritative-plus-optimistic document universe directly in SQL. They will not load optimistic projection blobs, batch-load touched authoritative projections, replay the queue, or sort a composed result in Rust.

Implement and verify this plan before adding local predicate cursors or page-chain behavior. The first implementation applies to the existing initial-page predicate query, so its correctness and performance can be measured independently of pagination.

## Context

This plan builds on:

- the generic predicate IR and reference evaluator in `crates/predicate_index`;
- authoritative `index_documents`, `exact_facts`, `integer_facts`, `sort_facts`, and completeness scopes in `cache-turso`;
- the durable `mutation_queue` and one-to-one `optimistic_layers` hierarchy;
- version-3 optimistic projection mutations persisted in `OptimisticSource`;
- cache-core's queue-ordered optimistic layer reconstruction after enqueue, commit, rollback, and hydration;
- the current bounded in-memory optimistic predicate composition, which remains the differential oracle until the materialized path passes conformance gates.

Related plans:

- [`entity-filter-cache-index-plan.md`](./entity-filter-cache-index-plan.md);
- [`soup-flat-v1-support-manifest.md`](./soup-flat-v1-support-manifest.md);
- [`local-predicate-pagination-plan.md`](./local-predicate-pagination-plan.md), which depends on this work;
- [`graphql-cache-optimistic-enqueue-claim-plan.md`](./graphql-cache-optimistic-enqueue-claim-plan.md), whose enqueue-before-notification and strict-claim semantics must remain intact.

## Current read amplification

The current predicate path stores `OptimisticProjectionMutation` values in the queue source. Every local predicate request then:

1. hydrates and scans active optimistic layers;
2. collects every query-relevant projection mutation;
3. rejects query-relevant uncertainty;
4. expands the authoritative query limit by the number of touched records;
5. loads authoritative projections for base and touched keys;
6. replays replacement, patch, deletion, and unknown mutations in Rust;
7. runs the reference evaluator and sorts the composed documents in memory.

This is exact, but read cost grows with active optimistic queue state and repeats for every predicate evaluation. It also requires a touched-record cap and candidate overfetch that are unrelated to the requested result size.

## Confirmed decisions

1. Use separate generic optimistic index-document and fact tables rather than adding optimistic columns to authoritative tables.
2. Store a complete effective projection for each record touched by each optimistic layer, not per-attribute deltas.
3. Preserve queue order with monotonic `mutation_id`; the latest active optimistic document for a record shadows its authoritative document and all earlier optimistic documents for that record.
4. Persist deletion as a tombstone document with no facts.
5. Persist effective uncertainty separately and return `Incomplete` only when the latest optimistic state's uncertainty intersects the compiled query's profile, partition, or attribute dependencies.
6. Make optimistic index documents children of `optimistic_layers`, and all optimistic facts and uncertainty rows children of their optimistic index document, using `ON DELETE CASCADE` throughout.
7. Enqueue, settlement, rollback, clear, and identity reset must update queue state and optimistic facts atomically.
8. When the strict queue head commits or rolls back, rematerialize every remaining queued layer against the resulting authoritative base in the same storage transaction. Layers without predicate projections use an empty replacement. Dependency-based partial rebase is a later optimization.
9. Keep `OptimisticSource` projection mutations as the durable reconstruction authority. Materialized facts are a rebuildable query index, not a replacement mutation log.
10. Predicate SQL operates on the effective document universe before filtering, ordering, or limiting. The normal read path does not decode normalized records, queue source JSON, or projection mutation blobs.
11. Browser Turso/OPFS is the first persistence target. In-memory storage implements equivalent semantics for cache-core conformance. Tauri predicate execution remains unsupported unless explicitly added later.
12. This changes the browser cache schema through the cache namespace/schema-version reset path. It is not an application SQLx migration.

## Alternatives considered

### Keep per-query Rust composition

This is the smallest change, but retains repeated projection loads, queue replay, candidate overfetch, touched-record limits, and in-memory sorting. It remains only as a temporary differential oracle.

### Persist optimistic fact deltas

A delta log would let parent deletion reveal a previous writer without rematerializing later layers. It is not selected because exact reads would need latest-writer resolution per attribute, explicit empty-value markers for multi-valued replacement, full-record barriers for `Replace`, record barriers for `Delete`, and more complex posting-list SQL for every predicate operation.

### Persist complete per-layer projections

A complete projection makes reads select one latest optimistic document per record and use ordinary fact lookups. Patch composition happens once when queue state changes. Settlement has more write amplification because later full snapshots must be rebuilt, but cache-core already reconstructs later normalized layers in queue order. Predicate reads are expected to be more frequent and latency-sensitive than settlement, so this is the selected design.

## Data model

### Optimistic index documents

Add a parallel optimistic projection hierarchy:

```sql
CREATE TABLE optimistic_index_documents (
  id INTEGER PRIMARY KEY,
  mutation_id INTEGER NOT NULL,
  record_key TEXT NOT NULL,
  profile TEXT NOT NULL,
  partition TEXT NOT NULL,
  state INTEGER NOT NULL,
  FOREIGN KEY (mutation_id)
    REFERENCES optimistic_layers(mutation_id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX optimistic_index_documents_layer_key_idx
  ON optimistic_index_documents(mutation_id, record_key);
CREATE INDEX optimistic_index_documents_latest_key_idx
  ON optimistic_index_documents(record_key, mutation_id DESC);
CREATE INDEX optimistic_index_documents_scope_idx
  ON optimistic_index_documents(profile, partition, state, mutation_id, id);
```

`state` distinguishes at least:

- **complete:** the row has a complete effective projection and its facts;
- **deleted:** the tombstone shadows authority and earlier layers and has no facts;
- **incomplete:** the row shadows prior state but cannot safely provide a complete projection for relevant queries.

Use a validated Rust enum at the storage boundary. Do not expose unvalidated numeric state values outside cache-turso.

### Optimistic facts

```sql
CREATE TABLE optimistic_exact_facts (
  document_id INTEGER NOT NULL,
  attribute TEXT NOT NULL,
  value BLOB NOT NULL,
  PRIMARY KEY (document_id, attribute, value),
  FOREIGN KEY (document_id)
    REFERENCES optimistic_index_documents(id)
    ON DELETE CASCADE
);

CREATE TABLE optimistic_integer_facts (
  document_id INTEGER NOT NULL,
  attribute TEXT NOT NULL,
  value INTEGER NOT NULL,
  PRIMARY KEY (document_id, attribute, value),
  FOREIGN KEY (document_id)
    REFERENCES optimistic_index_documents(id)
    ON DELETE CASCADE
);

CREATE TABLE optimistic_sort_facts (
  document_id INTEGER NOT NULL,
  attribute TEXT NOT NULL,
  value INTEGER NOT NULL,
  PRIMARY KEY (document_id, attribute),
  FOREIGN KEY (document_id)
    REFERENCES optimistic_index_documents(id)
    ON DELETE CASCADE
);
```

Add posting and lookup indexes equivalent to the authoritative fact tables. Validate them with `EXPLAIN QUERY PLAN`; do not blindly duplicate indexes that the effective SQL cannot use.

### Effective uncertainty

```sql
CREATE TABLE optimistic_uncertain_attributes (
  document_id INTEGER NOT NULL,
  attribute TEXT NOT NULL,
  PRIMARY KEY (document_id, attribute),
  FOREIGN KEY (document_id)
    REFERENCES optimistic_index_documents(id)
    ON DELETE CASCADE
);
```

Each row describes uncertainty still effective at that layer. A reserved, versioned attribute token represents uncertainty affecting every query attribute. A later exact patch may clear uncertainty for the patched attribute; a later complete replacement clears inherited uncertainty unless the replacement itself is uncertain.

The latest optimistic document's effective uncertainty is authoritative for that record. Uncertainty on shadowed older layers must not force fallback.

### Cascade ownership

The required ownership chain is:

```text
mutation_queue
  └── optimistic_layers                  ON DELETE CASCADE
        └── optimistic_index_documents   ON DELETE CASCADE
              ├── optimistic_exact_facts
              ├── optimistic_integer_facts
              ├── optimistic_sort_facts
              └── optimistic_uncertain_attributes
```

Deleting an optimistic index document must delete every child fact and uncertainty row. Deleting a layer or queue row must transitively delete the complete hierarchy. Production cleanup must not issue separate child-table deletes before deleting the owning parent.

Storage-open schema validation must include every new table, column, index, and foreign key. Foreign-key checks must remain enabled. A stale or partially upgraded browser database follows the existing destructive cache reset/reopen behavior because all cache content is reconstructible.

## Generic cache-core model

Add storage-neutral types representing materialized state without Soup semantics. A conceptual shape is:

```rust
pub enum OptimisticIndexDocumentState {
    Complete(IndexDocument),
    Deleted {
        record_key: RecordKey,
        profile: ProfileName,
        partition: PartitionName,
    },
    Incomplete {
        record_key: RecordKey,
        profile: ProfileName,
        partition: PartitionName,
        uncertain_attributes: BTreeSet<AttributeName>,
    },
}

pub struct OptimisticLayerIndexReplacement {
    pub transaction: OptimisticTransactionId,
    pub documents: Vec<OptimisticIndexDocumentState>,
}
```

Use existing validated predicate-index names and bounds where available rather than adding parallel string wrappers. The exact shape may separate document metadata, facts, and uncertainty, but it must preserve these properties:

- one bounded document per `(mutation_id, record_key)`;
- complete facts for complete state;
- no facts for tombstones;
- explicit effective uncertainty;
- deterministic ordering and deduplication;
- validation before storage writes.

Do not put Soup literals, GraphQL filter fields, browser cursors, or UI page state in these types.

## Materialization semantics

For each projection mutation in queue order:

- `Replace` writes the complete replacement document and clears inherited facts and uncertainty not present in the replacement;
- `Patch` composes against the preceding effective projection once and writes the resulting complete document rather than a fact delta;
- `Delete` writes a tombstone with no facts;
- `Unknown` carries forward the preceding effective facts plus its updated uncertainty set, or writes incomplete state when no safe base exists.

Multiple layers may contain a document for the same record. Greatest active `mutation_id` wins. Older documents remain durable until their own parent is removed, but `OptimisticSource` remains the authority used to rematerialize queue state.

Materialization must preserve the existing behavior for:

- creates with no authoritative base;
- patches and replacements;
- deletions;
- multiple mutations touching the same record;
- profile or partition changes;
- query-irrelevant and wildcard uncertainty;
- strict queue ordering;
- post-settlement revalidation metadata, which remains outside the predicate index.

If exact materialization cannot be proven, persist incomplete/uncertain state and let predicates return `Incomplete`. Never omit a mutation and expose an authoritative approximation.

## Atomic storage operations

Do not add standalone best-effort writes for optimistic facts. Extend the existing atomic queue lifecycle operations so the queue and query index cannot disagree.

### Enqueue

The engine computes the new layer's materialized documents against the current effective state. One storage transaction then:

1. inserts `mutation_queue` and obtains `mutation_id`;
2. inserts `optimistic_layers` with the existing source envelope;
3. inserts optimistic index documents associated with that `mutation_id`;
4. inserts all facts and effective uncertainty rows;
5. commits.

Any failure leaves none of the queue, layer, document, fact, or uncertainty rows. The composite enqueue-and-initial-claim host behavior, if present, still attempts the claim before publishing affected operations.

### Commit

Before entering storage, cache-core computes:

- staged authoritative normalized-record and projection changes;
- a complete ordered replacement for every remaining queued layer, evaluated against the anticipated committed authority; layers without predicate projections have empty document lists.

One storage transaction must:

1. verify the existing claim and strict head;
2. write authoritative normalized records and authoritative predicate facts;
3. delete the settled `mutation_queue` row, cascading its complete optimistic hierarchy;
4. verify replacement mutation IDs exactly match all remaining queue entries;
5. delete existing optimistic index documents for those remaining layers, cascading old facts;
6. insert every rematerialized document, fact, and uncertainty row;
7. commit.

A stale claim, queue mismatch, validation failure, or fact write error rolls back the entire transaction.

### Rollback/discard

Cache-core rematerializes every remaining queued layer against the unchanged revealed authoritative base, using empty replacements for layers without predicate projections. One storage transaction verifies the claim/head, deletes the settled queue parent, replaces all remaining optimistic index rows, and commits.

### Retry/defer/lease changes

These operations do not alter mutation order or projections and therefore retain optimistic index rows unchanged.

### Clear and identity reset

Delete queue parents and rely on cascade ownership for optimistic cleanup. Preserve the existing all-or-nothing clear/reset transaction and post-reset schema validation.

### Hydration and reopen

A successfully committed queue always has matching materialized rows. Startup must not silently reconstruct and persist missing optimistic facts outside a transaction. Missing, orphaned, or mismatched rows indicate invalid cache state and trigger the existing reset/recovery policy.

After reopen, cache-core may still hydrate normalized optimistic layers for ordinary query reads, but predicate execution uses the durable effective fact index directly.

## Effective predicate execution

Construct a latest-optimistic relation keyed by normalized record key. Then define:

```text
effective documents =
  authoritative documents with no latest optimistic document for that key
  UNION ALL
  latest optimistic documents in complete state
```

A latest tombstone contributes no result and excludes authority. A latest incomplete row or relevant effective uncertainty causes `Incomplete` for an intersecting query.

Carry a source discriminator and source document ID through effective-document and posting CTEs so authoritative and optimistic integer IDs cannot collide. Fact predicates join the fact table belonging to that source. Filtering, sort lookup, order, and limit run only after the effective universe is established.

The normal predicate read transaction must not:

- decode normalized record blobs;
- decode `OptimisticSource` JSON;
- call `load_index_documents` for touched keys;
- scan and replay optimistic projection mutations;
- expand the SQL result limit by optimistic touched-record count;
- run the reference evaluator or sort effective documents in Rust.

Retain authoritative completeness-scope validation in the same read transaction. Optimistic records can modify the complete cached universe, but they do not make an incomplete authoritative scope complete.

Use the existing initial-page `IndexQuery` in this plan. Cursor/keyset support is deliberately deferred to the pagination plan; that later query will apply its boundary and `limit + 1` to this same effective universe.

## Storage and architecture boundaries

- `predicate-index` owns generic document/fact/uncertainty value semantics and the reference materializer/evaluator as appropriate.
- `cache-core` owns queue ordering, projection composition, lifecycle invariants, and decisions to return `Incomplete`.
- `Storage` expresses atomic persistence operations without SQL or Soup concepts.
- `cache-turso` owns schema, foreign keys, transactions, effective SQL, and query-plan evidence.
- `soup-filter-cache-adapter` and `item-filter-index` continue to own Soup profile/filter compilation only.
- WASM, worker, and frontend APIs should not change for this internal optimization unless instrumentation needs a generic outcome field.
- Authorization remains server-side; the index only evaluates identity-scoped authorized cache contents.

## Implementation phases

### Phase 1: Generic materialization model

In `predicate-index` and `cache-core`:

- define bounded materialized optimistic document and uncertainty types;
- extract/reuse a deterministic queue-ordered projection materializer;
- preserve exact `Replace`, `Patch`, `Delete`, and `Unknown` semantics;
- add a reference effective-projection evaluator independent of storage;
- add generated/property tests before changing durable storage.

Primary files:

- `crates/predicate_index/src/lib.rs` and `src/test.rs`;
- `crates/client/cache-core/src/predicate.rs`;
- `crates/client/cache-core/src/queue.rs` if source/version handling changes;
- `crates/client/cache-core/tests/predicate.rs`;
- `crates/client/cache-core/tests/optimistic.rs`.

### Phase 2: Schema and cascade lifecycle

In `cache-turso`:

- add optimistic document/fact/uncertainty tables and validated state encoding;
- add only indexes justified by authoritative analogues and query plans;
- extend schema shape/hash/version validation;
- enforce and test the complete foreign-key cascade chain;
- update clear/reset and storage conformance fixtures;
- use the normal browser cache schema reset path, not SQLx.

Primary files:

- `crates/client/cache-turso/src/storage.rs`;
- `crates/client/cache-turso/src/storage/test.rs`;
- `crates/client/cache-turso/tests/storage_conformance.rs`.

### Phase 3: Atomic enqueue and settlement materialization

In `cache-core`, the storage trait, and storage implementations:

- atomically persist new layer materialized facts during enqueue;
- rematerialize all remaining queued layers before commit/rollback;
- atomically settle authority, cascade the head, and replace remaining materialized rows;
- retain facts unchanged during claim, defer, and retry;
- reject stale claims and queue/replacement mismatches;
- add fault injection at each transaction boundary;
- preserve composite enqueue/claim notification ordering where implemented.

Primary files:

- `crates/client/cache-core/src/store.rs`;
- `crates/client/cache-core/src/engine.rs`;
- `crates/client/cache-core/src/queue.rs`;
- `crates/client/cache-core/tests/mutation_queue.rs`;
- `crates/client/cache-core/tests/optimistic.rs`;
- `crates/client/cache-turso/src/storage.rs`;
- in-memory/test storage implementations and conformance suites.

### Phase 4: Effective SQL predicate path

In `cache-turso` and `cache-core`:

- select the latest active optimistic document per record;
- union complete optimistic documents with unshadowed authority;
- preflight latest incomplete and relevant uncertainty state;
- compile posting predicates over source-qualified authoritative and optimistic facts;
- remove touched-record overfetch and per-query projection composition from the production path;
- keep the old Rust composition only behind differential tests until generated conformance and query-plan gates pass.

Primary files:

- `crates/client/cache-turso/src/storage.rs`;
- `crates/client/cache-turso/tests/predicate.rs`;
- `crates/client/cache-core/src/predicate.rs`;
- `crates/client/cache-core/src/engine.rs`;
- `crates/client/cache-core/tests/predicate.rs`.

### Phase 5: Rollout and cleanup

- exercise the real WASM/Turso host with initial-page local predicates;
- add telemetry for effective predicate latency and optimistic lifecycle writes;
- compare materialized SQL and old reference outcomes in tests;
- remove production dead code for per-query optimistic composition after rollout gates pass;
- update [`local-predicate-pagination-plan.md`](./local-predicate-pagination-plan.md) prerequisite status and begin cursor implementation only after this plan's acceptance criteria pass.

## Test matrix

### Generic materializer

- authoritative base plus every `Replace`, `Patch`, `Delete`, and `Unknown` combination;
- create without authority;
- two or more layers touching the same record;
- mutations touching disjoint records and partitions;
- exact patch clearing prior uncertainty;
- complete replacement clearing inherited facts and uncertainty;
- wildcard uncertainty propagation;
- deterministic output independent of input map iteration order;
- configured record/fact/attribute bounds return typed incomplete/error outcomes rather than truncating.

### Persistence and cascade

- enqueue atomically writes queue, layer, document, facts, and uncertainty;
- enqueue failure at every injected write boundary leaves none of those rows;
- deleting an optimistic index document cascades all child rows;
- deleting an optimistic layer cascades all documents and child rows;
- deleting a queue row cascades the complete hierarchy;
- deleting one layer does not remove another layer's rows for the same record;
- no orphan document or fact passes storage-open validation;
- clear and identity reset leave every optimistic table empty;
- close/reopen preserves an internally consistent queue and materialized index.

### Settlement and rebase

- commit atomically writes authority, removes the settled hierarchy, and rematerializes every later queued layer;
- rollback atomically removes the head and rematerializes later layers against revealed authority;
- later patch no longer retains a value supplied only by a rolled-back earlier layer;
- later patch sees a value supplied by committed authority;
- later replacement remains independent of changed authority where appropriate;
- deferred and leased heads leave all facts unchanged;
- stale claim and queue replacement mismatch leave old state intact;
- fault injection exposes either the complete old state or complete new state, never stale later snapshots;
- reopen after every injected failure remains valid or follows the explicit reset policy.

### Effective SQL conformance

- authoritative-only results remain unchanged;
- latest optimistic document shadows authority and older optimistic layers;
- optimistic create appears without authority;
- tombstone excludes authority and older optimistic state;
- exact and integer fact membership uses latest complete state;
- optimistic sort fact controls ordering;
- query-relevant uncertainty returns `Incomplete`;
- unrelated uncertainty remains queryable;
- incomplete latest state forces fallback only for intersecting profile/partition scope;
- `Not`, `And`, and `Or` match the reference evaluator;
- generated materialized SQL results equal the old in-memory optimistic composition;
- the normal query performs no record-blob, queue-JSON, projection-blob, or touched-document read;
- `EXPLAIN QUERY PLAN` uses fact/index lookups and avoids full scans that grow with normalized record count.

### Browser/WASM evidence

- realtime and optimistic Soup-compatible records are locally filterable through real WASM/Turso without a Soup query response;
- optimistic predicate membership and sort update immediately after enqueue;
- commit and rollback produce the expected locally filtered initial page;
- close/reopen preserves optimistic predicate behavior;
- predicate reads do not increase Soup HTTP execution count.

## Failure behavior

- **Unsupported projection mutation:** persist explicit incomplete/uncertain state; do not expose approximate authority.
- **Materialization validation error before enqueue:** fail enqueue without durable queue state.
- **Atomic enqueue storage error:** roll back queue, layer, documents, and facts.
- **Settlement/rebase storage error:** roll back authority, parent deletion, and every replacement fact write.
- **Stale claim or queue mismatch:** return the existing typed stale outcome and retain old durable state.
- **Schema mismatch or orphaned rows on reopen:** use the existing cache reset/recovery path and advance engine generation.
- **Relevant uncertainty or incomplete state during predicate read:** return `Incomplete` and preserve all-or-network behavior.
- **Pathological queue/materialization bound:** return a typed incomplete/error outcome; never silently omit a layer or fact.

## Performance constraints and telemetry

Required constraints:

- no normalized record, queue source, or projection blob decode on a normal predicate read;
- no touched-record candidate overfetch or projection batch load;
- one effective-index SQL query per predicate evaluation in the normal case;
- optimistic fact lookup complexity follows requested predicate postings, not queue replay in Rust;
- all optimistic write and rebase work is bounded and transactionally atomic;
- no additional network request or authorization broadening.

Track at least:

- optimistic queue depth and projection-bearing layer count;
- documents and facts written per enqueue;
- documents and facts rewritten per settlement/rollback;
- materialization CPU time and storage transaction latency;
- effective predicate p50/p95/p99 latency with and without optimistic layers;
- `Complete`, `Incomplete`, unsupported, validation-error, and reset outcomes;
- differential mismatch count during rollout;
- query-plan regressions in CI fixtures.

Set explicit production bounds only after measuring realistic queue depth and fact counts. Initial correctness must not depend on an assumed-small queue.

## Verification

Run focused verification from the repository root with `SQLX_OFFLINE` unset for tests:

```bash
cargo fmt --check
cargo test -p predicate-index
cargo test -p cache-core
cargo test -p cache-turso
cargo test -p cache-wasm
just build-cache-wasm
```

Run focused browser worker/host tests and the real WASM/Turso browser test covering optimistic local filtering. This is a browser cache schema change, not an application SQL query change: do not run database migrations or `just prepare_db` unless unrelated Rust SQLx queries are also changed.

Use `EXPLAIN QUERY PLAN` assertions for representative exact, integer-range, boolean-combination, ordering, and uncertainty queries before enabling the materialized path by default.

## Non-goals

- local predicate cursors or continuation pages;
- frontend local page-chain ownership;
- server/local cursor compatibility;
- expanding `soup-flat-v1` filter literals or entity partitions;
- changing normalized optimistic record composition for ordinary GraphQL query reads;
- replacing the durable optimistic mutation source envelope;
- changing strict mutation queue, lease, retry, or revalidation semantics;
- storing per-attribute optimistic deltas;
- dependency-optimized partial rebase in the first implementation;
- Tauri predicate execution;
- changing server authorization or treating the local cache as corpus authority;
- SQLx/application database migrations.

## Acceptance criteria

- Initial-page predicate results from materialized SQL equal the existing authoritative-plus-optimistic reference evaluator.
- Predicate reads do not decode or replay optimistic queue/projection data.
- Optimistic creates, patches, replacements, deletions, sort changes, and uncertainty preserve exact filtering and ordering or return `Incomplete`.
- Queue/layer deletion cascades every owned optimistic index document, fact, and uncertainty row.
- Enqueue atomically persists queue state and its complete optimistic fact hierarchy.
- Commit and rollback atomically remove the settled hierarchy and rematerialize every remaining queued layer.
- Fault injection cannot expose queue state whose materialized facts represent a different layer ordering or authority base.
- Reopen either restores a valid materialized optimistic index or follows the explicit cache reset path.
- Query plans use the optimistic fact indexes and avoid normalized-record, queue JSON, and projection-blob scans.
- Cache-core and cache-turso remain generic; Soup semantics remain in profile/compiler and adapter crates.
- Existing optimistic queue ordering, claims, retries, notifications, and revalidations remain unchanged.
- Real WASM/Turso tests prove optimistic Soup items are locally filterable without a Soup network fetch.
- This plan passes before implementation of local predicate pagination begins.

## Revision discipline

Implement in independently verified Jujutsu revisions:

1. generic materialized optimistic projection model and reference tests;
2. Turso optimistic schema, foreign keys, and cascade conformance;
3. atomic enqueue persistence;
4. atomic commit/rollback full-queue rematerialization;
5. effective authoritative-plus-optimistic SQL and differential tests;
6. WASM/browser evidence, query-plan gates, telemetry, and old production-path cleanup.

After each successful verification step, follow repository policy with `jj desc -m "..." && jj new`.
