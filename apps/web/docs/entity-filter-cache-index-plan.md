# Incremental Exact GraphQL Entity-Filter Cache Index Plan

## Objective

Use the browser's Turso/OPFS-backed normalized GraphQL cache to answer a deliberately bounded subset of Soup GraphQL filter-AST requests exactly and efficiently.

The first release is a complete end-to-end implementation of a small, versioned support profile. It is not an incomplete implementation of every `item_filters::ast::EntityFilterAst` literal. If any part of a request is outside the active profile, the complete request uses the authoritative network path.

This is **not** vector similarity search, fuzzy Quick Access search, or Turso FTS. The first profile uses only exact posting lists, ordered integer facts, and bounded SQL set algebra.

## Product gate

Before expanding the index, measure whether users need the browser to answer previously unseen filters. If immediate reuse of previously fetched requests provides sufficient value, prefer a much smaller query-result cache keyed by the canonical GraphQL filter input, sort, and limit.

The predicate index is justified only when arbitrary supported GraphQL ASTs must be evaluated over entities already present in the local cache. The first indexed profile must ship end to end and demonstrate useful hit rate and latency before more filter families are added.

## Confirmed decisions

1. The canonical browser input is the Soup **GraphQL filter AST**, not the REST `ApiEntityFilterAst` body.
2. The same `GraphqlEntityFilterAst` value is passed to both the GraphQL network request and the browser index request. The local path must not translate or interpret the REST AST.
3. Exactness applies to completely indexed entities currently present in the identity-scoped local cache. It does not imply that the cache contains the user's complete server corpus.
4. Support is all-or-network per request. An unsupported literal, partition, Boolean shape, sort, or input version causes network fallback before index execution. Supported leaves must never be applied while unsupported leaves are ignored.
5. Dirty, missing, incomplete, or forward-incompatible projections cause network fallback. They must never produce an approximate local page.
6. The first consumer is `useSoupAstItemsQuery`.
7. The first support profile is `soup-flat-v1`, defined below. Expansion is profile-versioned and driven by measured frontend request shapes.
8. Browser Turso/OPFS is the only persistence target. `cache-sqlite` and Tauri are out of scope.
9. The server remains corpus, authorization, and pagination authority. The first local API returns only an initial placeholder page and has no local continuation cursor.
10. Supported optimistic direct-field updates are durably reprojected as ordered overlays. Deterministic overlays remain locally queryable offline; query-relevant uncertainty falls back until authoritative settlement.
11. The existing fuzzy Quick Access search remains separate.
12. Filter semantics remain isolated from cache and storage implementation details.

## Canonical GraphQL AST boundary

Relevant code:

- `crates/graphql_soup/src/inputs.rs` owns the current private `GraphqlEntityFilterAst` input types and conversion into `item_filters::ast::EntityFilterAst`.
- `apps/web/src/lib/queries/soup/graphql/ast.ts` currently translates legacy frontend `SoupAstBody` REST syntax into the generated GraphQL input shape.
- `crates/item_filters/src/ast.rs` defines the materialized domain AST used by authoritative Soup filtering.
- `apps/web/src/lib/queries/soup/items.ts` is the first integration point.

Extract a lightweight, reusable representation of the GraphQL variables shape and its materialization rules. It must be usable by both the GraphQL server adapter and the browser-side `soup-filter-cache-adapter` without depending on Axum or the GraphQL server runtime.

The canonical flow is:

```text
frontend filter state
        │
        ▼
GraphqlEntityFilterAst input
        ├────────────────────► GraphQL Soup request
        │
        └────────────────────► browser entity-filter request
                                      │
                                      ▼
                          shared GraphQL-AST materializer
                                      │
                                      ▼
                               EntityFilterAst
                                      │
                                      ▼
                         soup-flat-v1 eligibility/compiler
```

If legacy callers still produce `SoupAstBody`, `apps/web/src/lib/queries/soup/graphql/ast.ts` may translate it once before this split. The exact output object sent as GraphQL variables must also be sent to the local worker.

The local path must not depend on or reproduce:

