# graphql-cache

Normalized GraphQL cache with disk-backed persistence for urql. Design doc:
[`apps/web/docs/graphql-normalized-cache-plan.md`](../../apps/web/docs/graphql-normalized-cache-plan.md).

## Crates

| Crate | Purpose |
|---|---|
| `cache-core` | Pure engine: normalize/denormalize, LRU hot tier, dependency index, durable ordered optimistic-mutation queue, async `Storage` trait |
| `cache-schema` | Schema metadata derived from the GraphQL SDL (`cache_core::meta`); kept apart so `cache-wasm`'s build script can build the tables without the engine |
| `cache-turso` | `Storage` over Turso core — browser WASM and Tauri native hosts |
| `turso-opfs` | Browser OPFS `IO`/`File` adapter for the dedicated Turso engine worker |
| `cache-wasm` | wasm-bindgen shell combining the engine, Turso storage, and OPFS adapter for browser worker glue (`apps/web/src/lib/graphql-cache/`) |
| `cache-bench` | Production-size datasets and the native and browser replays that measure the engine; see its `AGENTS.md` |
| `cache-diff-fuzz` | Differential fuzzer: runs the same seeded operations on two builds of the native host engine and compares responses and durable state (see its `AGENTS.md`) |

The Tauri host lives in the tauri workspace (it needs the patched tauri fork
pinned there): `apps/web/tauri/graphql_cache_plugin`, path-depending on
`cache-core`/`cache-turso`. Test it from `apps/web/tauri` with
`cargo test -p graphql_cache_plugin` (on NixOS use the `tauri-linux` dev shell —
Tauri's Linux desktop stack needs its WebKitGTK/DBus system libraries).

## Runtime GraphQL schema

Desktop and mobile keep the cache engine and Turso storage in the native binary.
The frontend bundle supplies the original `static_assets/schema.graphql` SDL as
text, and native startup passes it to the Rust `Schema::from_sdl` parser, which
validates it with `apollo-compiler` and derives the cache's internal lookup
tables. There is no TypeScript schema generator or intermediate JSON asset.

The browser engine is built together with the web bundle, so `cache-wasm`'s
`build.rs` runs the same parser when the engine is compiled and embeds the
resulting tables (postcard). A browser worker decodes them in under a
millisecond instead of parsing about 270 KB of SDL each time it starts.
`configureCacheSchema` still installs a different SDL before storage opens, but
the app's worker does not call it.

Native startup calls `graphql_cache_init_with_schema`. This requires one native
release; set the OTA bundle's `MIN_NATIVE_BUILD` to the first build containing that
command. Older native binaries cannot accept runtime SDL. The frontend does
not fall back to the old initialization command; it runs uncached and asks for
an app update instead.

An engine owns a validated schema snapshot; there is no mutable global schema.
Validated fragment caches include schema identity in their keys. The cache file
stores the schema its records were written under, and an open with another
schema first brings the records to it ([schema changes](#schema-changes)). When
an OTA reload leaves the native process alive, the new webview's schema is
merged under the engine lock and recorded in storage, so older windows and
pending mutations can still reference earlier definitions; that merge refuses a
changed field shape, root type or entity identity, which waits for the next
open. Installing a schema neither discards queued mutations nor changes the
durable storage generation. Schema-driven normalization accepts new types, but
handwritten search/filter projections and new IPC commands still need native
code.

## Startup and integrity checks

Normal opens validate schema, scope/version metadata, and pending mutation/optimistic
state without running a full-file `PRAGMA quick_check`. Cached records retain their
checked decoding and runtime corruption handling. This applies to both native
Tauri and browser OPFS storage.

`TursoStorage::check_integrity()` is an explicit, synchronous diagnostic for callers
that need a full scan. Keep it off startup and foreground-read paths; it is not
scheduled automatically in the background. Failures latch the existing storage
health state without deleting records or pending mutations. Recovery/reset remains
an explicit caller decision after closing the storage.

## Record encoding

`records.value` is postcard behind a one-byte tag: payloads of 256 bytes or more are
deflated (`miniz_oxide`, level 3) when that is smaller, and everything else stays
raw. Large text records — foreign-entity source metadata and email bodies —
dominate the database and shrink about 3×; a real 155 MB record payload became
48 MB. Level 3 keeps that size win with markedly less CPU in the slowest batches
than level 6, which matters because deflate runs while the engine lock is held.
Decompression is bounded per record. Queued mutations, optimistic layers, and
projections keep their unframed postcard encoding, so a format upgrade never
re-encodes them.

Only the immediately prior cache format version is migratable
(`MIGRATABLE_CACHE_FORMAT_VERSIONS`). A native file at an older storage schema
version is first upgraded when a chain of steps from its version is registered
([storage upgrades](#storage-upgrades)), and resets otherwise. Opening a
migratable format drops records and every table derived from them — all
refetchable — by recreating the tables, as a schema Reset does, and keeps
queued mutations, optimistic layers, and their projections, then rewrites the
namespace in the same transaction. An interrupted migration therefore retries on
the next open. Native owners then try to `VACUUM INTO` a fresh file and swap it
in, so an upgrade usually releases the space the dropped records occupied
instead of leaving free pages in the old file. The swap moves the migrated file
aside first; an open that finds only that copy, after a crash in between, moves
it back. The browser's physical database
name embeds the format version, so a browser upgrade starts a new file instead
of migrating; the previous file is left for any tab still running the older
bundle.

## Storage upgrades

A native database written at an older `STORAGE_SCHEMA_VERSION` is upgraded in
place when `cache-turso/src/storage/migration.rs` registers a chain of steps
from its version to the current one. Each step is frozen SQL that runs in one
write transaction, which also advances `meta.storage_schema_version`, so a
stopped upgrade resumes from the last committed step. The last step's
transaction also runs the frozen-schema checks, so the current version is
committed only for a file with exactly the tables and indexes a fresh file has;
a chain that would produce anything else rolls back to the version before its
last step and resets. Later opens find a fresh file's schema digest and skip
those checks. The open then runs the queue checks as every reopen does.

Records, queued mutations, optimistic layers and the storage generation stay,
so an upgrade refetches nothing and loses no queued write; a format migration
that runs after it (above) still drops the refetchable rows. A file whose
`meta` names another scope, or a cache format this build cannot carry forward,
is rejected before any step runs. A version with no chain, a newer version, or
a failing step resets as before, and so does a file an older build opens after
a newer one upgraded it. Bumping the version without registering a step fails
to compile; clearing `STEPS` declares that every older file resets. The
plugin's `graphql_cache.native.open` span records the version a file came from
as `graphql_cache.storage.upgraded_from`, and logs an event with it and the
open's duration inside the init command's `graphql_cache.ipc.receive` span,
which carries the webview's trace id as `upstream.trace_id`.

Browser database names embed the storage version, so a browser build with a new
storage version still opens a new database and backfills, leaving the older one
for any tab still running the older bundle. A browser open never runs a step:
an older version found under the current name resets, as before steps existed.

## Schema changes

A cache stores the GraphQL schema its records were written under, deflated, in
the `cache_schema` table (storage schema 13). An open with another schema calls
`TursoStorage::adopt_schema` before anything reads, and
`cache_core::schema_change` sorts the change into one of three tiers, by record
type:

- **Compatible**: additions, widenings, new union members, and removed fields
  or types no projection reads. Every stored value means what it did, so only
  the stored schema is rewritten.
- **Types**: some types changed kind, identity or a field's shape, lost a union
  member, or lost a field a projection reads; a type holding a changed type's
  values inline changes with it. Their records go, with their index documents,
  facts, Quick Access rows and derived stores (`DERIVED_STORES` in
  `cache-turso/src/storage/schema_store.rs`), and every other type stays warm.
  When documents keyed by other records read a changed type, every document is
  marked incomplete.
- **Reset**: an operation root was renamed, the stored schema cannot be read
  (another compatibility epoch or artifact format), the schema to store would
  not validate, or applying the Types tier failed or ran out of space and
  rolled back. Every refetchable row goes.

Every tier keeps the cache's identity, authority and queued mutations. The
migration of a previous cache format, which runs before adoption, keeps them
too, rewriting the kept records in the new format, and marks the stored schema
unreadable so adoption resets the rest. Types and Reset drop the storage generation record, so the backfill starts over and
refetches what went. A queued write's optimistic overlay that no longer fits is retired:
the mutation is still sent, but its overlay adds no records and its queued
projections go with it. Queued projections of the records that went go too,
and every queued projection when every document is marked incomplete, so no
optimistic list entry outlives its record or the facts it was derived from.
A queued write whose server response no longer normalizes, because the schema
dropped a field it selects, settles without that content, as a stale outcome
does, instead of retrying at the head of the queue forever: the IDs the server
gave keep their aliases for the writes queued after it, the host reports why,
and the queries the write names for revalidation refetch.
Settling a create moves the shadows of the writes queued after it to the key
the server gave the record while their sources keep the local key, so a tier
follows the alias settlement stored from one to the other, and keeps the
alias, coalescing UUID and deletion tombstone of each record the queue names,
as the engine's own snapshot retirement does. The stored schema
is the incoming one plus the definitions it removed that kept records may still
hold, so a later build that adds a field back with another shape drops the old
values instead of reading them as the new type. A cache stored before schema 13
is read as written under `cache-core/src/schema_change/unrecorded.schema`, the
schema the last builds without a stored copy shipped. It does not change once
it ships, and an epoch bump retires it. An older native build's `schema.json`
names what wrote its cache instead, and one that cannot be read resets it. An
epoch bump makes every stored schema unreadable: a native file, even one at a
previous cache format, moves to the new namespace and resets on adoption,
keeping its queued writes, while a browser
database's name holds the epoch, so the browser opens a new, empty file, as it
does for a cache format or storage schema bump, and the writes still queued in
the old file are not carried over. A native build older than its file's storage
schema cannot read it and replaces it, queue included. A removed enum value or a changed
argument or default is not visible in the schema and leaves stale values, as a
server change without a schema change would.

Both hosts pass `soup_filter_cache_adapter::projection_inputs()`, the record
fields their index projections read, and storage adds the fields its own
derived rows read (`ProjectionInputs`' derived list in
`cache-core/src/schema_change/inputs.rs`). Removing a field no projection reads
is free; removing one a projection reads changes its type. Adoption sees only
what the incoming build's projections read, so a change that also stops a
projection reading a field leaves the facts the previous build derived from it
until their records are written again. A new store of rows
derived from records lists its tables in `DERIVED_STORES` and the fields it
reads in that derived list.

Natively, `open_cache` adopts the bundle's schema on every open. A tier that
finds the file corrupt or leaves a write's outcome uncertain, or a cache that
cannot even reset, is replaced and opened empty; `graphql_cache.native.adopt_schema`
records the tier, counts and duration. The browser worker adopts its built-in
schema on open and records the same as `cache.schema.*` attributes on the open
span. Types deletes the changed types' rows, so it costs about in proportion
to the rows dropped; a type holding more than half of the documents instead
keeps the other documents' facts and recreates the fact tables. Reset drops and
recreates every table records feed, which frees their pages without rewriting
them. On a
320 MB cache-bench database (256k records), a compatible open took 7–9 ms
natively and 15–72 ms in browsers, a Types change 0.5–4.2 s natively and
0.9–6.3 s in browsers, and a Reset 2.0–2.7 s natively and 0.3–1.6 s in browsers.
The ignored `schema_cost` tests in `soup_filter_cache_adapter` (native) and
`cache-wasm` (browser) measure each tier on a database you supply.

## Network refreshes

Normalized refreshes persist only records whose merged contents changed. The hot
tier is published after the atomic storage write succeeds, so failed writes cannot
make retries incorrectly look unchanged. With no optimistic layers, the changed
record keys also identify visible changes without duplicate before/after snapshots.
Pending layers still use full effective-view comparison and rebasing.

Soup hydration checkpoints carry the cache's durable storage-generation UUID.
The engine stores this marker alongside normalized records, so clearing or
replacing the database invalidates its cursors and update watermarks even when
localStorage survives. Backfill waits for the current generation before resuming
and checks it again after each hydrated page. A mismatch starts a full scan;
ordinary engine handoff preserves the marker and continues the saved scan.
Reset notifications restart active backfills promptly, but checkpoint validity
does not depend on observing a notification.

## Soup page retention

Backfill hydration persists normalized descendants (including email message
pages), identity, email links and filter/search projections, but not the viewer's
`soup(...)` / `groupSoup(...)` page wrappers. `@cacheOnly` still controls the
returned cursor projection; it is not an entity-eviction directive.

Foreground Soup snapshots share a per-viewer budget of 64 pages and 2 MiB
(encoded fields plus retention metadata). Most recently written pages win; reads
do not persist recency or cause a COMMIT. Individually oversized snapshots are
not retained. Evicted snapshots miss and require a network refetch; their entity
records and pending offline mutations remain available.

The byte budget accommodates a capped 20,000-row database read at 500 rows per
page, including filter-bearing cursors. A smaller budget evicted the beginning
of a table while loading its end, forcing warm reads back onto the network.

On the first compatible Turso open after this upgrade, a metadata-versioned
transaction compacts only `GraphqlUser` records via the type/id index. It prefers
initial pages when legacy data has no recency ordering. It preserves the storage
generation, normalized entities, projection facts, queue and optimistic shadows.
Subsequent opens only check the marker. There is no schema/namespace bump, reset,
or VACUUM; freed pages can be reused without rewriting the whole database file.

## Query-write invalidation

Query responses and subscription events carry optional `searchChangedBuckets`,
using the same composed-view comparison as hydration. An empty list proves that
Quick Access needs no refresh; missing metadata, mutations, deletions and
identity resets remain conservative. Both browser-worker and native hosts
preserve this distinction.

Active queries track the canonical top-level fields they select on `GraphqlUser`,
including argument-qualified Soup pages. Query writes only wake readers of changed
viewer fields, while document/property/etc. changes still invalidate by record.
Normalization installs the same dependencies as cache reads, without another read.
Missing records, incomplete response registrations, explicit invalidations/deletions
and resets retain conservative behavior. Page-retention eviction wakes readers of
the removed page. This is in-memory dependency tracking, not a storage migration.

## Maintained query views

`Engine::read_live_query` combines a validated predicate query, same-query server
membership evidence, and a generated fragment selection. The first read returns
ordered keys and selected records. Later reads return insertions/removals and
field-path patches, including nested normalized entities and response aliases.
One engine lock covers membership and projection, so callers do not coordinate
filter calls, chunked record reads, and revision retries.

Views track the normalized dependencies of each selected row. Record changes
reproject only dependent rows; projection changes reevaluate membership through
the existing predicate index. Ordinary network writes, hydration, optimistic
writes and settlement share the engine change journal. Resets, external
invalidations and gaps in that bounded journal conservatively rebuild the view.
Views are released on unsubscribe and bounded by an LRU; eviction is safe because
a subscriber with an unavailable cursor receives a full replacement.

Web code has one default reactive read per data shape: `createSoupLiveQuery` for
Soup lists, which feature code reaches through `useSoupAstItemsQuery`, and
`createLiveQuery` for other GraphQL documents. See
[choosing a reactive read](../../apps/web/docs/graphql-normalized-cache-plan.md#choosing-a-reactive-read).

For Soup, `createSoupLiveQuery` owns network fetching, server pagination, cache
baselines, and local fallback selection. Its non-suspending `data()` accessor
returns reactive GraphQL records; callers do not coordinate cache revisions:

```ts
const soup = createSoupLiveQuery(() => ({
  filters: filters(),
  sortMethod: 'UPDATED_AT',
  sortDirection: 'DESC',
  limit: 50,
}));

// Render soup.data(); live fields update without per-mutation query callbacks.
await soup.fetchNextPage();
await soup.refresh();
```

The source preserves the email view and sort direction on continuation requests.
It selects maintained views on supporting hosts, uses the shared coherent-page
reader for Mail and older hosts, and retains network data on local failures.
Once a maintained view catches up, it owns the displayed rows through field
updates and rollback. Hydration advances the same authority watermark, and Soup
selects notification identities so nested state updates can avoid query rereads.
The legacy REST-shaped Soup facade translates its request and projects these
records into UI entities through one keyed mapper. Fetched versions remain
separate from local display versions so pagination coverage cannot drift.

Inside `createSoupLiveQuery`, a Soup-internal binding owns subscription,
coalescing, cleanup and engine-generation recovery, preserving keyed row stores
and applying patches in one batch. Its only source is a reconciled flat Soup
filter; it is not a general query API.

Mutations still use ordinary GraphQL execution and the registered local resolver.
The view requires no per-mutation update callback. This is an incremental row
projection layer, not a general local SQL engine: membership changes still run
the indexed predicate query, and arbitrary joins/aggregates are not compiled.
Unknown membership retains server baseline evidence. Mail cursor pagination and
older hosts keep the existing reconciliation path. All views remain limited to
data known to the cache; remote changes require the existing network feeds.

Ordinary GraphQL queries use `createLiveQuery(document, variables, options)`:

```ts
const accounts = createLiveQuery(
  MailAccountsDocument,
  () => ({}),
  () => ({ client: getGraphqlSoupClient() })
);
```

It is a document-first wrapper over `createUrqlQuery`, so it keeps the existing
urql query contract while cache-core tracks selected fields and returns
response-path patches. Existing `createUrqlQuery` and `createUrqlInfiniteQuery`
consumers benefit from the same path automatically and need no migration;
cursor-paginated documents use `createUrqlInfiniteQuery`.
Aliases, fragment types, arguments, variable defaults and conditional selections
are resolved by the core reader. Leaf edits patch through compiled field
bindings without reading. Structural edits (links, list membership and order,
tombstones, type changes) and journal barriers re-read the query, rebuild its
bindings and diff the result against the retained response; only a new root or a
replacement of most of the response resends it. Teardown, account resets and
bounded retention discard obsolete bindings and responses. See
[the live query API guide](../../apps/web/docs/graphql-normalized-cache-plan.md#8-live-query-api)
for mutation examples and the distinction between reactive cached fields and
domain-specific collection membership.

## Entity-rooted optimistic relations

Link recipes may use an optional `recordRoot` (`fragmentName`, `entityKey`).
The document is then a fragment-only, variable-free selection validated against
normalized schema types. Traversal starts at that record, including in cold
storage; it never enumerates query variants or loads the viewer's page lists.
Existing query-rooted recipes keep their original wire format and replay behavior.

Record-rooted recipes use the same atomic optimistic layer, rollback and
response-derived `upsertByField` settlement as query recipes. Fragments are never
sent as network revalidations. Callers should supply an explicit targeted query
for recovery when the parent/field is missing; the exchange can then enqueue
entity-only optimism and retain that recovery query for eventual commit/replay.

## Streaming text search

Text search streams each `(profile, bucket)` through
`search_documents_browse_idx`, and the adapter drops rows in which some query
token is not an ordered byte subsequence of `search_text` before decoding the
rest. A token whose characters occur in order also has its UTF-8 bytes in order,
so this keeps every row the core accepts. It replaces a SQL `LIKE '%a%b%c%'`
prefilter that Turso evaluated several times slower per token; contact search,
which must avoid decoding records, keeps its bound LIKE. Searching documents does not
read cached email buckets. Empty bucket selection still means every profile bucket.
The index includes `search_text` and `source_hash` after its existing browse keys,
so filtering and result reads use an index-only scan without table lookups.

The driver borrows each Turso row directly instead of collecting or copying it.
The adapter validates every row and reuses one canonical-key buffer; only winning
rows become owned documents. One Rust ranker retains at most `limit + 1` owned
documents across all requested buckets; there is no retained text-search catalog. Do not limit SQL matches before
ranking. Fuzzy/freshness scoring, DM priority and recency/key tie breaks remain
unchanged. Optimistic shadows suppress their durable counterparts before ranking,
including deleted and nonmatching replacements. Empty-query browsing retains its
indexed recent path and cursors. Leading-wildcard matching still scans the selected
buckets: this bounds application search memory, not search work or database page
cache memory. The existing SQL telemetry includes streamed processing and cleanup.
Storage schema 12 introduced this covering index. Browsers open a fresh
`s4.v4.t12` database; existing cleanup still keeps older files with pending
mutations, but the new engine does not replay those queues, and backfill
restarts against the new storage generation. Natively, the registered 11 to 12
step builds the index in place (see [storage upgrades](#storage-upgrades)), so a
schema-11 cache keeps its records and queued writes. That version kept the
GraphQL schema epoch and record format unchanged. Native binaries must be
rebuilt to gain the new index; an OTA frontend update alone cannot add it.

Schema 12 also includes `records_contacts_cover_idx`, a partial covering index
on `records(__typename, id, value)` for `GraphqlContact`, which the same step
builds. Ranked reads explicitly seek this index after the text prefilter instead
of also fetching the record table. They still decode one row at a time and apply
membership, exclusions, ranking and DM dedup before limiting. Exact schema
validation protects the predicate/collation; a pre-release local schema-12 shape
without it is incompatible, since it already records version 12 and no step
runs. No contacts store was introduced.

`cargo test -p cache-turso --test search` checks matching/ranking parity, including
Unicode, escapes, NUL, and late high-ranking matches. Run the ignored 100k-row
measurement with `cargo test -p cache-turso --test search -- --ignored --nocapture`.
The `web` test target exercises the same parity contract over real browser OPFS;
its ignored `search_100k_rows_over_opfs` measurement runs with
`-- --include-ignored --nocapture` under the browser runner.
The ignored native `compare_search_scan_options` test separately compares prepared
statement reuse, covering-index scans, and borrowed-row decoding against the same
100k rows (release build, alternating order, seven warm samples). Its disposable
fixture adds a legacy non-covering index for comparison with the production
covering index. Statement reuse has not shown a material benefit and is not
enabled in production. See [search performance](search-performance.md) for
measured costs and memory boundaries.

### Contact projection and page retention

Projection version 6 indexes viewer-scoped `GraphqlContact` names/emails (including
the visible local-part fallback) into
`person`, not public profiles. Search responses expose `projectionVersion` so
contact consumers can detect older native engines. The derived-index rebuild
preserves normalized data, mutations, and storage generation.

Hydration omits contact page and exact-lookup wrappers from the viewer while
retaining normalized contacts. Foreground contact variants share Soup's bounded
64-page / 2 MiB snapshot budget shared with Soup and database view pages. `cache-turso/tests/contacts.rs` and the OPFS
suite hydrate the real client operation, reopen, search, materialize bounded
fragments with target `userId` intact, and reset account identity. The background
runner now shares Soup's leadership and commits pages through `HydrationScope`:
expected/response identity and durable generation must still match under the
engine lock. Contact writes additionally capture a single-owner engine admission
fence before fetching. Accepted responses consume it even when values are identical;
old hydration cannot resurrect verified removals, and old absence evidence cannot
delete a newer positive observation. Unfenced network/optimistic contact writes reject.
The same backfill then verifies existing membership in bounded raw-key windows using
the existing exact lookup. Only successful requested-ID omissions permit deletion;
scan omissions do not. Checkpoint v2 (v3 while `enable-contact-lists` selects contact lists) tracks hydration/verification and completes
only after an exhaustive, non-malformed verification pass. Context-only stubs,
explicit selections and shared name labels do not establish membership. See the
[contacts plan](../../docs/design/disk-backed-contacts.md) for remaining acceptance.

### Context-aware person ranking

`cache-core::people` defines scoped local context updates and a separate person
search policy. Begin compares the previous epoch, patches cap at 500 and never
write public contact identity/name fields, and commit publishes readiness. Full
snapshot epochs expire omitted old facts without deleting membership records.
Search uses indexed exact-name (full or first name)/word-prefix/contains stages, with people the viewer has messaged first among word-start matches, over the existing
owned facts and a last stage for address terms (domain or local part), with recent-first ordering and canonical identity ties. Core applies
membership, secondary-inbox/explicit exclusions and DM deduplication before the
bounded result window. Generic title search keeps its separate scoring path.
This uses schema 12 without adding a database or physical table; native/browser
hosts now expose state/update/search through dedicated commands. Rust-derived
transport schemas are checked in `src/people/schema.json` and regenerated from
`apps/web` with `bun run gen-cache-people-schema --rust`. The frontend now publishes
channel/inbox context under Soup's leader in bounded snapshot/delta batches;
Quick Access and all migrated personal pickers now preserve policy-7 windows (policies 5 and 6
from native desktop, iOS and Android binaries released before it)
instead of applying the old fuzzy/brevity scores. Empty property browsing pins self;
recipient mode excludes automated addresses unless explicitly addressed. Interactive
reads stay local, including partial hydration; unsupported hosts remain unavailable.
Refresh requests the existing sync lane. Continuations bind scope/policy/layout,
epoch and live contact/context tokens. Same-epoch patches invalidate them; unrelated
cache writes do not. Prior DM aliases use bounded target lookups without a history
catalog; a short/empty page may still continue. Frontend contact invalidations also
fence pending replies and restart paging.

`CacheHost.people.resolveReferences` exposes a separate read for inferred labels.
It scans the existing contact projection while retaining at most two distinct
witnesses per label (500 raw labels, 512 UTF-8 bytes each), preserving exact-name
and first-name ambiguity. The bound viewer and generation are checked without
binding an unowned cache; foreign-viewer keys are ignored before private-name
matching. Inbox exclusions additionally require ready context. Callers still
check hydration completeness before assuming uniqueness; cached absence is not
an authoritative server omission. Coordinator protocol 17 and a dedicated native
command carry the generated contract. Missing reference support is independently
unsupported, and captured reads become unsupported after host retirement.

`CacheHost.people.readSql` exposes parameterized local SQL over a disposable profile
in the existing predicate index. Only viewer-scoped normalized contacts supply facts;
public profiles and context stubs do not. Counts, grouping, DISTINCT and ordering
run in Turso before the 500-row/64-column/512-KiB result window is materialized.
The host checks account/generation under its engine lock. Callers still require a
complete backfill checkpoint; unsupported/incomplete reads never fetch a directory
or execute SQL on a server. Browser queries now use this capability directly;
ordinary joins request only bounded identity keys. Completion notifications and
cache changes refresh visible queries, with one physical read and one replaceable
pending input per observer.

The owned people fact layout now also supplies the approved name-first search
foundation: bounded name-word postings, explicit overflow, stable recent-first
keys and sparse epoch-scoped context overrides. Derived layout version 2 rebuilds
older facts in bounded batches without resetting records, queues or generation.
Fact deltas preserve name postings during activity updates, and rank facts during
name edits. `search_people` executes the indexed reader under the same scope
admission, using core's name/recency collector and one storage snapshot. Native/OPFS
tests compare it with a complete streaming reference, including continuations and
reset fencing. Suggestion policy is 5; reference inference keeps its independent
policy-4 floor and exact/first-name evidence. No server suggestion fallback remains.

## Browser OPFS writes

The OPFS adapter coalesces each Turso vectored write into batches of at most
1 MiB instead of making one synchronous browser call per WAL frame. Scratch
space is bounded to the same size. Batching never spans separate I/O operations
or delays completion/flushes; offset preflight, partial-write retries, and
first-error propagation retain their existing semantics.

## Projection refreshes

Calendar range projections retain imported timed points with equal start and end.
Points belong to a viewport when its start is at or before the point and its end
is after it; empty viewports still return no occurrences. Projection version 2
rebuilds derived calendar rows once on open, preserving normalized records,
coverage, watermarks, and queued mutations. All-day spans remain positive.

Hydration folds authoritative index mutations in order and writes only final
states that differ from stored state. An updated normalized record does not force
unchanged index facts to be deleted and reinserted. Pending optimistic projections
are still rebased for every affected key, even when authority is unchanged.

Quick Access browse timestamps prefer `viewedAt`, then `updatedAt`, for Soup
documents, chats, projects, channels, and CRM companies. This matches their
frontend and server ordering before pagination. A versioned derived-search
projection rebuild upgrades existing indexes once on open, preserving normalized
records, storage generation, and queued mutations. Routine opens with the current
projection version do not scan the corpus.

## Local filter execution

Single-partition queries first probe at most `max(64, 2 * limit)` sort-index
candidates from each of the authoritative and optimistic tables. Predicates,
scope, and shadow suppression are evaluated only for that bounded window. A
result is accepted only when both windows are exhausted or extend strictly past
the result's cutoff timestamp, proving that record-key ties are complete. Keyset
cursors seek inclusively to their timestamp; the full predicate handles ties.
Sparse matches, truncated ties, and multi-partition queries use the original
set-based plan in the same read transaction. No schema change or migration is
required. This keeps dense Mail pages independent of mailbox size without
changing results or optimistic visibility.

The fallback SQL materializes Boolean result sets once, but enumerates a universe only
within the requested profile and partition. Empty predicates do not enumerate
cached documents. Conjunctions with an indexable positive term filter one scoped
candidate set using document-leading fact probes, rather than materializing every
residual posting list. Other negated conjunctions use set difference instead of
first building a full complement. Optimistic facts also use document-leading
primary-key probes rather than repeatedly scanning the materialized shadow set.
These execution choices keep the same predicate, ordering, missing-fact, and
shadow-suppression semantics.

## Tests

Run from the repository root:

```sh
cargo test -p cache-core -p cache-turso -p turso-opfs
cargo check --target wasm32-unknown-unknown -p cache-turso -p turso-opfs -p cache-wasm --all-targets
wasm-pack test --headless --chrome crates/client/cache-turso
wasm-pack test --headless --chrome crates/client/turso-opfs
```

NixOS note: wasm-pack downloads a dynamically-linked chromedriver that won't
run. Work around by resolving the cached runner whose reported version matches
the workspace's `wasm-bindgen`, then invoke it with a Nix chromedriver:

```sh
wasm_bindgen_version=$(
  cargo tree -p cache-turso --target wasm32-unknown-unknown -i wasm-bindgen --prefix none |
    sed -n 's/^wasm-bindgen v//p' |
    head -n 1
)
runner=
for candidate in "$(command -v wasm-bindgen-test-runner || true)" \
  "$HOME"/.cache/.wasm-pack/wasm-bindgen-*/wasm-bindgen-test-runner; do
  [ -x "$candidate" ] || continue
  [ "$("$candidate" --version)" = "wasm-bindgen-test-runner $wasm_bindgen_version" ] || continue
  runner=$candidate
  break
done
test -x "$runner" || {
  echo "no wasm-bindgen-test-runner matching $wasm_bindgen_version" >&2
  exit 1
}

chromedriver=$(command -v chromedriver || true)
if [ -z "$chromedriver" ]; then
  for candidate in /nix/store/*chromedriver*/bin/chromedriver \
    /nix/store/*chromedriver*/bin/undetected-chromedriver; do
    [ -x "$candidate" ] || continue
    chromedriver=$candidate
    break
  done
fi
test -x "$chromedriver" || {
  echo 'no Nix chromedriver found' >&2
  exit 1
}

CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUNNER="$runner" \
CHROMEDRIVER="$chromedriver" \
WASM_BINDGEN_TEST_ONLY_WEB=1 cargo test --target wasm32-unknown-unknown -p cache-turso

CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUNNER="$runner" \
CHROMEDRIVER="$chromedriver" \
WASM_BINDGEN_TEST_ONLY_WEB=1 cargo test --target wasm32-unknown-unknown -p turso-opfs --lib
```

## Slow SQL telemetry

The browser WASM driver reports each SQL statement execution **over 200 ms** as
`graphql_cache.slow_query` through the existing page telemetry relay and OTLP
pipeline to Datadog. These events bypass cache sampling/aggregation. Exporting
still requires the existing browser telemetry enablement and exporter config.

Search Datadog logs for `service:web-app "graphql_cache.slow_query"`:

- `cache.duration_ms`: binding, stepping/OPFS I/O, row collection, and cleanup;
  excludes statement preparation and time queued in the worker.
- `db.query.fingerprint`: 16-digit lowercase FNV-1a hash of the exact unexpanded
  SQL template, allowing repeated executions to be grouped without exporting SQL.
- `cache.outcome`: `success` or `error`; slow failures are reported too.
- `cache.slow_query_threshold_ms`: `200`.

Parameters, results, raw SQL, and user identity are not exported. Logging uses
an anonymous span context. A throwing JS telemetry callback cannot change query
results. Native hosts are unchanged unless they install their own telemetry sink.

## Idle WAL checkpoint

Turso copies the WAL into the database file inside the COMMIT that takes it to
1,000 frames, so one write pays for the others. After a request that can
write, the browser engine worker calls `checkpointIfDue` once nothing has run
for 100 ms, and cache-turso copies from 500 frames there instead. Each request
that runs re-arms the wait, so the reads a page sends after an open or a
write run first. A request that arrives during a copy waits for it, as it
waited for the write that used to carry it; a drain cancels a copy not yet
started and waits for one under way.

A copy that ran is reported as `graphql_cache.wal_checkpoint` with
`cache.duration_ms`, `cache.count` (frames copied) and `cache.wal_frames` (frames
in the WAL when it ran; a count below it is a partial copy). A failed copy is
reported with its error class and retried once the next request has run; it
leaves the WAL whole and resets the cache only when the error means corruption.

## Slow request telemetry

The engine worker reports each request that answers **1 s or more** after it
arrived as `graphql_cache.slow_request`, unsampled. A page gives up on a
request after 10 s; these spans say what held the engine meanwhile. Search
Datadog spans for `service:web-app resource_name:graphql_cache.slow_request`:

- `cache.request_kind`: the protocol request kind (`read`, `hydrate`, `init`...).
- `cache.queue_wait_ms`: time queued in the engine worker before it ran.
- `cache.duration_ms`: time it ran, from start to its answer.
- `cache.queue_depth`: requests still queued when it started.
- `cache.outcome`, `cache.error_code`: `success`/`none`, or the error class.

A stall shows as one request with a long `duration_ms` and the requests behind
it with long `queue_wait_ms`.

Only requests that reach the engine worker's queue are covered. Two waits are
not in `queue_wait_ms`:

- A message that arrives while the engine is inside a wasm call is stamped only
  when that call returns; the wait shows in the running request's
  `duration_ms`.
- Time the coordinator holds a request before any engine has it (owner
  handoff, a parked or draining engine) is not reported here.

## Key policy

**Presence-of-id convention**: an output object type with an `id: ID!`
field is a normalized entity keyed by `__typename:id`; a type without `id`
is embedded inline in its parent record. The schema itself is the policy —
there is no client-side key config. The build fails on malformed shapes
(nullable/non-ID `id`, `id` on the query root). Consequence for schema
authors: **only expose a field named `id` when it is the object's global
identity** (e.g. `GraphqlProperty` exposes `propertyDefinitionId`
because a property instance's value is per-entity).

Identity is not the cache's concern: the engine accepts an opaque session
tag on writes (extracted by the urql exchange from `data.user.id`) and
wipes + rebinds atomically when the tag changes (silent restart).

Optimistic GraphQL mutations are persisted with their replay request before
becoming visible. The exchange claims and applies them strictly in enqueue
order; a configurable callback decides whether an error remains queued or
permanently rolls back. The exchange caps retryable server failures at ten per
mutation, excluding transport failures/timeouts. This separate budget is stored
in the existing Turso `meta` table under `mutation-server-failures:<id>` and
updated atomically with fenced deferral; absent metadata starts at zero for
existing queued writes. Commit, rollback, replacement, and clear remove it.
The storage schema/database identity and the all-attempt backoff counter stay
unchanged. Failed mutations are not retained in a DLQ.
