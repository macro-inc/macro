# Exact `EntityFilterAst` Cache Index Plan

## Objective

Compile an input `item_filters::ast::EntityFilterAst` into a generic predicate plan and use a Turso/OPFS-backed inverted index to find matching normalized GraphQL cache records exactly and efficiently.

This is **not** vector similarity search and does not use Turso FTS. Exact Boolean filtering is implemented with indexed posting lists, range indexes, exact text verification, and SQL set algebra.

## Confirmed decisions

1. Exactness applies to completely indexed entities currently present in the local cache. It does not imply that the local cache contains the user's complete server corpus.
2. Dirty, incomplete, missing, or forward-incompatible projections cause network fallback. They must never produce approximate local results.
3. The first consumer is `useSoupAstItemsQuery`.
4. Browser Turso/OPFS is the only persistence target. `cache-sqlite` and Tauri are out of scope.
5. This ships as one complete implementation supporting every current `EntityFilterAst` literal. There is no partial profile, gradual rollout, or feature-flagged subset.
6. The existing fuzzy Quick Access search remains separate from this exact filter index.
7. Filter semantics must remain isolated from cache and storage implementation details.

## Current state

Relevant code:

- `crates/item_filters/src/ast.rs` defines `EntityFilterAst`, its entity-specific trees, `EmailFilterAst`, CRM scope, and the global properties tree.
- `crates/item_filters/src/ast/**` defines all entity literal variants.
- `crates/filter_ast/src/lib.rs` defines `Expr::{And, Or, Not, Literal}`.
- `crates/soup/src/inbound/axum_router.rs` currently owns the reusable-looking REST `ApiEntityFilterAst` DTO and its conversion into the materialized `EntityFilterAst`.
- `crates/soup/src/outbound/pg_soup_repo/expanded/dynamic.rs` and entity-specific repositories implement authoritative server filtering.
- `crates/email/src/outbound/email_pg_repo/dynamic/**` implements authoritative email filtering.
- `apps/web/src/lib/queries/soup/graphql/ast.ts` contains a separate REST-AST-to-GraphQL-input translator. Do not add a third semantic translator in the cache.
- `apps/web/src/features/next-soup/filters/query-filters.ts` explicitly supports only a subset of filters and is not an exact matcher.
- `crates/client/cache-core/src/search.rs` contains a Quick Access-specific materialized projection with hard-coded GraphQL typenames, field names, and buckets.
- `crates/client/cache-core/src/store.rs` exposes Quick Access-specific search operations.
- `crates/client/cache-turso/src/storage.rs` stores normalized records plus the Quick Access projection transactionally. Its frozen browser schema version must be advanced when the generic index tables are introduced.
- `crates/client/cache-wasm/src/shell.rs` is the browser composition boundary.
- `apps/web/src/lib/graphql-cache/**` contains the browser worker protocol and host interfaces.

The current Quick Access projection is unsuitable for exact `EntityFilterAst` matching. It is specialized for fuzzy name search and recency, and non-empty searches load and rank a compact catalog in memory.

## Required architecture

```text
                        predicate-index
                    generic IR and value types
                         ▲              ▲
                         │              │
                item-filter-index    cache-core
                filter compiler      generic index port
                         │              │
              soup-filter-projection   │
              authoritative item facts │
                         │              │
                      GraphQL       cache-turso
                                         │
                                      Turso/OPFS

cache-wasm
  composition only: parse shared API AST, call item-filter-index,
  then pass the generic query to cache-core
```

### Dependency rules

- `predicate-index` must not depend on `item_filters`, cache crates, GraphQL, or Turso.
- `item-filter-index` may depend on `item_filters` and `predicate-index`; it must not depend on cache or Turso crates.
- `soup-filter-projection` owns business-specific fact generation and may depend on Soup/domain models and `item-filter-index`; it must not depend on cache or Turso crates.
- `cache-core` may depend on `predicate-index`; it must not import `item_filters` or know literal/entity semantics.
- `cache-turso` persists and executes generic index operations only. It must not know GraphQL typenames, Soup entity types, or filter literals.
- `cache-wasm` is the composition root and may wire the item-filter compiler to the generic cache engine.
- Authorization remains server-side. The local database is already identity-scoped and must not invent authorization policy.

