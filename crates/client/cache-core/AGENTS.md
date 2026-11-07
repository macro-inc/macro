# cache-core

## What it is

Part of the web client's shared infrastructure: the normalized GraphQL
cache engine — pure, native-tested core shared by every storage backend and
host (web, Tauri). Design doc:
`apps/web/docs/graphql-normalized-cache-plan.md`.

## How it works

GraphQL responses are normalized into keyed records (`normalize.rs`);
watched queries and the optimistic mutation queue read/write those records
through the predicate/projection IR; results are denormalized back into
GraphQL response shape for callers. A concrete `Storage` impl (e.g.
`cache-turso`) persists the records.

## Start here

- `src/engine.rs`: the `CacheEngine` — the crate's entry point, owns queued
  mutations, watched queries, and optimistic resolution.
- `src/engine/window_observation.rs`: bounded immutable predicate-window proofs
  over the complete change journal, selected dependencies and catalog input fields;
  unknown evidence never suppresses invalidation.
- `src/normalize.rs` / `src/denormalize.rs`: GraphQL response ↔ normalized record
  transforms.
- `src/store.rs`: the `Storage` trait every backend (e.g. `cache-turso`) implements.
- `src/predicate.rs` + `src/record_selection.rs`: the predicate/projection IR
  used to select which cached records satisfy a query.
- `src/search.rs`: disposable Quick Access projection (version 6); email matches subjects and all embedded senders, never snippets or bodies; task projects (`GraphqlSoupInitiative`) index their display name with recency from `metadata`.
- `src/people.rs`, `src/engine/people.rs`: scoped local context snapshots and specialized streamed person search. Context-only stubs never establish membership; exclusions and one-to-one DM deduplication precede the bounded heap. Browser/native hosts expose the API, and the frontend leader publishes bounded context batches. Ranked cursors bind account/generation, policy, context epoch and scoring clock. Continuations may be short when prior DM aliases are skipped; only a null cursor proves exhaustion. Quick Access and migrated recipient pickers consume these windows; remaining planner/full-list callers are still pending. Policy version 4 retains mention tiers/weights and property-picker self/domain boosts, and excludes automated recipient mailboxes before the heap unless the full address was typed. Its version is generated into the frontend contract.
- `src/people/references.rs`: complete cached-directory label matching with at most two witnesses per requested label. Exact/preferred-full-name/any-name modes preserve caller ambiguity rules; malformed matching records cannot establish uniqueness. `resolve_people_references` is scoped/read-only and needs ready context only when excluding secondary inboxes. The browser/native reference transport is available; planner adoption remains pending. Foreign-viewer keys are discarded before private-name matching and cannot affect completeness flags. A completed cache scan is not proof of authoritative server membership.
- `src/search/ranking.rs`: incremental top-K ranking over borrowed storage rows and optimistic shadows; copy only winners and never retain a full text-search bucket. Unicode normalization and subsequence matching live in the WASM-safe `subsequence_match` crate shared with server contact search.
- `src/engine/hydration.rs`: background admission checks expected/response identity and durable generation without rebinding accounts or recreating cleared metadata. Call under the same engine lock as persistence.
- `src/page_retention.rs`: shared Soup/database/contact snapshot budget; hydration drops viewer page/lookup wrappers, not normalized descendants. Public profiles do not prove contact membership; only `GraphqlContact` projects into `person`.
- `src/queue.rs`: the optimistic mutation queue.
- `tests/`: the primary spec for engine behavior — one file per concern
  (optimistic updates, calendar range, search, subscriptions, fuzz).

## Scope

- Owns: normalization, denormalization, optimistic mutation resolution, watched
  queries, and the storage-agnostic predicate/projection IR.
- Not here: a concrete storage backend → `crates/client/cache-turso`; the wasm
  host shell → `crates/client/cache-wasm`; Soup-specific projection policy →
  `soup_filter_cache_adapter`, `soup_filter_projection`.

## Boundaries

- Depends on: `apollo-compiler`/`apollo-parser` (GraphQL parsing), `predicate-index`,
  `maybe_send`.
- Used by: `cache-turso`, `cache-wasm`.

## Recipes

- Add a new mutation's optimistic resolver: `src/engine.rs` (resolver registration)
  → a new `tests/<name>_optimistic.rs` first (see the existing `*_optimistic.rs` tests).
- Change what a query can select: `src/predicate.rs` → `src/record_selection.rs`
  → `src/query_inspection.rs`.

Live views retain at most 32 validated specifications. A registration token
identifies one retained specification, not the caller's reusable view id.
`resume_live_query` hydrates durable optimistic state before token lookup;
the engine owner serializes token lookup and the read. Replacement, release,
eviction and reset make it miss. A miss requires full registration and never reuses another specification.

## Checks

- Person transport models derive their schemas in `src/people/schema.rs`; the Rust test detects source drift. From `apps/web`, run `bun run gen-cache-people-schema --rust` after changing a model (or `--check --rust` to verify). The `schema` feature is generation-only, not required at runtime.

- `cargo test -p cache-core` (`SQLX_OFFLINE` unset).

## Gotchas

- Keep ordinary title/channel query tokens split on whitespace and commas, with each token matching independently in any order; storage filtering must remain a superset of core ranking.

- Email send persistence and cancellation belong to the frontend email journal, not the normalized cache or its mutation queue.

- Opaque JSON scalars must preserve floating-point values on reparse — `serde_json`
  is pulled in with the `float_roundtrip` feature; don't drop it.
- `StoredMutation.created_at_ms` is the first-enqueue time hosts report as
  `enqueuedAtMs`: a row replacing an unsent row for the same UUID inherits the
  earlier time. Lease and backoff checks take `now_ms` separately; never read
  `created_at_ms` as the current time.
- Patches structural query changes in place instead of resending full results
  (#7825); a new query shape change needs a patch path, not just a resend.

## Related

- Docs: `apps/web/docs/graphql-normalized-cache-plan.md`
