# graphql-cache

Normalized GraphQL cache with disk-backed persistence for urql. Design doc:
[`apps/web/docs/graphql-normalized-cache-plan.md`](../../apps/web/docs/graphql-normalized-cache-plan.md).

## Crates

| Crate | Purpose |
|---|---|
| `cache-core` | Pure engine: normalize/denormalize, LRU hot tier, dependency index, durable ordered optimistic-mutation queue, async `Storage` trait |
| `cache-turso` | `Storage` over Turso core — browser WASM and Tauri native hosts |
| `turso-opfs` | Browser OPFS `IO`/`File` adapter for the dedicated Turso engine worker |
| `cache-wasm` | wasm-bindgen shell combining the engine, Turso storage, and OPFS adapter for browser worker glue (`apps/web/src/lib/graphql-cache/`) |

The Tauri host lives in the tauri workspace (it needs the patched tauri fork
pinned there): `apps/web/tauri/graphql_cache_plugin`, path-depending on
`cache-core`/`cache-turso`. Test it from `apps/web/tauri` with
`cargo test -p graphql_cache_plugin` (on NixOS use the `tauri-linux` dev shell —
Tauri's Linux desktop stack needs its WebKitGTK/DBus system libraries).

## Runtime GraphQL schema

Desktop and mobile keep the cache engine and Turso storage in the native binary.
The frontend bundle supplies the original `static_assets/schema.graphql` SDL as
text. Native startup and browser workers pass it to the same Rust
`Schema::from_sdl` parser, which validates it with `apollo-compiler` and derives
the cache's internal lookup tables. There is no TypeScript schema generator or
intermediate JSON asset. Browser workers configure SDL through
`configureCacheSchema` before opening storage.

Native startup calls `graphql_cache_init_with_schema`. This requires one native
release; set the OTA bundle's `MIN_NATIVE_BUILD` to the first build containing that
command. Older native binaries cannot accept runtime SDL. The frontend does
not fall back to the old initialization command; it runs uncached and asks for
an app update instead.

An engine owns a validated schema snapshot; there is no mutable global schema.
Compatible additions are merged under the native engine lock, including when an
OTA reload leaves the process alive. Validated fragment caches include schema
identity in their keys. Native `graphql-cache/schema.json` retains the compatible
superset across restarts and rollbacks, so older windows and pending mutations can
still reference earlier definitions. Schema installation neither resets records
nor discards queued mutations or changes the durable storage generation.

Persisted metadata format/compatibility epochs must be supported by the installed engine.
Conflicting field shapes, root types, or entity identities are rejected before
publishing metadata or opening storage. These changes need an explicit migration;
a native rebuild alone does not migrate the persisted metadata. Removed definitions
are deliberately retained. Schema-driven normalization can accept new types, but
handwritten search/filter projections and new IPC commands still need native code.

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
(`MIGRATABLE_CACHE_FORMAT_VERSIONS`). A file at an older storage schema version
is first upgraded when a chain of steps from its version is registered (Storage
upgrades, below), and resets otherwise. Opening a migratable format drops records, search
projections, index facts, and calendar ranges — all refetchable — and keeps
queued mutations, optimistic layers, and their projections, then rewrites the
namespace in the same transaction. An interrupted migration therefore retries on
the next open. Native owners then try to `VACUUM INTO` a fresh file and swap it in, so an
upgrade usually releases the space the dropped records occupied instead of
leaving free pages in the old file; if that fails, the migrated file stays. The browser's physical database name embeds the format
version, and a carry-forward (below) looks only at older storage versions of the
current format, so a format change starts a new browser file instead of migrating;
the previous file is left for any tab still running the older bundle.

## Storage upgrades

A database written at an older `STORAGE_SCHEMA_VERSION` is upgraded in place
when `cache-turso/src/storage/migration.rs` registers a chain of steps from its
version to the current one. Each step runs in one write transaction that also
advances `meta.storage_schema_version`, so a stopped upgrade resumes from the
last committed step. The last step's transaction also runs the frozen-schema
checks every reopen runs, so the current version is committed only for a file
with exactly the tables and indexes a fresh file has; a chain that would produce
anything else rolls back to the version before its last step. The open then
runs the queue checks as every reopen does. Records, queued mutations,
optimistic layers and the storage generation stay, so the upgrade refetches
nothing and loses no queued write; a format migration that runs after it (above)
still drops the refetchable rows. A file whose `meta` names another scope, or a cache
format this build cannot carry forward, is rejected before any step runs, so no step
commits to it: native resets it as before, and in the browser moved files stay at
the version they moved at, which a failed first open decides as below. A version with no chain, a newer version, or
a failing step resets as before. Bumping the version without registering a step
fails to compile; clearing `STEPS` declares that every older file resets.

Native hosts upgrade the fixed file at open. Browser database names embed the
storage version, so the browser first carries the old database forward: when
this build's database does not exist yet, the open takes the newest upgradable
older name's owner lock if it is free (`OpfsOwner::lock_previous`), moves its
main and WAL to this build's name (`OpfsOwner::adopt`), and opens them, which
runs the steps. It holds that lock until the first open ends, so no tab of the
older build can open, reset or recreate its name meanwhile. A tab of the older
build already holding the lock, a whole pair with a marker of its own beside it
(an adoption into that name whose first open has not succeeded, below, or whose
marker could not be removed after it did; its build decides those files first,
and its next open removes such a marker: `older-in-use`), a browser without
OPFS moves, a pair whose headers Turso would not open, or a failed move leaves
the old file where it is and starts empty, as every version change did before
(a WAL move whose undo fails too leaves a split, below).
A marker beside no whole pair is an adoption into that name stopped before its
moves finished, or a wipe of it stopped after removing its pair, and the open
looks further back: any whole pair such an adoption named is still at its own
name, and a split (its main file moved in, its WAL still further back) leaves no
whole pair anywhere, so nothing moves and that build completes it. So moved files come
from a name whose files are at its own version, which a hand-back compares
against: a wipe removes a pair before its marker, and a hand-back first removes
a marker that an adoption into the older name left beside no main file. Only a
later storage bump can meet any of these markers. The open result reports
`upgraded-existing` with `fromStorageVersion`, and `carryForward` says what
happened to the older database; `graphql_cache.schema_init` records both. The
coordinator protocol carries an upgrade as `opened-existing`, since storage
survived.

A marker beside this build's files (`<name>-adopting`) names the older database,
with the size and header of its WAL, from just before the first move until the
moved files first open. A worker stopped in between leaves it behind, and the
next open acts on it before anything else. An ordinary open completes a move
stopped between its two renames, but brings the WAL over only while it is still
the one the marker recorded, and a WAL with frames only under the older name's
lock, then opens the files (`resumed`); without that lock the open fails and
keeps both halves. If the open of moved files would reset them, and they still
say they are at the version they were moved at, nothing this build wrote is in
them: they go back to the older name whole (`returned`) and this build starts
empty, so their queued writes stay with the build that wrote them. When the
failed open cannot read their version, it fails and keeps them. A recovery
open, which the coordinator asks for after an open fails or a worker is lost
mid-open, decides before wiping its own files: it counts an attempt, takes the
older name's lock, opens the files only to read their version, and hands them
back if it is still the moved one; the marker goes only once it has acted.
While it cannot decide (the lock is busy, the marker or the version does not
read, the files do not connect, or their WAL still holds frames) it fails and
keeps everything, and the coordinator retries it. After three such attempts
the next recovery discards the files unopened, so files that never open cannot
keep the cache from starting. Attempts are counted in a file of their own
beside the marker (`<name>-adopting-attempts`), written with eight free slots
before any file moves, so counting overwrites one byte in place, needs no more
storage, and works while the marker does not read; a count that is not exactly
its eight slots counts nothing, nor does one left without its marker, so a
count goes with its marker only as cleanup, never waited on. The marker
itself, which also records when the
adoption began, is never written again. An attempt that cannot be counted
decides as any other, and only where it would keep the files does it look at
that time: ten minutes after the adoption began it discards them instead, so
those are bounded too, though a later attempt might still have sent them back.
The browser's clock measures that time in either direction: a jump forward
brings it early, and a jump back postpones it by the size of the jump, unless it
lands ten minutes or more before the adoption began, which ends the wait at
once. An attempt that
could not read the adoption and cannot count reads it again before it looks at
the time, and decides as above if it now reads, so a read that fails once is decided as
any uncounted attempt is, never discarded for not reading. When it still does not read but the marker
does (the files beside it cannot be looked up), the time comes from the marker.
When neither the marker nor the count reads, nothing bounds the attempt or says
how old the adoption is, so it keeps everything. A version probe that fails
loses its hold on the files before any of them changes, so it cannot discard
them and only the count bounds it; uncounted, it keeps everything too. A read
that returns fewer bytes than the file holds is an error, never a shorter
marker or WAL header.

An open that keeps moved files says so (`cacheRecoveryDeferred` on its error,
`movedFilesKept` beside its failure code to the coordinator), whether it is the
ordinary open that found them unusable or a recovery that could not decide,
and whatever else failed with it. The coordinator
retries a failed recovery five times at once, so with counting this usually
resolves within one page load; a version probe that counts and then exits
`storage-busy` ends that page load's retries, and the count goes on in the next. Until an open succeeds, it never gives up a scope where
an open kept moved files, whatever ended the retries: a recovery that kept
them again, or failures that never reached storage, such as assets that did
not load. An open that reached storage and ended without a report counts the
same until a later open that reaches storage reports a failure other than
`storage-busy`, or one succeeds: the database watchdog, a fatal error, a
rejected readiness proof, or a lost tab or worker says nothing of what it kept.
Giving up
would quarantine the scope and open a different database on the next load,
leaving the moved files and their queue behind. Instead the
coordinator keeps the scope and the open it had pending (a recovery wipe, or
an ordinary open a navigation departure ended; both read an unfinished
adoption first), refuses queued requests
with `owner-lock-unavailable`, and the page runs uncached until its cache
recovery (backoff doubling to 30 seconds with 20% jitter, so at most 36
seconds, and on reconnect or return to the tab) registers again. After that
first deferral each registration runs one recovery, not five, so a page waits
for one open before it runs uncached again; the attempts go on counting. A
busy exit (below) does not defer by itself, so the registration after one runs
all five unless an earlier one deferred since the last accepted readiness.
Requests sent meanwhile wait for that open as they wait for any activation:
the 10-second request timeout starts only after it, so the startup budgets
bound the wait (five minutes for the assets, then the lock and the 20-second
database open). Readiness the coordinator accepts ends this, even when the
owner drains at once because its tab is hidden: the retries and the deferral
start over there. A version probe that meets a busy sync handle fails as
`storage-busy`, which stops the coordinator's retries the same way; it still
carries `movedFilesKept`, so the scope stays after it too. Two paths older
than upgrades still lose the deferral. A transport failure of the cache worker
itself never reaches the coordinator, and the host quarantines the scope as it
does for any queue, which leaves the moved files behind with it. A coordinator
that restarts forgets the deferral, and any open that ended without a report:
its next ordinary open finds the marker
and defers again, failures that never reach storage keep the scope because
storage was untouched, and only the one-recovery rule is lost until that
open. Files at a newer version
were upgraded here, so the older build could not open them, and files whose
older name holds a database again cannot go back over it; both are reset
(`discarded`). Once the moved files have opened they are this build's own.

Before upgrades a newer build never touched an older file, so its queued writes
waited there until that build ran again. Each of these narrow windows can now
lose them instead, and each needs a worker lost or an open failing mid-upgrade:

- the worker is lost between the two renames, the older WAL still held frames
  (its build was itself lost without closing), and before this build opens
  again a tab of the older build opens its name, or stale cleanup in a tab of
  this or a newer build finds the lone older WAL: either removes the half it
  finds, the WAL no longer matches the marker, and the main file is discarded.
  Whatever the older WAL held, even nothing, stale cleanup in a tab of a build
  whose name is newer in any part (schema epoch, record format or storage
  version) removes the moved main file itself, with the queue it holds, as it
  removes any half pair under an older name: keeping it for a marker only this
  build resolves would leave it on disk for good once this build no longer
  runs. A WAL move that fails, and whose move of the main file back fails too,
  leaves the same split;
- the worker is lost during the first open, before any step committed, and a
  tab of the older build opens its now empty name before the recovery open: the
  files cannot go back over its new ones and are discarded. That tab may
  instead lose its own worker before its open creates any file (after its
  storage grant, which its coordinator answers with a wipe before the next
  open; on a later storage bump also while moving an even older pair into its
  name, before the move): a hand-back that lands before that tab's next open
  puts the files back, and that open wipes them. Landing after it, the
  hand-back finds a database there and discards them, and refusing it would
  discard them the same way, so no order keeps them once that wipe is
  pending; returning still keeps them whenever the older build's next open is
  an ordinary one;
- the first open commits the upgrade and then fails (its queue checks or a
  projection rebuild), or is lost, before it is ready: the file is already the
  newer version, so it is discarded. An open slower than the coordinator's
  database watchdog (20 seconds) counts as lost; the largest caches can reach
  that on their first open;
- three recovery opens cannot decide where the moved files go, for any reason
  above: OPFS or connect failures, a marker or version that does not read, a
  WAL that still holds frames, the older name's lock held by a tab of the older
  build through all three, or recoveries lost after counting their attempt. The
  next one discards the files unread, though the older build might still have
  opened them. Recoveries whose attempts cannot be counted do the same once ten
  minutes passed since the adoption began by the browser's clock, so a clock
  jump either way can bring that early, and then one count write that fails
  while a tab of the older build briefly holds its lock is enough. An uncounted
  recovery whose two reads of the adoption both fail takes the time from the
  marker alone, so two passing read failures after ten minutes discard files
  that could have gone back;
- the first carry-forward into storage 12 only: a tab of a build from before
  upgrades that is already at storage 12 shares this build's name but knows
  nothing of markers. If it opens that name after the adopting worker was lost
  or let it go, while a move is split or the moved files are still at 11, it
  resets them as any half pair or older file. Builds that use the name of any
  later storage version all know the marker.

Already true before upgrades, and unchanged: a worker lost after its open was
ready but before the coordinator saw it wipes the file on the recovery open; an
older tab holding its lock, or this build's file already existing, when the
newer build first opens leaves the older file where it is, its queue sent only
if that build runs again; and repeated OPFS failures end in a recovery wipe.

Returning to the older build after a move finds its own name empty and starts
fresh; its queued writes went forward with the file and are sent by the newer
build. Natively, an older build opening a file a newer build upgraded resets
it, as any newer file did before. The next newer open finds its own file and
moves nothing again. A recovery open never carries anything forward.

Only storage versions migrate this way. A record format change keeps its own
path above, and a GraphQL schema epoch change still starts a new file.

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

Text search binds normalized subsequence patterns to Turso queries scoped by
`(profile, bucket)` through `search_documents_browse_idx`. Every query token must
match: `abc` becomes `%a%b%c%`, with literal SQL wildcards and escapes quoted in
the bound value. Rows containing NUL pass the SQL prefilter because SQLite LIKE
stops at NUL; Rust verifies them without truncation. Searching documents does not
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
Storage schema 12 introduced this covering index. It shipped as a reset: native
`open_or_reset` replaced a schema-11 cache, including its queued mutations, and
browsers opened a fresh `s4.v4.t12` database. The registered 11 to 12 step now
builds it in place instead (see [storage upgrades](#storage-upgrades)), so a
schema-11 cache still on disk upgrades keeping its records and queue. That
version kept the GraphQL schema epoch and record format unchanged. Native
binaries must be rebuilt to gain the new index; an OTA frontend update alone
cannot add it.

Schema 12 also includes `records_contacts_cover_idx`, a partial covering index
on `records(__typename, id, value)` for `GraphqlContact`, which the same step
builds. Ranked reads explicitly seek this index after the text prefilter instead
of also fetching the record table. They still decode one row at a time and apply
membership, exclusions, ranking and DM dedup before limiting. Exact schema
validation protects the predicate/collation; a pre-release local schema-12 shape
without it is incompatible, since it already records version 12 and no step runs.
No contacts store was introduced.

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