## Phase 1: Specify every existing filter semantic

Before implementing persistence, build a checked-in support/specification matrix for every current literal under `crates/item_filters/src/ast/**`.

For each literal, record:

- authoritative production-query implementation;
- exact matching semantics;
- required item facts;
- normalization rules;
- viewer-relative inputs;
- whether it is equality, ordered range, membership, exact substring, dynamic-time comparison, or constant logic;
- required sorting values;
- tests proving the behavior.

The audit must include:

- Calendar events: ID, status, start/end ranges, attendees, organizers.
- Documents: file type, ID, project ancestry/scope, owner, importance, notification state, CBM/ATM/NC behavior, subtype, email-attachment state, created/updated ranges.
- Projects: child versus self ID semantics, owner, importance, notification state, created/updated ranges.
- Chats: project, role, chat ID, owner, importance, notification state, created/updated ranges.
- Emails: sender/CC/BCC/recipient direction, complete/domain/partial address semantics, thread ID, mailbox/link owner, project, importance, notification state, shared behavior, calendar-only, created/updated ranges, CRM scope, and internally injected properties.
- Channels: thread, mention, organization, team, channel ID, sender, channel type, importance, viewer participation, and notification state.
- Channel threads: thread ID, channel ID, root sender, participant, and notification state.
- Calls: call ID, channel ID, transcript speaker, status, attendance, and internally injected properties.
- CRM companies: ID and hidden state.
- Foreign entities: internal ID, foreign ID, source, includes-current-user, and notification state.
- Reminders: opt-in/include, ID, referenced entity, completion, and fired state relative to query time.
- Properties: select-option and entity-reference matching, typed versus untyped applicability, Boolean composition, and property-less entity behavior.
- Nil UUID exclusion sentinels and every semantic constant/short circuit.

Every existing literal must be supported before frontend integration. `Unsupported` remains only for malformed input or future schema/profile incompatibility.

## Phase 2: Add generic `predicate-index`

Create a storage-neutral crate, tentatively `crates/predicate_index`.

It should define generic, serializable types similar to:

```rust
pub enum PredicateExpr {
    All,
    None,
    Exact {
        attribute: Token,
        value: ExactValue,
    },
    I64Range {
        attribute: Token,
        lower: Option<Bound<i64>>,
        upper: Option<Bound<i64>>,
    },
    TextContains {
        attribute: Token,
        normalized_value: String,
    },
    And(Box<PredicateExpr>, Box<PredicateExpr>),
    Or(Box<PredicateExpr>, Box<PredicateExpr>),
    Not(Box<PredicateExpr>),
}

pub struct IndexDocument {
    pub profile: Profile,
    pub partition: Token,
    pub exact_facts: Vec<ExactFact>,
    pub integer_facts: Vec<IntegerFact>,
    pub text_facts: Vec<TextFact>,
    pub sort_facts: Vec<IntegerFact>,
}
```

Requirements:

- Tokens are stable and collision-free. Do not use feature hashing for anything affecting exactness.
- Dynamic values use canonical encodings, not hashes.
- Integer encodings cover timestamps and other ordered scalars.
- Text normalization is explicit and versioned.
- Query-time inputs include at least `now_ms` for predicates such as fired reminders.
- Generic query descriptors include sort attribute, direction, stable tie-breaker, limit, and local cursor.
- Input validation bounds AST depth, node count, text length, and total bound values.
- Include a pure reference evaluator used by conformance and property tests.
- Simplify `All`, `None`, and redundant Boolean nodes without converting to DNF.

## Phase 3: Add `item-filter-index`

Create a separate crate, tentatively `crates/item_filter_index`, depending only on `item_filters` and `predicate-index` plus required value-model crates.

Responsibilities:

