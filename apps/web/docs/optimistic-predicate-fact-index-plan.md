# Effective Optimistic Predicate Shadow Index Plan

Status: **implemented; prerequisite complete for [`local-predicate-pagination-plan.md`](./local-predicate-pagination-plan.md)**

## Objective

Replace per-request optimistic predicate composition with one durable, generic shadow index containing the **current effective optimistic projection** for each shadowed record.

When an optimistic mutation is enqueued, cache-core composes the affected records once and cache-turso persists their effective projections in optimistic index-document and fact tables. Predicate reads then query one authoritative-plus-shadow document universe directly in SQL. They do not load projection blobs, replay the mutation queue, overfetch touched records, or sort optimistic results in Rust.

Implement and verify this plan before adding predicate cursors or local page chains. The first implementation applies to the existing initial-page predicate query so correctness and performance can be measured independently of pagination.

## Context

This plan builds on:

- the generic predicate IR and reference evaluator in `crates/predicate_index`;
- authoritative `index_documents`, `exact_facts`, `integer_facts`, `sort_facts`, and completeness scopes in cache-turso;
- the durable `mutation_queue` and one-to-one `optimistic_layers` hierarchy;
- version-3 optimistic projection mutations persisted in `OptimisticSource`;
- cache-core's queue-ordered optimistic reconstruction after enqueue, commit, rollback, and hydration;
- the current bounded in-memory optimistic predicate composition, which remains the differential oracle until the shadow index passes conformance gates.

Related plans:

- [`entity-filter-cache-index-plan.md`](./entity-filter-cache-index-plan.md);
- [`soup-flat-v1-support-manifest.md`](./soup-flat-v1-support-manifest.md);
- [`local-predicate-pagination-plan.md`](./local-predicate-pagination-plan.md), which depends on this work;
- [`graphql-cache-optimistic-enqueue-claim-plan.md`](./graphql-cache-optimistic-enqueue-claim-plan.md), whose enqueue-before-notification and strict-claim semantics must remain intact.

## Current read amplification

The current predicate path stores `OptimisticProjectionMutation` values in the queue source. Every local predicate request then:

1. hydrates and scans active optimistic layers;
2. collects query-relevant projection mutations;
3. rejects query-relevant uncertainty;
4. expands the authoritative query limit by touched-record count;
5. loads authoritative projections for base and touched keys;
6. replays replacement, patch, deletion, and unknown mutations in Rust;
7. runs the reference evaluator and sorts the composed documents in memory.

This is exact, but read cost grows with queue state and repeats for every evaluation. Pagination would repeat that work for every continuation and would make exact keyset boundaries depend on touched-record overfetch.

## Decision

Persist a single effective optimistic shadow per normalized record key.

```text
authoritative predicate index
  index_documents
    ├── exact_facts
    ├── integer_facts
    └── sort_facts

current optimistic shadow index
  optimistic_index_documents       one row per shadowed record key
    ├── optimistic_exact_facts
    ├── optimistic_integer_facts
    ├── optimistic_sort_facts
    └── optimistic_uncertain_attributes
```

Each shadow document records the latest active mutation that affected its projection. Its facts represent the result of applying **all active optimistic projection mutations for that record in queue order**, not only the owner's delta.

The durable `OptimisticSource` remains the mutation log and reconstruction authority. The shadow index is a replaceable derived query index.

## Confirmed invariants

1. At most one optimistic index document exists for a record key.
2. A shadow document stores the current fully composed projection, tombstone, or incomplete state for that key.
3. `owner_mutation_id` is the greatest active mutation ID whose projection mutation affects that record.
4. A shadow key always suppresses the authoritative document with the same key, including tombstone and incomplete states.
5. Predicate reads union complete shadow documents with authoritative documents that have no shadow key.
6. Relevant incomplete or uncertain shadow state returns `Incomplete`; it never exposes an authoritative approximation.
7. Optimistic facts are children of their shadow document with `ON DELETE CASCADE`.
8. A shadow document is a child of its owner optimistic layer with `ON DELETE CASCADE`.
9. Removing a non-owner earlier layer may change a later-owned shadow document. Commit and rollback therefore recompose affected keys and replace them in the same transaction as parent removal.
10. Enqueue, settlement, rollback, clear, and identity reset cannot commit queue state and shadow facts from different optimistic layer sets.
11. Predicate reads do not decode normalized records, queue source JSON, or projection blobs.
12. Browser Turso/OPFS is the first persistence target. In-memory storage implements equivalent semantics for cache-core conformance.
13. This uses the browser cache schema-version/reset path, not an application SQLx migration.

