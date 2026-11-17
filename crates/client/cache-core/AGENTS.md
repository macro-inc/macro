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
  mutations, watched queries, and optimistic resolution. `with_response_records` composes application sidecars from already-normalized updates into the response transaction. `normalize_network` normalizes a response before its write (schema and parsed documents only, no storage) so a host derives its projections from the same records; `write_normalized_query` / `hydrate_normalized_query(_in_scope)` take that result instead of normalizing again, and hydration never installs its dependencies.
- `src/engine/window_observation.rs`: bounded immutable predicate-window proofs
  over the complete change journal, selected dependencies and catalog input fields;
  unknown evidence never suppresses invalidation.
- `src/normalize.rs` / `src/denormalize.rs`: GraphQL response ↔ normalized record
  transforms.
- `src/store.rs`: the `Storage` trait every backend (e.g. `cache-turso`) implements.
- `src/engine/pass_reads.rs`: reads for a write's projection passes, each stored key once, kept for the write; the write uses them only if `Storage::write_position` has not moved, and otherwise rereads everything it takes from storage in one batch.
- `src/engine/authority.rs`: an opaque durable policy and one response generation, compared under the owner lock without read admission. Cache the authority alongside the identity in the single-owner engine and invalidate both on reset. Let the application decide whether a transition needs retirement; initial non-denials preserve offline snapshots. Carry an unfinished policy across account-witness binding and keep the closed marker until required application retirement completes; retire projection-only sources and persist rebuilt layers without changing commands or unrelated projection shadows. Generate Rust/TypeScript transport schemas with `bun run gen-cache-authority-schema --rust` from `apps/web`.
- `src/engine/retirement.rs`: selective record/optimistic cleanup that preserves authored commands, fresh query revalidations, and canonical identity metadata; recompute affected projection shadows from every surviving layer in the same storage transaction.
- `src/predicate.rs` + `src/record_selection.rs`: the predicate/projection IR
  used to select which cached records satisfy a query.