- Own stable opaque partition and attribute token assignments.
- Compile every current entity-specific `Expr<Literal>` into `PredicateExpr`.
- Compile the `EntityFilterAst` forest into a union of partition-scoped expressions.
- Treat missing entity trees as unrestricted for that partition, except reminders, which remain opt-in.
- Apply the global properties tree to entity partitions exactly as the server does.
- Handle typed/untyped property applicability and property-less entity behavior.
- Compile semantic constants correctly; for example, do not model a server-side short circuit as ordinary Boolean equality.
- Preserve all `AND`, `OR`, and `NOT` semantics without DNF expansion.
- Compile Soup sort methods and direction into opaque generic sort descriptors.
- Produce typed errors for malformed, oversized, or future-incompatible input.

`item-filter-index` must contain all filter-specific query-compilation logic. No equivalent matching switch should appear in `cache-core` or `cache-turso`.

## Phase 4: Extract reusable API AST conversion

Move the REST wire DTO and conversion currently centered around `ApiEntityFilterAst` out of `crates/soup/src/inbound/axum_router.rs` into a reusable filter-facing crate/module with no Axum dependency.

This includes:

- REST field names;
- compound document file-association literals;
- email CRM domain/address expansion;
- conversion into materialized `EntityFilterAst`;
- validation shared by server and browser composition.

Then:

- update the Soup Axum adapter to call the shared conversion;
- have `cache-wasm` accept the same REST AST body and call the same conversion;
- do not duplicate semantics in TypeScript or cache code.

Take care that the REST API email tree and materialized `EmailFilterAst` currently have different serialized shapes.

## Phase 5: Generate complete authoritative projections

Create a business adapter, tentatively `crates/soup_filter_projection`, that generates a complete versioned `IndexDocument` for every Soup entity.

It must use the same opaque identifiers as `item-filter-index`. It must not depend on cache crates.

Projection facts must come from authoritative server data, not inference from arbitrary normalized GraphQL fields. Extend Soup enrichment/loaders where the current `SoupItem` does not contain enough information, including viewer-relative and relation-backed predicates.

Examples likely requiring extra authoritative projection data include:

- all email address directions across the server's matching scope;
- channel mentions, relevant senders, thread relations, and participants;
- call transcript speakers;
- calendar attendees;
- project ancestry where server semantics are recursive;
- viewer notification state;
- CRM/shared-email state;
- complete property values;
- reminder fields needed to evaluate fired state at query time.

Expose the generic projection as a versioned GraphQL envelope. The envelope should contain only generic profile, partition, facts, and sort facts; it must not expose cache implementation details.

Select the projection in:

- `SoupItemFields`;
- `SoupPatchFields`;
- all relevant mutation-effect fragments;
- any operation capable of authoritatively replacing a cached Soup entity.

The projection profile/version is a semantic compatibility boundary. Future filter semantic changes advance the profile without requiring business-specific Turso schema changes.

## Phase 6: Add a generic projection boundary to `cache-core`

Introduce an injected projection interface, approximately:

```rust
pub trait RecordIndexProjector {
    fn project(
        &self,
        key: &EntityKey<'_>,
        effective_record: &Record,
        incoming_update: Option<&Record>,
    ) -> ProjectionUpdate;
}
```

The concrete browser implementation should only extract and validate the generic GraphQL projection envelope. It must not match on entity typenames or filter literals.

Update cache write preparation so storage receives the normalized record and generic projection change together. The following must remain atomic:

- ordinary record upsert plus projection replacement;
- queued mutation settlement plus projection replacement;
- record deletion plus projection deletion;
- cache clear.

Do not model the new index through the existing Quick Access `SearchDocument`. Keep the APIs and storage paths separate.

## Phase 7: Add the generic Turso inverted index

Add generic Turso tables approximately shaped as follows; exact names may change after benchmarking:

