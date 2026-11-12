# cache-turso

## What it is

Part of the web client's shared infrastructure: the production Turso
(SQLite-compatible, embedded) storage adapter for `cache-core`'s normalized
GraphQL cache — native for tests/Tauri, OPFS-backed on wasm32.

## Start here

- `src/storage.rs`: `TursoStorage` — implements `cache_core::store::Storage`
  with the frozen compound-key schema and strict-head mutation leasing.
- `src/driver.rs`: Turso connection/transaction handling, including checked row-at-a-time query visitation.
- `src/storage/contact_search.rs` / `.sql`: validate the partial `records_contacts_cover_idx` on `records(__typename, id, value)` and explicitly select it after the bound text prefilter. The pinned planner otherwise chooses the extra table lookup. Decode one row at a time for before-limit policy; never add a final SQL limit or collect the corpus. Ordinary search retains its existing covering-only path.
- `src/storage/people_sql.rs`: local relational reads over contact facts in the existing predicate index, not another database or Rust catalog. Derive facts in record transactions, delete them with records, and rebuild in bounded batches only when the profile/account stamp changes. Generic caller projections cannot override these cache-owned facts. SQL reads only needed attributes and limits final results before decoding; enforce both row and byte budgets. Pin fact joins to document/attribute primary-key seeks: the unhinted Turso plan can choose quadratic attribute scans at 100k. The owned profile's layout version 2 also derives bounded name words and epoch-scoped ranking facts. Delta updates change only differing facts; activity updates must not rewrite name-word postings. Rebuild older derived profiles in bounded batches while preserving authority, queue and generation. The indexed reader serves menu policy 5; there is no remote or old-scoring fallback.
- `src/storage/name_search.rs`: indexed name-policy reader over existing owned facts, in one read transaction. Probe at most 129 posting IDs; broad reads bound ordered work to 4096 rank keys per default/current-epoch stream, then use a complete matching stream if needed. Eligibility and current-window DM dedup precede stopping; prior DM aliases use bounded target lookups. Overflow/incomplete records remain explicit streaming paths. Missing/stale projection stamps reject, never empty success. Core and both host families use this path for policy 5. `tests/common/name_search.rs` checks native/OPFS parity with the complete bounded-memory reference.
- `src/storage/search.rs`: bound subsequence SQL prefilter over the covering browse index and checked borrowed-row decoding; reuse the key buffer and let core copy only winners, never collect or limit text results first.
- `src/storage/channel_timeline.rs`: channel timeline rows (written through with every `GraphqlChannelMessage` / `GraphqlChannelTimelineActivity` record), fetched-stretch coverage and the per-channel applied change sequence. Page reads stay on `channel_timeline_scan_idx` and stop at the limit; a test pins VM steps so a page costs the same in a 200-row and a 20,000-row channel. Projection changes rebuild rows from records on reopen and keep coverage and sequences.
- `src/key.rs`: the compound key schema (frozen — see Gotchas).
- `src/error.rs`: `TursoStorageError` / `PhysicalResetReason`.
- `tests/storage_conformance.rs`, `tests/shared_conformance.rs`: the shared
  conformance suite every storage backend must pass.

## Scope

- Owns: translating `cache-core`'s `Storage` trait onto a real Turso database,
  on both native (tests) and wasm32 (browser, via `turso-opfs`).
- Not here: the cache engine logic itself → `crates/client/cache-core`; the
  wasm-bindgen host shell → `crates/client/cache-wasm`.

## Boundaries

- Depends on: `cache-core`, `turso_core`, `turso-opfs` (wasm32 target only).
- Used by: `cache-wasm`.

## Recipes

- Add a storage operation: implement it in `src/storage.rs` → add a case to
  `tests/storage_conformance.rs` (native) and the `tests/web.rs` wasm suite.

## Checks

- `cargo test -p cache-turso` (`SQLX_OFFLINE` unset).
- `cargo test -p cache-turso --test people_sql`: real local counts, late matches, Unicode LIKE, DISTINCT, grouping, virtual columns, bounded output and scope refusal. The shared contract also runs over OPFS in `tests/web.rs`. `--release --test people_sql -- --ignored --nocapture` exercises 100k records plus self and persisted reopening.
- `cargo test --release -p cache-turso --test contacts -- --ignored --nocapture`: hydrate 100k normalized contacts in bounded pages, reopen, search, and materialize only winners. The regular native and OPFS contact suites also check account resets and omitted viewer wrappers.
- `cargo test -p cache-turso --test people`: context publication, stale writes, membership, exclusions, late winners, DM deduplication, ranked continuation/clock/epoch fencing, and scoped bounded reference evidence without allowing context-only membership; the same scenario runs over OPFS. `--release --test people -- --ignored --nocapture` measures 100k-row policy searches.
- `cargo test -p cache-turso --test search -- --ignored --nocapture`: explicit 100k-row search measurement.
- The `web` wasm test target checks streamed search over real OPFS; use the [browser runner](../turso-opfs/README.md#repeatable-verification).
- `cargo test --release -p cache-turso --lib compare_search_scan_options -- --ignored --nocapture`: isolate prepared-statement, covering-index, and borrowed-row costs on a temporary database, without changing production schema.

## Gotchas

- Email send persistence and cancellation belong to the frontend email journal, not the normalized cache or its mutation queue.

- The contact payload index is part of this branch's unpublished schema-12 cutover (tracked `origin/main` baseline: schema 11), not a second migration/version. Older local schema-12 shapes missing the index reject as incompatible; do not silently upgrade or reuse those test files. Fresh/current shape reopen preserves records, queued writes and generation. Benchmark only with fresh synthetic profiles, not user caches.
- Projection 6 includes the visible local-part fallback in contact matching; storage schema remains 12. It is independent of the context-aware person-policy API.
- Contact verification keyset-scans `records` through the existing typename/id key, visits at most 500 rows plus one undecoded lookahead, and returns only scoped IDs and scalar progress. Deletion maintains the existing search/predicate projections transactionally; do not add a contacts table or whole-directory ID set. `tests/people_sql.rs` covers bounded verification/deletion at 1k and optionally 100k; `tests/web.rs` exercises the same contract over OPFS.
- Projection 5 adds viewer-scoped contacts and removes public-profile membership; retention version 2 shares the bounded viewer-page budget with contact search/lookup snapshots. Neither changes storage schema 12 or clears durable data.
- Quick Access projection version upgrades rebuild derived rows from retained normalized records; preserve the mutation queue and storage generation (covered by `src/storage/test/search_projection.rs`). Storage schema 12 is a separate, intentionally incompatible covering-index cutover: native reset drops queued writes; browser versioning opens a fresh file. See `../README.md#streaming-text-search`.

- Storage schema 13 adds the three channel timeline tables as another incompatible cutover from schema 12 (native reset drops queued writes; browsers open a fresh file).

- `#![forbid(unsafe_code)]` and `#![deny(missing_docs)]` — this crate is held to
  a stricter bar than most because it's the single physical-disk commit point.
- The compound-key schema and payload encoding are frozen; an incompatible or
  uncertain on-disk state is classified for physical reset, never silently
  migrated, copied, or redirected to a fallback backend.
- The one exception is a cache format version listed in
  `MIGRATABLE_CACHE_FORMAT_VERSIONS`: `migrate_previous_format` drops the
  refetchable records, search projections, index facts, calendar ranges, and
  channel timeline state in
  one transaction, keeps queued mutations, optimistic layers, and their
  projections, and rewrites the namespace. Everything else still resets.

## Related

- Rules: `.agents/rules/rust/architecture.md`