## Alternatives considered

### Per-request Rust composition

This has the least write work but retains queue-dependent read latency, touched-record limits, candidate overfetch, projection batch loads, and Rust-side sorting. It remains only as a temporary correctness oracle.

### Complete projection per optimistic layer

Keeping a full snapshot for every `(mutation_id, record_key)` makes reads choose the latest layer per key, but duplicates facts across layers and still requires rebasing later snapshots when an earlier layer settles. Strict queue settlement removes the oldest claimed layer, so storing shadowed historical snapshots gives little value; durable projection mutations already provide reconstruction history.

### Per-attribute optimistic fact deltas

Deltas reduce some settlement writes but move latest-writer resolution into every query. Multi-valued replacements require empty-write markers, `Replace` requires an attribute barrier, `Delete` requires a record barrier, and boolean posting SQL becomes substantially more complex.

### Single effective shadow

The selected design uses the fewest query-time operations and stores one fact set per currently shadowed record. It intentionally performs composition when queue state changes, where the work can be made atomic and measured separately from user-visible predicate reads.

## Schema

### Shadow documents

```sql
CREATE TABLE optimistic_index_documents (
  id INTEGER PRIMARY KEY,
  owner_mutation_id INTEGER NOT NULL,
  record_key TEXT NOT NULL UNIQUE,
  profile TEXT NOT NULL,
  partition TEXT NOT NULL,
  state INTEGER NOT NULL,
  FOREIGN KEY (owner_mutation_id)
    REFERENCES optimistic_layers(mutation_id)
    ON DELETE CASCADE
);

CREATE INDEX optimistic_index_documents_owner_idx
  ON optimistic_index_documents(owner_mutation_id, id);
CREATE INDEX optimistic_index_documents_scope_idx
  ON optimistic_index_documents(profile, partition, state, id);
```

Use a validated Rust enum for `state`:

- **complete:** contains the current effective facts;
- **deleted:** tombstone with no facts;
- **incomplete:** suppresses prior state but cannot safely provide an exact projection for relevant queries.

Do not expose unvalidated numeric state values outside cache-turso.

### Shadow facts

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

Add posting and lookup indexes equivalent to the authoritative fact tables only when `EXPLAIN QUERY PLAN` demonstrates that the effective SQL uses them.

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

These rows describe uncertainty still effective after all active mutations for that record are composed. A reserved, versioned token represents uncertainty affecting every query attribute.

A later exact patch may clear uncertainty for the field it replaces. A later complete replacement clears inherited uncertainty unless the replacement itself is uncertain. Only current effective uncertainty is stored; uncertainty from superseded layers is not queried.

### Ownership and cascades

```text
mutation_queue
  └── optimistic_layers                         ON DELETE CASCADE
        └── optimistic_index_documents          ON DELETE CASCADE
              ├── optimistic_exact_facts         ON DELETE CASCADE
              ├── optimistic_integer_facts       ON DELETE CASCADE
              ├── optimistic_sort_facts          ON DELETE CASCADE
              └── optimistic_uncertain_attributes ON DELETE CASCADE
```

Deleting a shadow document deletes all owned facts. Deleting its owner layer or queue row deletes the shadow document and facts.

A shadow may depend on earlier layers but is owned by the latest layer touching its key. Deleting an earlier non-owner layer therefore does not cascade that row; settlement must atomically recompose and replace the affected key. Cascades own storage cleanup, while recomposition owns semantic correctness.

Storage-open validation must include every new table, column, index, state value, and foreign key. Foreign-key enforcement remains enabled. A stale or partially upgraded browser database follows the existing destructive cache reset/reopen policy because cache contents are reconstructible.

## Generic cache-core model

Add storage-neutral types without Soup semantics. A conceptual shape is:

```rust
pub enum OptimisticProjectionState {
    Complete(IndexDocument),
    Deleted {
        record_key: RecordKey,
        profile: Profile,
        partition: Token,
    },
    Incomplete {
        record_key: RecordKey,
        profile: Profile,
        partition: Token,
        kind: ProjectionIncompleteKind,
    },
}

pub struct EffectiveOptimisticProjection {
    pub owner: OptimisticTransactionId,
    pub state: OptimisticProjectionState,
    pub uncertain_attributes: BTreeSet<Token>,
}
```