```sql
CREATE TABLE index_documents (
    document_id INTEGER PRIMARY KEY,
    profile BLOB NOT NULL,
    partition BLOB NOT NULL,
    __typename TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    projection_hash BLOB NOT NULL,
    UNIQUE(profile, __typename, entity_id)
);

CREATE TABLE index_exact_facts (
    document_id INTEGER NOT NULL,
    profile BLOB NOT NULL,
    partition BLOB NOT NULL,
    attribute BLOB NOT NULL,
    value BLOB NOT NULL,
    PRIMARY KEY(profile, partition, attribute, value, document_id),
    FOREIGN KEY(document_id) REFERENCES index_documents(document_id)
        ON DELETE CASCADE
);

CREATE INDEX index_exact_facts_by_document
ON index_exact_facts(document_id);

CREATE TABLE index_integer_facts (
    document_id INTEGER NOT NULL,
    profile BLOB NOT NULL,
    partition BLOB NOT NULL,
    attribute BLOB NOT NULL,
    value INTEGER NOT NULL,
    PRIMARY KEY(profile, partition, attribute, value, document_id),
    FOREIGN KEY(document_id) REFERENCES index_documents(document_id)
        ON DELETE CASCADE
);

CREATE INDEX index_integer_facts_by_document
ON index_integer_facts(document_id);
```

Add generic normalized-text storage and n-gram postings for exact substring predicates. N-grams are candidate selection only; the final condition must verify the complete normalized text to eliminate collisions and false positives. Handle short strings explicitly.

Use integer `document_id` values internally to keep posting lists compact. External results resolve to normalized `(__typename, entity_id)` record keys.

Required work in `cache-turso`:

- bump `BROWSER_STORAGE_SCHEMA_VERSION`;
- extend `CREATE_SCHEMA`;
- add prepared statements for atomic projection delete/replacement;
- update frozen-schema object, column, index, constraint, and foreign-key validation;
- update corruption/reset tests;
- update `clear` and record deletion;
- preserve health latching and uncertain-transaction behavior.

This is a disposable browser-cache schema reset, not a SQLx migration. Do not add SQLx migrations.

## Phase 8: Lower generic predicates to exact SQL set algebra

Implement a bounded, parameterized SQL builder in the Turso adapter that consumes only `PredicateExpr`.

Lower nodes as follows:

| Generic expression | SQL implementation |
| --- | --- |
| `Exact` | indexed posting lookup |
| `I64Range` | indexed ordered-range lookup |
| `TextContains` | indexed n-gram candidates plus exact text verification |
| `And` | `INTERSECT` |
| `Or` | `UNION` |
| `Not` | scoped profile/partition universe `EXCEPT` child |
| `All` | indexed profile/partition universe |
| `None` | empty relation |

Use nested CTEs or equivalent parameterized subqueries. Do not interpolate values and do not convert the expression to DNF.

The final query must:

- return normalized record keys only;
- order by the requested opaque sort attribute and direction;
- use a stable normalized-record-key tie-breaker;
- support bounded local cursor pagination;
- avoid decoding or scanning `records.value` blobs;
- exploit selective posting/range indexes before broad set operations where possible.

Benchmark alternate generic query shapes (`INTERSECT`/`UNION` CTEs versus correlated `EXISTS`) before fixing the implementation, but preserve identical generic semantics.

## Phase 9: Handle completeness and optimistic state exactly

Represent projection state explicitly:

- `Complete`;
- `Dirty`;
- `Missing`;
- `IncompatibleVersion`.

Rules:

- An authoritative update carrying a complete projection replaces the old projection.
- A potentially relevant record update without a replacement projection marks the entity dirty rather than retaining a possibly stale projection.
- Deletion removes the projection.
- An optimistic effective record is locally queryable only if the injected projector can produce a complete effective projection.
- If any entity relevant to the requested local result has unknown projection state, return an incomplete outcome and use the network path.
- Never silently interpret missing data as a false predicate, especially under `NOT`.

The generic cache API should distinguish at least:

```rust
pub enum IndexedQueryOutcome {
    Page(IndexPage),
    Incomplete,
    Incompatible,
}
```

Malformed filter compilation fails before entering the cache engine.

## Phase 10: Expose a separate browser entity-filter API

Add a distinct API rather than extending Quick Access's fuzzy `search` request.

Inside `cache-core`:

```rust
Engine::query_index(GenericIndexQuery)
```

At the composition boundary:

1. `cache-wasm` parses the shared REST API AST.
2. The shared converter creates `EntityFilterAst`.
3. `item-filter-index` compiles it into a generic query.
4. Only the generic query reaches `cache-core` and `cache-turso`.