- REST field names such as `df`, `pid`, or `ca`;
- REST compound file-association expansion;
- REST-only email CRM side fields;
- `ApiEntityFilterAst` conversion;
- an independent TypeScript filter matcher.

The REST Soup endpoint may retain its adapter independently; it is not an index ingress contract.

## First support profile: `soup-flat-v1`

### Supported Boolean semantics

The profile supports `And`, `Or`, and `Not` without conversion to DNF, but only when every reachable literal and partition is supported. Normal Boolean simplification of `All` and `None` is allowed.

### Supported partitions and literals

Only flat, record-local facts already present in an authoritative Soup item are eligible initially.

| Partition | Supported literals |
| --- | --- |
| Document | `Id`, `FileType`, `ProjectId`, `Owner`, `CreatedAt`, `UpdatedAt` |
| Project | `ProjectId`, `ProjectIdSelf`, `Owner`, `CreatedAt`, `UpdatedAt` |
| Chat | `ChatId`, `ProjectId`, `Owner`, `CreatedAt`, `UpdatedAt` |

The only supported sort methods are `CreatedAt` and `UpdatedAt`, in either direction, with the normalized record key as a stable tie-breaker.

Before implementation, inspect representative `useSoupAstItemsQuery` requests and record any constant or mechanically injected GraphQL leaves required to make this profile useful. A constant/no-op leaf may be added to `soup-flat-v1` only when its authoritative behavior is unambiguous and needs no projection fact.

### Partition exclusion and nil sentinels

A missing entity tree means the partition is unrestricted. Therefore, a request with a missing tree for an unsupported partition is not locally eligible.

The compiler may recognize positive nil-ID exclusion sentinels for unsupported partitions so normal Soup requests can prove those partitions empty. This recognition must be conservative:

- a direct positive nil-ID leaf is `None` for a partition whose persisted IDs cannot be nil;
- an `And` with a proven `None` branch is `None` without interpreting the other branch;
- `Or`, `Not`, or any shape that could include the unsupported partition causes fallback;
- negated nil semantics must never be simplified to exclusion.

### Explicitly deferred from `soup-flat-v1`

- global properties;
- calendar events;
- emails and email views;
- channels and channel threads;
- calls;
- CRM companies and CRM authorization scope;
- foreign entities and deduplication;
- reminders and query-time predicates;
- notification state;
- importance, task assignment, and CBM/ATM/NC behavior;
- attendee, participant, mention, transcript, and other relation-backed predicates;
- substring text matching;
- `ViewedAt` and `ViewedUpdated` sorting;
- local cursor pagination;
- relation-backed or otherwise non-deterministic optimistic projection state.

These are deferred product capabilities, not silently false predicates.

## Required architecture

```text
                    predicate-index
              minimal generic flat IR
                    ▲          ▲
                    │          │
          item-filter-index  cache-core
          profile compiler   generic lifecycle/query port
                    │          │
       soup-filter-projection  │
       direct Soup item facts  │
                    │          │
                 GraphQL   cache-turso
                                │
                             Turso/OPFS

soup-filter-cache-adapter
  parse the shared GraphQL input, materialize it, run profile eligibility,
  derive authoritative/optimistic projections, and pass generic IR through
  cache-wasm to cache-core
```

### Dependency rules

- `predicate-index` must not depend on `item_filters`, cache crates, GraphQL, or Turso.
- `item-filter-index` may depend on `item_filters` and `predicate-index`; it must not depend on cache or Turso crates.
- The shared GraphQL input/materialization module must not depend on Axum. Browser-compatible code must not require the GraphQL server runtime.
- `soup-filter-projection` owns business-specific direct fact generation and may depend on Soup/domain models and `item-filter-index`; it must not depend on cache or Turso crates.
- `cache-core` may depend on `predicate-index`; it must not know Soup entity or literal semantics.
- `cache-turso` persists and executes generic index operations only. It must not know GraphQL typenames, Soup entity types, or filter literals.
- `soup-filter-cache-adapter` owns browser-side GraphQL Soup materialization, compilation, typename recognition, and projection derivation. It emits only generic predicate/projection IR.
- `cache-wasm` is a thin browser composition shell. It may link the Soup adapter into the same WASM binary, but cache engine behavior must operate only on generic predicate/projection IR and must not implement Soup policy.
- Authorization remains server-side. The local index only evaluates projections delivered through an identity-scoped authorized cache.

