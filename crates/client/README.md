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

Foreground Soup snapshots share a per-viewer budget of 64 pages and 512 KiB
(encoded fields plus retention metadata). Most recently written pages win; reads
do not persist recency or cause a COMMIT. Individually oversized snapshots are
not retained. Evicted snapshots miss and require a network refetch; their entity
records and pending offline mutations remain available.

On the first compatible Turso open after this upgrade, a metadata-versioned
transaction compacts only `GraphqlUser` records via the type/id index. It prefers
initial pages when legacy data has no recency ordering. It preserves the storage
generation, normalized entities, projection facts, queue and optimistic shadows.
Subsequent opens only check the marker. There is no schema/namespace bump, reset,
or VACUUM; freed pages can be reused without rewriting the whole database file.

## Query-write invalidation

Ordinary query responses carry optional `searchChangedBuckets`, using the same
composed-view comparison as hydration. An empty list proves that Quick Access
needs no refresh; missing metadata, mutations, subscriptions and identity resets
remain conservative. Both browser-worker and native hosts preserve this distinction.

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

The lower-level Solid `createPredicateQuery` binding owns subscription, coalescing,
cleanup and engine-generation recovery, preserving keyed row stores and applying
patches in one batch. Its first source adapter is a reconciled flat Soup filter:

```ts
const items = createPredicateQuery({
  host: getGraphqlSoupCacheHost,
  query: () => ({
    source: { filters: filters(), sortMethod: 'UPDATED_AT',
      sortDirection: 'DESC', limit: 50, baseline: serverMembership() },
    select: selectRecords(SoupItemFieldsFragmentDoc),
  }),
});
```

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

This uses the existing urql query contract, with cache-core tracking selected
fields and returning response-path patches. Existing `createUrqlQuery` and
`createUrqlInfiniteQuery` consumers benefit from the same path automatically.
Aliases, fragment types, arguments, variable defaults and conditional selections
are resolved by the core reader. Structural edits rebuild the projection;
teardown, account resets and bounded retention discard obsolete bindings. See
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

## Text search catalogs

Text search loads compact rows lazily per `(profile, bucket)` through the existing
`search_documents_browse_idx`. Searching documents does not load cached emails;
changing categories loads only newly requested buckets, including caching empty
buckets. Empty bucket selection still means every bucket in the profile.

Ranking borrows catalog and optimistic entries, normalizes the query once, and
retains at most `limit + 1` references in a heap. Only the final returned rows are
cloned. Fuzzy/freshness scoring, DM priority, recency/key tie breaks and browse
cursors are unchanged. Write-through updates remove old bucket membership before
updating already-loaded buckets; unopened buckets stay lazy. Optimistic shadows
replace durable hits without mutating the catalogs, so rollback restores them.
No storage schema, projection version, or database migration changes are needed.

## Browser OPFS writes

The OPFS adapter coalesces each Turso vectored write into batches of at most
1 MiB instead of making one synchronous browser call per WAL frame. Scratch
space is bounded to the same size. Batching never spans separate I/O operations
or delays completion/flushes; offset preflight, partial-write retries, and
first-error propagation retain their existing semantics.

## Projection refreshes

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
permanently rolls back.