In TypeScript, introduce a separate interface such as `EntityFilterIndexHost`, even if the same worker physically implements it. The coordinator protocol may transport the AST request but must not interpret filter semantics.

Apply strict ingress bounds before expensive compilation or SQL generation.

## Phase 11: Integrate `useSoupAstItemsQuery`

Integrate the exact local index into `apps/web/src/lib/queries/soup/items.ts` and its GraphQL path.

For an initial Soup AST request:

1. Send the REST AST body, sort method, sort direction, limit, and current time to the browser index API.
2. If it returns a complete local page, materialize only those normalized record keys through a generated Soup fragment/record selection.
3. Use the materialized page as immediate cached/placeholder data.
4. Continue to use the server as corpus and server-pagination authority.
5. Keep local-index cursors distinct from server cursors.
6. On `Incomplete`, incompatible projection, validation failure, or cache/storage failure, skip local data and follow the existing network path.

The local page must preserve exact filter membership and requested local ordering. The frontend must not rerun a partial TypeScript matcher over the results.

## Phase 12: Verification gate

The complete implementation must not merge until all gates pass.

### Semantic differential tests

- Compare production Soup SQL results with compiled generic-index results for every current literal.
- Cover true and false cases for each literal.
- Cover nested `AND`, `OR`, and `NOT` combinations.
- Cover global properties mixed with entity-specific filters.
- Cover viewer-relative predicates for multiple users.
- Cover timestamps at inclusive/exclusive boundaries.
- Cover email partial/domain/complete normalization.
- Cover reminder opt-in and dynamic fired time.
- Cover nil UUID exclusion sentinels.

### Generic correctness tests

- Compare the pure reference evaluator with Turso results over generated documents and expressions.
- Verify no hash collision can affect exactness.
- Verify `NOT` uses the correct scoped universe.
- Verify stable cursor ordering.
- Verify AST limits reject pathological input before SQL generation.

### Cache lifecycle tests

- Atomic record plus projection writes.
- Projection replacement removes stale facts.
- Delete and clear cascade correctly.
- Mutation settlement remains atomic.
- Dirty/missing/incompatible projections trigger fallback.
- Optimistic updates cannot expose stale exact results.
- Physical reset behavior remains safe after the browser schema bump.

### Turso performance tests

- `EXPLAIN QUERY PLAN` proves exact and range posting indexes are used.
- Queries do not scan/decode normalized record blobs.
- Benchmark browser/OPFS behavior at realistic entity and fact counts.
- Include broad universe, selective conjunction, large disjunction, negation, range, property, and substring cases.
- Set explicit latency and memory acceptance targets before integration is declared complete.

### Browser/frontend tests

- WASM request/response validation.
- Worker coordination transport.
- Local placeholder materialization.
- Network fallback for incomplete state.
- Correct replacement by authoritative network data.
- Pagination does not mix local and server cursor formats.

## Implementation order and revision discipline

Implement in independently verified revisions even though the product release is all-or-nothing:

1. semantic specification matrix;
2. `predicate-index` plus reference evaluator;
3. shared API AST conversion and `item-filter-index` compiler;
4. complete authoritative Soup projections and GraphQL envelope;
5. generic `cache-core` projection/query boundaries;
6. Turso schema and atomic index maintenance;
7. Turso SQL lowering and performance verification;
8. completeness/optimistic handling;
9. browser protocol and `useSoupAstItemsQuery` integration;
10. full differential, WASM, and performance gate.

After each successful verification step, follow repository policy and create a Jujutsu revision with `jj desc -m "..." && jj new`.

## Architectural acceptance criteria

- No `item_filters` dependency in `cache-core` or `cache-turso`.
- No entity/literal switch in cache or Turso code.
- No business-specific columns or indexes in Turso.
- No TypeScript reimplementation of filter semantics.
- No approximate local result presented as exact.
- No vector-distance or FTS dependency for filter matching.
- Business/filter semantics live in `item-filter-index` and `soup-filter-projection`.
- Generic cache orchestration lives in `cache-core`.
- Generic persistence and query execution live in `cache-turso`.
- Browser shell code performs composition and transport conversion only.
- Authorization remains server-side; local indexing does not grant access or widen the cached corpus.