The exact types should reuse existing validated predicate-index names and bounds. They must guarantee:

- one deterministic result per affected record key;
- complete facts for complete state;
- no facts for tombstones;
- explicit effective uncertainty;
- an active owner mutation;
- deterministic ordering and deduplication;
- validation before persistence.

Do not place GraphQL fields, Soup literals, browser cursors, or UI state in these types.

## Composition semantics

For one record, begin with its anticipated authoritative projection and apply every active optimistic projection mutation for that key in ascending queue order:

- `Replace` replaces all inherited facts and uncertainty;
- `Patch` applies field replacements to the preceding effective projection;
- `Delete` produces a tombstone;
- `Unknown` carries safe preceding facts with updated effective uncertainty, or produces incomplete state when no safe base exists.

Every applied mutation updates the owner to that mutation ID. The final state becomes the one shadow row for the key.

The composer must preserve existing behavior for:

- create without an authoritative base;
- patches and replacements;
- deletion followed by later mutation;
- multiple layers touching one record;
- profile or partition changes;
- query-irrelevant and wildcard uncertainty;
- strict queue order;
- post-settlement revalidation metadata, which remains outside this index.

If exact composition cannot be proven, produce incomplete/uncertain state. Never omit an active mutation and expose authority as an approximation.

## Affected-key strategy

Avoid rebuilding unrelated shadow rows.

### Enqueue

Only keys touched by the newly enqueued projection mutations can change. Compose each against its current effective projection and assign the new mutation as owner.

### Commit

Affected keys are the union of:

- keys touched by the settled optimistic projection mutations;
- keys touched by returned authoritative projection mutations.

For each affected key, begin with anticipated committed authority and replay all remaining optimistic projection mutations for that key. If no remaining mutation touches it, remove its shadow row.

### Rollback

Affected keys are those touched by the discarded layer. Recompose them from unchanged authority and all remaining mutations.

`OptimisticProjectionMutation` is record-local by contract: each variant identifies exactly one `record_key`, and patches replace only that record's projected attributes. Preserve and test this invariant in predicate-index rather than introducing cross-record dependency logic in cache-turso.

A full-shadow replacement remains a safe diagnostic/fallback implementation and a differential-test oracle, but it should not be the normal settlement path once affected-key conformance passes.

## Atomic storage operations

Do not add standalone best-effort shadow writes. Extend queue lifecycle operations so queue state, authority, and shadow facts cannot disagree.

Settlement replacements carry the ordered mutation IDs used during composition. Cache-turso compares them with the durable queue inside the write transaction before changing authority or shadow rows. This queue identity check does not require cache-turso to decode `OptimisticSource`; it only verifies that cache-core composed against the same ordered layer set being settled.

### Enqueue

Cache-core computes effective updates for newly touched keys. Because storage assigns `mutation_id`, these updates use an implicit “new owner.” One storage transaction:

1. inserts `mutation_queue` and obtains `mutation_id`;
2. inserts `optimistic_layers` with the existing source envelope;
3. deletes existing shadow documents for touched keys, cascading old facts;
4. inserts replacement shadow documents owned by the new `mutation_id`;
5. inserts their facts and uncertainty rows;
6. commits.

Any failure leaves none of the queue, layer, document, fact, or uncertainty changes. Untouched shadow rows remain unchanged.

The composite enqueue-and-initial-claim behavior, if implemented, still attempts claim before publishing affected operations.

### Commit

Before storage, cache-core computes staged authoritative changes and affected-key shadow replacements against anticipated committed authority. One storage transaction:

1. verifies the claim and strict queue head;
2. verifies the expected queue identity/revision used during recomposition;
3. writes authoritative normalized records and authoritative predicate facts;
4. deletes the settled queue row, cascading shadow rows it currently owns;
5. deletes any surviving shadow documents for every affected key, cascading their facts;
6. inserts recomposed shadow documents with owners that are still active queue entries;
7. inserts replacement facts and uncertainty;
8. commits.

A stale claim, queue mismatch, invalid owner, composition validation error, or fact write failure rolls back the entire transaction.

### Rollback/discard

Cache-core recomposes affected keys against unchanged authority and remaining queue layers. One storage transaction verifies claim/head and queue identity, deletes the queue parent, replaces affected shadow keys, and commits.

### Claim, retry, defer, and lease changes

