# cache-turso

## What it is

Part of the web client's shared infrastructure: the production Turso
(SQLite-compatible, embedded) storage adapter for `cache-core`'s normalized
GraphQL cache — native for tests/Tauri, OPFS-backed on wasm32.

## Start here

- `src/storage.rs`: `TursoStorage` — implements `cache_core::store::Storage`
  with the frozen compound-key schema and strict-head mutation leasing. Retiring
  optimistic layers atomically replaces affected projection shadows with the core
  composition of surviving layers; preserve unrelated shadows and command metadata.
- `src/driver.rs`: Turso connection/transaction handling, including checked row-at-a-time query visitation.
- `src/storage/contact_search.rs` / `.sql`: validate the partial `records_contacts_cover_idx` on `records(__typename, id, value)` and explicitly select it after the bound text prefilter. The pinned planner otherwise chooses the extra table lookup. Decode one row at a time for before-limit policy; never add a final SQL limit or collect the corpus. Ordinary search retains its existing covering-only path.
- `src/storage/people_sql.rs`: local relational reads over contact facts in the existing predicate index, not another database or Rust catalog. Derive facts in record transactions, delete them with records, and rebuild in bounded batches only when the profile/account stamp changes. Generic caller projections cannot override these cache-owned facts. SQL reads only needed attributes and limits final results before decoding; enforce both row and byte budgets. Pin fact joins to document/attribute primary-key seeks: the unhinted Turso plan can choose quadratic attribute scans at 100k. The owned profile's layout version 3 also derives bounded name words, epoch-scoped ranking facts, and per-list membership and list-scoped rank facts. Delta updates change only differing facts; activity updates must not rewrite name-word postings. Rebuild older derived profiles in bounded batches while preserving authority, queue and generation. The indexed reader serves menu policy 7; there is no remote or old-scoring fallback.
- `src/storage/name_search.rs`: indexed name-policy reader over existing owned facts, in one read transaction. Probe at most 129 posting IDs; broad reads bound ordered work to 4096 rank keys per default/current-epoch stream, then use a complete matching stream if needed. The address stage reads the `email_lower` fact with the same LIKE terms as contains. Eligibility and current-window DM dedup precede stopping; prior DM aliases use bounded target lookups. Overflow/incomplete records remain explicit streaming paths. Missing/stale projection stamps reject, never empty success. Core and both host families use this path for policy 7. With a list order, each group walks its lists' scoped rank streams in recency order (so a group smaller than the window still stops early), then people in no group walk the plain streams excluding every requested list; `NameSearchRead::scan_start`/`can_stop_at` take the scan's group. The exact-name seed is a range on the full-name fact from the query (inclusive) to the query followed by `!`, the byte after a space (exclusive), so it holds the full name and every `query <rest>` name and first names stay index seeks; the core recheck drops the rest. Within a stage, messaged rows (positive time) sort before unmessaged ones in rank-key order, so early stopping bounds the rest of a stage by the time in the current key. `tests/common/name_search.rs` checks native/OPFS parity with the complete bounded-memory reference.
- `src/storage/search.rs`: bound subsequence SQL prefilter over the covering browse index and checked borrowed-row decoding; reuse the key buffer and let core copy only winners, never collect or limit text results first.
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
- `cargo test --release -p cache-turso --lib generated_chains_long_run -- --ignored`: 1,000 generated storage upgrade chains with interruptions, each checked against a fresh file at the target version.
- `CACHE_MIGRATION_DB=<bench database> cargo test --release -p cache-turso --lib --features migration-test-hooks upgrade_cost_on_a_retained_cache -- --ignored --nocapture`: time the 11 to 12 upgrade against an ordinary reopen of the same database.

## Gotchas

- Email send persistence and cancellation belong to the frontend email journal, not the normalized cache or its mutation queue.
- Permission retirement pages raw and projection-only keys through covering keys, retaining the distinction between an initial cursor and an empty ID. Whole-projection deletion skips old fact reconstruction but still rebases ordered pending contributions; preserve queue rows, retry metadata, and identity bindings.

- Storage 12 added the covering browse index and the partial contact payload index; the registered 11 to 12 step builds both in place. A pre-release local 12 shape missing the contact index still rejects as incompatible: it already says 12, so no step runs. Fresh/current shape reopen preserves records, queued writes and generation. Benchmark only with fresh synthetic profiles, not user caches.
- Projection 6 includes the visible local-part fallback in contact matching; storage schema remains 12. It is independent of the context-aware person-policy API.
- Contact verification keyset-scans `records` through the existing typename/id key, visits at most 500 rows plus one undecoded lookahead, and returns only scoped IDs and scalar progress. Deletion maintains the existing search/predicate projections transactionally; do not add a contacts table or whole-directory ID set. `tests/people_sql.rs` covers bounded verification/deletion at 1k and optionally 100k; `tests/web.rs` exercises the same contract over OPFS.
- Projection 5 adds viewer-scoped contacts and removes public-profile membership; retention version 2 shares the bounded viewer-page budget with contact search/lookup snapshots. Neither changes storage schema 12 or clears durable data.
- Quick Access projection version upgrades rebuild derived rows from retained normalized records; preserve the mutation queue and storage generation (covered by `src/storage/test/search_projection.rs`). Storage versions are separate: see the upgrade steps below and `../README.md#storage-upgrades`.

- `#![forbid(unsafe_code)]` and `#![deny(missing_docs)]` — this crate is held to
  a stricter bar than most because it's the single physical-disk commit point.
- The compound-key schema and payload encoding are frozen; an incompatible or
  uncertain on-disk state is classified for physical reset, never silently
  migrated, copied, or redirected to a fallback backend.
- One exception is a storage version with a registered chain of steps in
  `storage/migration.rs`, which is upgraded in place, never silently: one write
  transaction per step, which also advances `meta.storage_schema_version`, so an
  interrupted upgrade resumes, then the frozen-schema checks every open runs. Bumping
  `STORAGE_SCHEMA_VERSION` without a step fails to compile; clearing `STEPS`
  declares that older files reset. Freeze a step's SQL when registering it:
  never use the current schema constants, which a later version changes. Each
  step gets a test beside the 11 to 12 one in `test/migration.rs`. A missing
  chain, a newer version, or a failing step still resets.
- The other exception is a cache format version listed in
  `MIGRATABLE_CACHE_FORMAT_VERSIONS`: `migrate_previous_format` drops the
  refetchable records, search projections, index facts, and calendar ranges in
  one transaction, keeps queued mutations, optimistic layers, and their
  projections, and rewrites the namespace. Everything else still resets.

## Related

- Rules: `.agents/rules/rust/architecture.md`