## Phase 0: Audit request shapes and set success criteria

Before implementation:

1. collect representative GraphQL filter variables produced for `useSoupAstItemsQuery`;
2. determine the percentage that `soup-flat-v1` can answer;
3. identify routinely injected constant or nil-sentinel leaves;
4. set an initial-page latency target and a minimum useful local-hit-rate target;
5. decide whether cached query-result reuse would meet the product need more cheaply.

Do not expand semantic scope before this audit. Record the support manifest as GraphQL `Type.field` names, not REST wire tokens.

## Phase 1: Share GraphQL input materialization

Extract the GraphQL filter input representation and conversion currently centered in `crates/graphql_soup/src/inputs.rs`.

Requirements:

- preserve the generated GraphQL variables shape exactly;
- preserve GraphQL-specific enum, ID, RFC3339, one-of, and CRM validation;
- convert into the same materialized `EntityFilterAst` used by authoritative Soup;
- bound AST depth, node count, string length, and aggregate value bytes before expensive compilation;
- use the same conversion in the GraphQL server and browser composition boundary;
- add round-trip fixtures using actual generated TypeScript GraphQL variables;
- do not route the browser through `ApiEntityFilterAst`.

## Phase 2: Add the minimal storage-neutral predicate IR

Create or reduce `predicate-index` to the types needed by `soup-flat-v1`:

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
    And(Box<PredicateExpr>, Box<PredicateExpr>),
    Or(Box<PredicateExpr>, Box<PredicateExpr>),
    Not(Box<PredicateExpr>),
}