These operations do not alter queue order or projection semantics, so shadow rows remain unchanged.

### Clear and identity reset

Delete queue parents and rely on owner cascades to remove every shadow document and fact. Preserve existing all-or-nothing reset behavior and post-reset schema validation.

### Hydration and reopen

A committed queue state always has its corresponding effective shadow state. Startup must not silently repair missing rows using non-atomic writes. Missing owners, orphaned facts, duplicate record keys, or schema mismatches trigger the existing reset/recovery policy.

Cache-core may still hydrate normalized optimistic layers for ordinary GraphQL reads. Predicate execution reads the durable shadow index directly.

## Effective predicate SQL

Define the effective document universe without a latest-layer CTE:

```text
authoritative documents whose record_key is absent from optimistic_index_documents
UNION ALL
optimistic_index_documents in complete state
```

A tombstone contributes no result and suppresses authority. An incomplete shadow or relevant uncertainty causes `Incomplete` for an intersecting query.

Carry a source discriminator and source document ID through effective-document and posting CTEs so authoritative and optimistic integer IDs cannot collide. Fact predicates join the fact table for that source. Filtering, sort lookup, ordering, and limit run after the effective universe is established.

The normal predicate transaction must not:

- decode normalized record blobs;
- decode `OptimisticSource` JSON;
- load authoritative projections for touched keys;
- scan or replay optimistic mutations;
- expand result limits by touched-record count;
- invoke the Rust reference evaluator;
- sort effective projections in Rust.

Retain authoritative completeness-scope validation in the same read transaction. Optimistic records can modify a complete cached universe but cannot make an incomplete authoritative scope complete.

Use the existing initial-page `IndexQuery` in this plan. Cursor support is deferred to the pagination plan, which will apply keyset boundaries and `limit + 1` to this same effective universe.

## Storage and architecture boundaries

- `predicate-index` owns generic document/fact/uncertainty value semantics and reference evaluation as appropriate.
- `cache-core` owns queue ordering, affected-key composition, lifecycle invariants, and `Incomplete` decisions.
- `Storage` exposes atomic queue/authority/shadow operations without SQL or Soup concepts.
- `cache-turso` owns schema, cascades, transactions, effective SQL, and query-plan evidence.
- `item-filter-index` and `soup-filter-cache-adapter` continue to own Soup profile/filter compilation only.
- WASM, worker, and frontend APIs should not change unless generic instrumentation requires it.
- Authorization remains server-side; the index evaluates only identity-scoped authorized cache contents.

## Implementation phases

### Phase 1: Effective shadow model and composer

In `predicate-index` and `cache-core`:

- define bounded effective shadow and uncertainty types;
- extract a deterministic per-key queue composer;
- preserve exact `Replace`, `Patch`, `Delete`, and `Unknown` behavior;
- compute owner mutation IDs and affected keys;
- add reference and generated/property tests before changing storage.

Primary files:

- `crates/predicate_index/src/lib.rs` and `src/test.rs`;
- `crates/client/cache-core/src/predicate.rs`;
- `crates/client/cache-core/src/queue.rs` if source/version handling changes;
- `crates/client/cache-core/tests/predicate.rs`;
- `crates/client/cache-core/tests/optimistic.rs`.

### Phase 2: Shadow schema and cascades

In `cache-turso`:

- add one-row-per-key shadow document, fact, and uncertainty tables;
- add validated state encoding and justified indexes;
- extend schema shape/hash/version validation;
- enforce and test owner and fact cascades;
- update clear/reset and storage conformance fixtures;
- use the browser cache reset path, not SQLx migrations.

Primary files:

- `crates/client/cache-turso/src/storage.rs`;
- `crates/client/cache-turso/src/storage/test.rs`;
- `crates/client/cache-turso/tests/storage_conformance.rs`.

### Phase 3: Atomic enqueue shadow updates

In cache-core and storage implementations:

- compose newly touched keys from current effective state;
- atomically persist queue/layer rows and shadow replacements;
- bind new shadow owners to the assigned mutation ID;
- preserve composite enqueue/claim notification ordering;
- add fault injection at each transaction boundary.

Primary files:

- `crates/client/cache-core/src/store.rs`;
- `crates/client/cache-core/src/engine.rs`;
- `crates/client/cache-core/tests/mutation_queue.rs`;
- `crates/client/cache-core/tests/optimistic.rs`;
- `crates/client/cache-turso/src/storage.rs`;
- in-memory/test storage implementations and conformance suites.