- `src/search.rs`: disposable Quick Access projection (version 6); email matches subjects and all embedded senders, never snippets or bodies; task projects (`GraphqlSoupInitiative`) index their display name with recency from `metadata`.
- `src/people.rs`, `src/engine/people.rs`: scoped local context snapshots and specialized streamed person search. Context-only stubs never establish membership; exclusions and one-to-one DM deduplication precede the bounded heap. Browser/native hosts expose the API, and the frontend leader publishes bounded context batches. Ranked cursors bind account/generation, policy/layout, context epoch and live contact/context admission tokens. Continuations may be short when prior DM aliases are skipped; only a null cursor proves exhaustion. Quick Access and migrated recipient pickers consume these windows. The ranker precomputes the viewer namespace once and compares canonical key bytes using a stack buffer; preserve exact casing, typename and foreign-viewer rejection. Policy version 6 ranks people with a positive interaction time (the frontend takes it from direct-message channels, including group and never-written DMs) above everyone else among matches at a word start, then exact-name/word-prefix tiers within each group, then contains-only matches, then an address tier for a query whose every term occurs in the address but matches no name tier; recent-first identity-tied ordering within a tier. Policy 7 adds `listPriority` (ordered groups of opaque `GraphqlContact.lists` keys) and `onlyListed`: with a list order the messaged split is superseded and people rank by name stage, then the first group holding any of their lists, then recency, with people in no group last (or dropped by `onlyListed`). Without one, policy 6 order is unchanged. Exact name covers the full name and, for a one-term query, the first space-separated name of a name without a comma, as the browser menus rank people. A property self pin applies only to empty browsing; automated recipient mailboxes are excluded unless explicitly addressed. Its version, and `PEOPLE_MIN_POLICY_VERSION` (5, the oldest the frontend accepts from native desktop, iOS and Android binaries released before it), are generated into the frontend contract.
- `src/people/name_search.rs`: name-first query classification and stable recent-first BLOB keys, with bounded name-word derivation in `name_search/projection.rs`, which also indexes one fact per list key plus list-scoped default/user/command rank keys (`contact_lists` is the one reading of a contact's keys for both the index and the ranker; it drops malformed or oversized keys but never truncates). Exact addresses/identities never match display-name aliases; overflow and malformed context remain explicit. Sparse rank overrides carry their publication epoch and never establish membership. `name_search/reader.rs` owns the bounded recent-first collector and scoped continuations; `Engine::search_people` is the active core entry point. It rechecks membership/flags, deduplicates current winners and uses bounded DM-alias evidence for prior pages. `PeopleReadVersion` binds the live contact admission and context tokens, including same-epoch patches without making unrelated cache writes stale a page. Browser/native hosts advertise policy 7, and the frontend sends `listPriority`/`onlyListed` only to hosts advertising 7 (older hosts reject unknown fields); consumers retain personal window order instead of rescoring it. Reference evidence has its own unchanged policy-4 floor.
- `src/people/sql.rs`: account/generation-fenced local SQL, with no server or directory-fold fallback. Its disposable predicate profile is derived only from viewer-scoped contacts; context stubs and foreign-viewer keys cannot establish membership. Storage returns bounded final rows, explicit incomplete/oversized results, or unsupported. A result still requires the caller's complete backfill checkpoint before being treated as directory-wide evidence.
- `src/people/references.rs`: complete cached-directory label matching with at most two witnesses per requested label. Exact/preferred-full-name/any-name modes preserve caller ambiguity rules; malformed matching records cannot establish uniqueness. `resolve_people_references` is scoped/read-only and needs ready context only when excluding secondary inboxes. The browser/native reference transport is used by migrated planners. Foreign-viewer keys are discarded before private-name matching and cannot affect completeness flags. A completed cache scan is not proof of authoritative server membership.
- `src/search/ranking.rs`: incremental top-K ranking over borrowed storage rows and optimistic shadows; copy only winners and never retain a full text-search bucket. Unicode normalization and subsequence matching live in the WASM-safe `subsequence_match` crate shared with server contact search.
- `src/engine/hydration.rs`: admission checks expected/response identity and durable generation without rebinding accounts or recreating cleared metadata. Contact writes also require a pre-fetch `contactFence`; accepted fenced responses (even identical values) consume it. Unfenced network/optimistic contact writes reject. Call under the same engine lock as persistence.
- `src/engine/staged_hydrate.rs`: a query hydrate computed while it only reads (`stage_hydrate`: the merge, projection changes and records to write) and written in a short step after (`commit_staged_hydrate`). It stages nothing when the hydrate would bind or switch the account, compose with optimistic layers, or fail admission; it holds only while `staged_hydrate_current` (revision, optimistic layers, contact fence, identity) and the host's storage check both pass. `persist_updates` is `plan_persist` then `apply_persist` for the same reason.
- `src/engine/people/sync.rs`: capture the single-owner engine's contact write fence, optionally scan at most 500 raw contact records by key, and reconcile complete exact-ID evidence. Never delete from scan omissions; reject stale fences, foreign/duplicate evidence and omitted self. Removal clears durable/hot records and invalidates dependent reads; context-only stubs are not membership. Engine replacement, clear and contact invalidation/deletion invalidate admission.
- `src/page_retention.rs`: shared Soup/database/contact snapshot budget; hydration drops viewer page/lookup wrappers, not normalized descendants. Public profiles do not prove contact membership; only `GraphqlContact` projects into `person`.
- `src/queue.rs`: the optimistic mutation queue.
- `src/sync.rs` + `src/engine/sync.rs`: streamed sync plans, the NDJSON frame
  decoder, and `Engine::sync_apply_next` (host-neutral; hosts open the stream
  and supply `SyncHooks`). `SYNC_PROTOCOL` is the version every request
  carries; line types the engine does not know are skipped
  (`SyncFrame::Unrecognized`), anything else new needs a new version (see
  `docs/architecture/streamed-cache-sync.md`).
- `tests/`: the primary spec for engine behavior — one file per concern
  (optimistic updates, calendar range, search, subscriptions, fuzz).

## Scope

- Owns: normalization, denormalization, optimistic mutation resolution, watched
  queries, and the storage-agnostic predicate/projection IR.
- Not here: a concrete storage backend → `crates/client/cache-turso`; the wasm
  host shell → `crates/client/cache-wasm`; Soup-specific projection policy →
  `soup_filter_cache_adapter`, `soup_filter_projection`.

## Boundaries

- Depends on: `cache-schema` (schema metadata, as `meta`), `apollo-parser`
  (GraphQL parsing), `predicate-index`,
  `maybe_send`, and the WASM-safe `database_sql` compiler.
- Used by: `cache-turso`, `cache-wasm`.

## Recipes

- Add a new mutation's optimistic resolver: `src/engine.rs` (resolver registration)
  → a new `tests/<name>_optimistic.rs` first (see the existing `*_optimistic.rs` tests).
- Change what a query can select: `src/predicate.rs` → `src/record_selection.rs`
  → `src/query_inspection.rs`.

Live views retain at most 256 validated specifications; visible readers beyond
the bound rebuild a full view on every read, so keep it above what open panes register. A registration token
identifies one retained specification, not the caller's reusable view id.
`resume_live_query` hydrates durable optimistic state before token lookup;
the engine owner serializes token lookup and the read. Replacement, release,
eviction and reset make it miss. A miss requires full registration and never reuses another specification.

## Checks

- Person transport models derive their schemas in `src/people/schema.rs`; the Rust test detects source drift. From `apps/web`, run `bun run gen-cache-people-schema --rust` after changing a model (or `--check --rust` to verify). The `schema` feature is generation-only, not required at runtime.

- `cargo test -p cache-core` (`SQLX_OFFLINE` unset).

## Gotchas

- Preserve the authority generation when binding the first account without a stored policy; commit account/authority metadata atomically on binding or reset and publish the cached authority without post-commit I/O. Reject malformed stored authority instead of treating it as absent.
- Use the shared `_in_generation` enqueue/commit methods in every host; discard stale copied data, links, and projections while retaining authored commands and fresh query revalidation descriptors. `None` is reserved for legacy native clients.

- Keep ordinary title/channel query tokens split on whitespace and commas, with each token matching independently in any order; storage filtering must remain a superset of core ranking.

- Email send persistence and cancellation belong to the frontend email journal, not the normalized cache or its mutation queue.

- Sync pages write through `Engine::sync_write_page` (`src/engine/sync.rs`),
  not `hydrate_query`: records, projections and lane state in one
  `SyncStorage::write_sync_page` transaction, without field changes, viewer
  fields, dependency fan-out or new hot-tier entries. It falls back to the
  general write for identity changes and pending optimistic layers; keep its
  merge semantics in step with `write_network` / `persist_updates`.
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