pub struct IndexDocument {
    pub profile: Profile,
    pub partition: Token,
    pub exact_facts: Vec<ExactFact>,
    pub integer_facts: Vec<IntegerFact>,
    pub sort_facts: Vec<IntegerFact>,
}
```

Requirements:

- stable collision-free tokens and canonical dynamic values;
- microsecond-safe UTC timestamp encoding matching PostgreSQL boundaries;
- a query descriptor containing profile, partition predicates, sort, stable tie-break direction, and limit;
- no local cursor in the first profile;
- bounded validation and Boolean simplification without DNF expansion;
- a pure reference evaluator for compiler and Turso conformance tests.

Do not add text facts, n-grams, correlated groups, query-time values, scope proofs, result stages, or winner-selection machinery before a supported filter requires them.

## Phase 3: Compile only the supported profile

`item-filter-index` owns opaque partition/attribute vocabulary and compiles materialized `EntityFilterAst` into the minimal generic IR.

Compilation must be two-stage:

1. eligibility checks the complete materialized forest, all partitions, sort, and relevant request options;
2. compilation runs only after eligibility succeeds.

Use a typed outcome such as:

```rust
pub enum LocalCompileOutcome {
    Supported(ValidatedIndexQuery),
    Unsupported(UnsupportedReason),
}
```

Malformed or oversized input remains an error. A well-formed GraphQL filter outside `soup-flat-v1` is `Unsupported` and follows the network path; it is not a user-visible error.

Tests must prove that unsupported leaves under `And`, `Or`, and `Not` cannot disappear through simplification unless a supported `None` branch makes the complete partition mathematically empty.

## Phase 4: Generate compact direct-field projections

Generate a versioned generic projection in `soup-filter-cache-adapter` from the direct fields on each authoritative Document, Project, or Chat GraphQL response. Use the same projection policy for authoritative responses and local optimistic updates. Do not build a second relation-hydration subsystem for the first profile.

The projection may contain only the facts required by `soup-flat-v1`:

- identity;
- direct owner and project/parent identifiers;
- document file type;
- created and updated timestamps;
- created and updated sort facts.

If a proposed fact is not reliably available on the authoritative Soup item, defer that literal or add the value to authoritative Soup hydration. Do not issue an independent set of relation queries merely to increase local filter coverage.

Select the required direct fields in initial Soup, patch, and mutation-effect fragments capable of replacing supported entities. The browser adapter must require every field needed for a complete projection; missing or malformed direct fields mark the record incomplete rather than producing an empty or partial projection.

Do not expose cache projection facts in the server GraphQL schema. Local-first optimistic writes must be able to recalculate the same facts without a server round trip.

## Phase 5: Add generic cache lifecycle boundaries

Add a generic projection interface to `cache-core`, keeping normalized record and projection changes atomic.

Represent at least:

- `Complete`;
- `Dirty`;
- `Missing`;
- `IncompatibleVersion`.

Rules:

- authoritative replacement with a valid projection atomically replaces prior facts;
- a potentially relevant update without a valid replacement projection removes queryable facts and marks the record dirty;
- deletion removes the projection;
- cache clear removes all projections;
- deterministic optimistic direct-field writes persist ordered replacement, patch, or deletion overlays alongside the mutation queue;
- uncertain optimistic writes fall back only when their partition/attribute dependencies intersect the query;
- any dirty, missing, or incompatible record in a queried partition returns `Incomplete`;
- unsupported compilation fails before entering `cache-core`.

The first release deliberately prefers broad network fallback over trying to prove that a dirty record could not match.

## Phase 6: Add minimal Turso persistence and SQL evaluation

The first schema needs only:

- index documents with normalized record key, profile, partition, and completeness state;
- exact facts;
- integer facts;
- sort facts.

Use compact integer document IDs and foreign-key cascades. Keep record replacement, projection replacement, mutation settlement, deletion, invalidation, and clear atomic.

Do not add text/ngram, correlated-group, scope-proof, or result-stage tables in `soup-flat-v1`.

Lower generic expressions with bounded parameterized SQL:

| Expression | SQL operation |
| --- | --- |
| `Exact` | indexed posting lookup |
| `I64Range` | indexed ordered-range lookup |
| `And` | `INTERSECT` |
| `Or` | `UNION` |
| `Not` | profile/partition universe `EXCEPT` child |
| `All` | complete profile/partition universe |
| `None` | empty relation |

The final query must return normalized record keys, order by the requested created/updated sort fact, use a stable record-key tie-breaker, and apply a bounded initial-page limit. It must not decode or scan normalized `records.value` blobs.

The Turso adapter must not advertise an available exact-query capability until SQL evaluation and completeness checks are implemented. Returning an empty page from an unimplemented evaluator is forbidden.

## Phase 7: Integrate the browser API and first consumer

Add a distinct entity-filter index API rather than extending fuzzy Quick Access search.

The request transports:

- the exact `GraphqlEntityFilterAst` variables value used by the network request;
- supported sort method and direction;
- initial-page limit.

At the browser boundary:

1. deserialize and validate the shared GraphQL input;
2. materialize `EntityFilterAst` with the shared GraphQL conversion;
3. evaluate `soup-flat-v1` eligibility;
4. compile a generic query;
5. call `cache-core` and Turso only for supported requests;
6. materialize returned normalized keys through generated Soup cache fragments.

`useSoupAstItemsQuery` uses a complete local page as immediate placeholder data and still sends the authoritative GraphQL request. On `Unsupported`, `Incomplete`, incompatibility, validation failure, or storage failure, it follows the existing network path without local placeholder data.

The frontend must not rerun a partial TypeScript matcher over index results.

## Phase 8: Verification and product gate

### GraphQL boundary tests

- generated TypeScript GraphQL variables deserialize through the shared Rust input;
- server and browser materialization produce identical `EntityFilterAst` values;
- REST-only shapes are rejected by the local GraphQL boundary;
- ingress bounds reject pathological inputs before compilation.

### Supported semantic differential tests

For every `soup-flat-v1` literal:

- compare authoritative Soup SQL membership with the reference evaluator and Turso;
- cover true and false cases;
- cover all four date bounds at equality boundaries;
- cover nullable project/parent facts under `Not`;
- cover nested `And`, `Or`, and `Not`;
- cover positive nil exclusion and negated nil behavior.

### Unsupported fallback tests

- every deferred entity partition causes `Unsupported` unless conservatively proven empty;
- every deferred literal causes `Unsupported` in all reachable Boolean positions;
- global properties and unsupported sorts cause fallback;
- no unsupported request reaches Turso;
- no supported subset is returned for a partially supported request.

### Generic and cache tests

- reference evaluator and Turso agree over generated flat documents and expressions;
- `Not` uses only the complete profile/partition universe;
- ordering and tie-breaking are stable;
- record and projection writes are atomic;
- stale facts disappear on replacement;
- delete and clear cascade;
- dirty/missing/incompatible and query-relevant uncertain optimistic states fall back;
- deterministic optimistic create, patch, and delete overlays survive restart and preserve top-N ordering;
- physical browser-schema reset remains safe.

### Performance and frontend tests

- `EXPLAIN QUERY PLAN` demonstrates posting/range index use;
- no normalized record blob scan occurs;
- browser/OPFS latency meets the Phase 0 target;
- worker transport and local placeholder materialization work end to end;
- authoritative network data replaces placeholder data correctly;
- measured supported-request hit rate meets the Phase 0 threshold.

Do not expand the support profile until this gate passes and an actual local page is observable in the consumer.

## Expansion policy

Add one semantic family at a time, advance the projection profile when facts or semantics change, and retain query-level fallback for older or unsupported profiles.

Suggested order:

1. calendar scalar fields;
2. simple relation-existence facts such as document email-attachment state;
3. notification facts with explicit invalidation;
4. global properties;
5. reminders and captured query time;
6. substring text facts and n-grams;
7. channels and calls;
8. email correlated message groups;
9. CRM scope and server-minted authorization/completeness proofs;
10. CRM-email and foreign-entity post-filter deduplication.

Before adding a family, document:

- demonstrated frontend demand;
- authoritative semantics;
- required projection facts;
- whether facts are record-local or relation-backed;
- invalidation fan-out;
- new generic IR/storage capability;
- differential tests;
- profile compatibility impact.

Do not add a generic capability speculatively before a supported filter needs it.

## Implementation order and revision discipline

Implement in independently verified revisions:

1. GraphQL request-shape audit and checked-in `soup-flat-v1` support manifest;
2. shared GraphQL input materialization;
3. minimal predicate IR and reference evaluator;
4. supported-profile eligibility and compiler;
5. compact projections derived locally from GraphQL direct fields;
6. generic cache lifecycle boundary;
7. minimal Turso schema, maintenance, and SQL evaluation;
8. browser protocol and `useSoupAstItemsQuery` integration;
9. differential, WASM, performance, and product gate.

After each successful verification step, follow repository policy and create a Jujutsu revision with `jj desc -m "..." && jj new`.

## Architectural acceptance criteria

- The local request uses the exact GraphQL filter input object also sent to the server.
- No REST AST parsing or conversion occurs in the browser index path.
- No TypeScript reimplementation of filter matching semantics exists.
- A partially supported request never produces a partial local result.
- No `item_filters` dependency exists in `cache-core` or `cache-turso`.
- No entity/literal switch exists in cache or Turso code.
- No business-specific columns or indexes exist in Turso.
- No relation-hydration projection subsystem is introduced for `soup-flat-v1`.
- No text, group, proof, dynamic-time, or winner-selection machinery exists before a supported family requires it.
- Generic cache orchestration lives in `cache-core`.
- Generic persistence and query execution live in `cache-turso`.
- `soup-filter-cache-adapter` owns GraphQL Soup transport materialization and business projection policy.
- Browser cache shell code only wires adapter output into generic cache APIs; no Soup typename, field, literal, or projection vocabulary switch exists there.
- Dirty or uncertain local state always falls back to the network.
- Authorization remains server-side; local indexing does not grant access or widen the cached corpus.
- The first implementation returns a verified local page through `useSoupAstItemsQuery` before semantic expansion begins.