### Phase 4: Atomic settlement recomposition

- compute commit/rollback affected keys;
- recompose those keys against anticipated authority and remaining layers;
- verify claim, queue identity, and replacement owners in storage;
- atomically update authority, remove the head, and replace affected shadow rows;
- retain shadow state unchanged for claim/defer/retry;
- compare affected-key replacement with full-shadow reference reconstruction.

### Phase 5: Effective SQL predicate path

In cache-turso and cache-core:

- union complete shadow documents with unshadowed authority;
- preflight incomplete and relevant uncertainty state;
- compile posting predicates over source-qualified authoritative and shadow facts;
- remove touched-record overfetch and per-query optimistic composition from production;
- retain the old Rust path only in differential tests until conformance and query-plan gates pass.

Primary files:

- `crates/client/cache-turso/src/storage.rs`;
- `crates/client/cache-turso/tests/predicate.rs`;
- `crates/client/cache-core/src/predicate.rs`;
- `crates/client/cache-core/src/engine.rs`;
- `crates/client/cache-core/tests/predicate.rs`.

### Phase 6: Browser evidence and cleanup

- exercise the real WASM/Turso initial-page predicate path;
- add read and write telemetry;
- remove dead production code for per-request optimistic predicate composition;
- mark the pagination prerequisite complete only after every acceptance criterion below passes.

## Test matrix

### Generic composer

- authoritative base plus every `Replace`, `Patch`, `Delete`, and `Unknown` combination;
- create without authority;
- deletion followed by patch or replacement;
- multiple layers touching the same key;
- disjoint keys and partitions;
- owner always equals latest affecting mutation;
- exact patch clears replaced-field uncertainty;
- complete replacement clears inherited facts and uncertainty;
- wildcard uncertainty propagation;
- deterministic output independent of map iteration order;
- configured bounds return typed outcomes rather than truncating.

### Persistence and cascades

- enqueue writes one shadow row per touched key regardless of queue depth;
- a later mutation replaces the same key's prior shadow and child facts;
- enqueue failure leaves queue, layer, shadow, and facts unchanged;
- deleting a shadow document cascades every child row;
- deleting its owner layer cascades the document and facts;
- deleting a non-owner earlier layer does not accidentally delete a later-owned shadow;
- queue clear cascades every shadow hierarchy;
- no orphan or duplicate-key row passes storage validation;
- close/reopen preserves consistent queue and shadow state.

### Settlement and affected-key recomposition

- commit updates authority, removes the head, and replaces affected shadow keys atomically;
- rollback removes the head and recomposes affected keys against revealed authority;
- a later patch loses a value supplied only by a rolled-back earlier layer;
- a later patch sees the value supplied by committed authority;
- a later replacement remains independent of changed authority where appropriate;
- keys untouched by settlement retain byte-equivalent shadow facts;
- authoritative settlement projections expand the affected-key set;
- deferred and leased heads leave shadow facts unchanged;
- stale claim, queue mismatch, and invalid owner leave old state intact;
- fault injection exposes either complete old state or complete new state;
- affected-key output equals full queue reconstruction for generated mutation sequences.

### Effective SQL conformance

- authoritative-only results remain unchanged;
- shadow document suppresses authority without a latest-layer grouping query;
- optimistic create appears without authority;
- tombstone excludes authority;
- exact and integer membership use shadow facts;
- shadow sort controls ordering;
- relevant uncertainty returns `Incomplete`;
- unrelated uncertainty remains queryable;
- incomplete state forces fallback only for intersecting profile/partition scope;
- `Not`, `And`, and `Or` match the reference evaluator;
- generated SQL results equal current in-memory optimistic composition;
- normal reads perform no record, queue, projection-blob, or touched-document load;
- `EXPLAIN QUERY PLAN` uses fact indexes and avoids normalized-record scans.

### Browser/WASM evidence

- optimistic Soup-compatible records are locally filterable through real WASM/Turso without a Soup query response;
- optimistic membership and sort update immediately after enqueue;
- commit and rollback update the local initial page correctly;
- close/reopen preserves optimistic predicate behavior;
- predicate reads do not increase Soup HTTP execution count.

## Failure behavior

- **Unsupported projection:** persist explicit incomplete/uncertain state; never expose approximate authority.
- **Composition validation failure before enqueue:** fail without durable queue changes.
- **Atomic enqueue error:** roll back queue, layer, shadow, and fact changes.
- **Settlement error:** roll back authority, parent deletion, and shadow replacements.
- **Stale claim or queue identity:** retain old durable state and return the existing typed stale outcome.
- **Invalid shadow owner:** reject the transaction and retain old state.
- **Schema mismatch or orphan on reopen:** use existing cache reset/recovery and advance generation.
- **Relevant uncertainty/incomplete read:** return `Incomplete` and preserve all-or-network behavior.
- **Pathological composition bound:** return a typed outcome; never omit a mutation or fact.

## Performance constraints and telemetry

Required constraints:

- one shadow fact set per currently shadowed record, independent of layers touching that record;
- no queue/projection decode or Rust composition on normal predicate reads;
- no touched-record candidate overfetch or projection batch load;
- no latest-layer grouping/window query on the read path;
- one effective-index SQL query per predicate evaluation in the normal case;
- enqueue work proportional to newly touched keys;
- settlement writes proportional to affected keys, with full reconstruction used for verification rather than normal persistence;
- all queue and shadow writes transactionally atomic.

Track at least:

- queue depth, unique shadow keys, and facts per shadow key;
- keys and facts replaced per enqueue and settlement;
- composition CPU and storage transaction latency;
- effective predicate p50/p95/p99 with and without shadow rows;
- complete, incomplete, unsupported, validation-error, and reset outcomes;
- affected-key/full-reconstruction differential mismatches;
- query-plan regressions.

Set production bounds only after measuring realistic queue depth and fact counts. Correctness must not depend on an assumed-small queue.

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

Run focused worker/host tests and the real WASM/Turso browser test covering optimistic local filtering. This is a browser cache schema change, not an application SQL query change: do not run database migrations or `just prepare_db` unless unrelated Rust SQLx queries also change.

Use `EXPLAIN QUERY PLAN` assertions for representative exact, integer-range, boolean-combination, ordering, tombstone, and uncertainty queries before enabling the shadow path by default.

## Non-goals

- local predicate cursors or continuation pages;
- frontend local page-chain ownership;
- server/local cursor compatibility;
- expanding `soup-flat-v1` literals or partitions;
- changing normalized optimistic composition for ordinary GraphQL reads;
- replacing the durable optimistic source envelope;
- changing strict queue, lease, retry, notification, or revalidation semantics;
- storing historical full snapshots per optimistic layer;
- storing per-attribute optimistic deltas;
- Tauri predicate execution;
- changing server authorization or treating the cache as corpus authority;
- SQLx/application database migrations.

## Acceptance criteria

- Exactly one effective shadow document exists per currently shadowed record key.
- Initial-page SQL results equal authoritative-plus-optimistic reference evaluation.
- Predicate reads do not decode or replay optimistic queue/projection state.
- Creates, patches, replacements, deletions, sort changes, and uncertainty preserve exact membership and ordering or return `Incomplete`.
- Repeated mutations of one key do not duplicate its fact set by queue depth.
- Deleting a shadow document or its owner cascades every child fact and uncertainty row.
- Enqueue atomically persists queue state and affected shadow replacements.
- Commit and rollback atomically update authority, remove the settled layer, and recompose affected shadow keys.
- Removing an earlier non-owner layer cannot leave a stale later-owned shadow.
- Affected-key recomposition equals full queue reconstruction for generated sequences.
- Fault injection cannot expose queue and shadow states from different layer sets.
- Reopen restores a valid shadow index or follows explicit cache reset.
- Query plans avoid normalized-record scans, projection loads, and latest-layer grouping.
- Cache-core and cache-turso remain generic; Soup semantics remain in compiler/adapter crates.
- Existing optimistic queue ordering, claims, retries, notifications, and revalidations remain unchanged.
- Real WASM/Turso tests prove optimistic Soup items are locally filterable without a Soup network fetch.
- This plan passes before local predicate pagination begins.

## Revision discipline

Implement in independently verified Jujutsu revisions:

1. generic effective-shadow model, per-key composer, and reference tests;
2. Turso one-row-per-key schema, foreign keys, and cascade conformance;
3. atomic enqueue shadow replacement;
4. atomic commit/rollback affected-key recomposition;
5. effective authoritative-plus-shadow SQL and differential/query-plan tests;
6. WASM/browser evidence, telemetry, and old production-path cleanup.

After each successful verification step, follow repository policy with `jj desc -m "..." && jj new`.
