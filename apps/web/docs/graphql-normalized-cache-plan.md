# GraphQL Normalized Cache — Design & Plan

Status: **draft / pre-implementation**

Implementation note: document-based live projections are implemented on the
local-resolvers branch; see [Live query API](#8-live-query-api). Earlier sections
describe the original cache design.
See [Testing optimistic live queries](graphql-cache-testing.md) for generated
state-machine coverage, replay commands, and remaining confidence boundaries.

## 1. Problem

We are migrating data fetching from REST to GraphQL (urql). We need normalized
caching with graphcache-like semantics, but graphcache hydrates and keeps the
entire cache in browser memory. With 10s of thousands of cached objects
(documents, email threads, channels, properties, …) that is not acceptable.

## 2. Requirements

### Hard requirements

1. **Normalized caching** — entities keyed by `__typename:id`, stored once,
   shared across queries; queries stored as link graphs over entity records
   (graphcache/Apollo-style).
2. **Bounded memory** — hot tier in memory (LRU, size-budgeted); everything
   else on disk. WASM linear memory is still browser memory, so the disk tier
   is the actual fix — Rust gives us a compact record format, deterministic
   eviction, and a portable engine.
3. **Persistence & offline** — cache survives restarts; previously-seen
   queries must be answerable fully offline. This means we persist not just
   entity records but also *operation root links* (query + variables →
   root selection links), plus staleness metadata.
4. **Both Tauri and web** — same core engine; Tauri **always** uses the
   native host (never OPFS/SharedWorker/webview storage), browser uses WASM
   in a worker.
5. **Shared cache across consumers** — multiple Tauri webviews and multiple
   browser tabs must observe one cache (single writer, shared invalidation).
6. **urql integration** — a custom exchange replacing `cacheExchange`.
   Components will eventually move to reactive urql queries, so the exchange
   must support the full operation lifecycle: active-operation registry,
   dependency-triggered re-execution, `cache-first` / `cache-and-network` /
   `network-only` policies, stale-flagged emissions.

### Derived / secondary requirements

7. **Async reads** — a disk-backed cache cannot offer graphcache's
   synchronous `readQuery`. urql's exchange model (wonka streams) tolerates
   async reads fine; imperative consumers get a Promise-based API.
8. **Schema awareness** — `GraphqlSoupEntity` is a 9-implementor interface;
   the cache needs possible-types metadata and per-type key config (e.g.
   `GraphqlSoupChannelMessage.id`, embedded non-keyable types like
   `GraphqlPropertyValue`). Schema lives in-repo
   (`static_assets/schema.graphql`) → embed metadata at build time, no
   runtime introspection. Lightweight channel-message previews are embedded
   under `GraphqlSoupChannelMessagePreview` without an `id` field; only rich
   thread rows use the normalized `GraphqlSoupChannelMessage` identity.
9. **External write API** — no GraphQL subscriptions exist; updates arrive
   via websocket-service. Expose `writeFragment` / `invalidate(entityKey)` so
   websocket handlers can patch records and trigger re-execution.
10. **Eviction & GC** — active operations pin their dependencies; memory tier
    is LRU with a byte budget; disk tier has a byte budget with orphan sweep
    (records unreachable from any persisted operation root).
11. **Cache identity & lifecycle** — namespace by `scope +
    schemaCompatibilityEpoch + cacheFormatVersion`, where **scope is an
    anonymous client-generated uuid** (localStorage), *not* user identity:
    construction is synchronous
    and offline-capable (no identity waterfall), and no PII appears in
    enumerable storage metadata (OPFS or native database filenames).
    User↔cache consistency is enforced by **identity witnessing**, split
    into two halves: *extraction* lives in the urql exchange
    (`extractIdentity: (data) => data.user.id` — the schema exposes
    `QueryRoot → user: GraphqlUser!`, viewer pattern), and *enforcement*
    lives in the engine as a schema-agnostic mechanism — writes carry an
    opaque session tag compared against the binding stored in the same
    database (`__meta:identity`), so compare-and-wipe is atomic with the
    triggering write (no stale-in-flight-write races). A mismatch wipes and
    rebinds (“silent restart”) and all active operations re-execute. Eager
    path: clear on logout. REST contact-edit responses use a separate captured
    write-session token: logout closes admission and drains admitted durable
    write/delete operations before clearing registered hosts. Independent local
    auth cleanup and server sign-out begin without waiting for this drain; reload
    and replacement admission still wait for all cleanup. Tracked contact writes
    retain their exact physical host even if auth propagation retires the public
    wrapper, whose callbacks and subsequent operations are silenced immediately.
    Successful login
    also retires this token, drains writes and deletes only the contact records
    written by that session before refetching. This preserves unrelated durable
    queues during same-account reauthentication, while handling native account
    replacement that keeps the same client and host objects. A readiness probe
    precedes tracking so failed initialization cannot strand a never-written key.
    Logical retirement keeps narrow cleanup usable through the retained owner.
    Typed recoverable bootstrap/owner failures may reconstruct a cleanup-only host
    from the original backend/scope factory without booting a user client or queue;
    unknown or quarantined failures cannot use this path. Failed repair retains
    keys/ownership, reports the failure, and leaves admission closed for retry.
    A no-op delete is not proof of storage cleanup, and a never-settling durable
    write cannot be bypassed by a timeout. Login waits for all logout wipes and teardown, not just
    normalized-cache clearing. A post-write identity check cannot
    undo a native mutation already dispatched.
    Additive GraphQL schema changes retain existing normalized records;
    fragment reads can continue projecting fields already present. Manually
    bump the schema compatibility epoch when identity, field storage shape, or
    other schema-derived cache semantics become incompatible. Discard records
    on compatibility-epoch/format mismatch (cache is disposable, rebuild from
    network).

    **Key policy — presence-of-id convention**: no client-side key config.
    An output object type with `id: ID!` is keyed by `__typename:id`; no
    `id` field → embedded. The SDL is the policy (schema authors must only
    name a field `id` when it is a global identity — hence
    `GraphqlProperty.propertyDefinitionId` and
    `GraphqlSoupChannelMessage.id`); the build fails on malformed shapes.
    Soup pages return entities directly: `frecencyScore` is a per-entity
    fact shared by every view through the normalized record, and the only
    per-view state is list membership and order, which live in each page's
    own `items` list. Optimistic membership moves patch those reference
    lists, while entity-field mutations update the shared records.

    The normalized entity contract lives on `GraphqlSoupEntity`, not only on
    its concrete implementations: `id`, `entityType`, `displayName`,
    `metadata`, `properties`, `notifications`, `isFavorited`, and
    `viewerPermission`. Queries can select shared relationships once at the
    interface level. Content remains concrete/domain-specific because its
    GraphQL shape and loading policy differ by entity type.
12. **Native-testable core** — the Rust engine is a pure crate (`cargo test`,
    no wasm) with storage/clock behind traits.
13. **Durable optimistic mutations** — optimistic GraphQL mutations are
    persisted with their replay request, restored across restarts, and applied
    strictly in enqueue order. Retryability is decided by an exchange callback;
    retryable failures retain their optimistic layer. Ten retryable server
    failures (GraphQL errors or HTTP 5xx responses) permanently fail the mutation
    through ordinary rollback so the next queued mutation can run. Transport
    failures/timeouts do not consume or reset that budget. The separate server
    failure counter survives reloads and tab handoff in pending-mutation metadata;
    `attempt_count` still counts every claim for backoff and coalescing safety.
    Settlement removes the pending mutation and counter; there is no retained DLQ.
    Each queued network attempt has a one-minute timeout, comfortably inside its
    five-minute lease.

### Open questions

- Encryption-at-rest for cached content (email bodies/snippets will flow
  through this). Browser OPFS and native Turso files are origin-/app-scoped
  but plaintext on disk.
- Disk budget (proposal: 256 MB default, configurable).
- Memory hot-tier budget (proposal: 32 MB default).

## 3. Current state (as of writing)

- urql usage is imperative-only: `@urql/core` + `fetchExchange`, called via
  `fetchGraphqlSoup()` (`src/lib/service-clients/service-storage/graphql-soup.ts`),
  results mapped to REST `SoupApiItem` shapes and fed into TanStack
  solid-query infinite queries (`src/lib/queries/soup/items.ts`), gated by
  `ENABLE_GRAPHQL_SOUP` with REST fallback.
- A separate normalization layer exists at the tanstack level:
  `@normy/query-core` (`src/lib/queries/soup/normalized-cache/`).
- WASM precedent: loro-crdt via `vite-plugin-wasm`; note the documented
  dual-instantiation pitfall in `vite.base.ts` — the cache wasm
  module must be instantiated exactly once per JS context.
- IndexedDB (`idb`) and OPFS utilities are already used elsewhere
  (loro WAL/snapshot stores, `service-storage/util/opfs.ts`).

## 4. Architecture

One Rust core engine, two hosts:

```
                    ┌──────────────────────────────────────────┐
                    │  cache-core (pure Rust crate)            │
                    │  • GraphQL doc parsing (apollo-rs)       │
                    │  • schema metadata (build-time codegen)  │
                    │  • normalize / denormalize               │
                    │  • dependency index (op ↔ record keys)   │
                    │  • hot tier: LRU record store            │
                    │  • Storage trait (async KV + scans)      │
                    └───────────────┬──────────────────────────┘
              ┌─────────────────────┴──────────────────────┐
              ▼                                            ▼
┌───────────────────────────────┐        ┌─────────────────────────────────┐
│ BROWSER ONLY: wasm-bindgen    │        │ TAURI: native engine in the     │
│ module in a worker;           │        │ Tauri host process (Rust);      │
│ Turso over OPFS               │        │ no webview storage ever         │
│ (storage entirely in Rust)    │        │ • naturally shared across ALL   │
│ • one coordinated engine     │        │   webviews/windows              │
│   owner across browser tabs   │        │ • Turso filesystem storage      │
│ • unsupported browsers use   │        │ • glue over invoke + channels/  │
│   a storage-free no-op host   │        │   events                        │
│                               │        │                                 │
└───────────────┬───────────────┘        └────────────────┬────────────────┘
                └──────────────────┬──────────────────────┘
                                   ▼
                  ┌────────────────────────────────────┐
                  │ JS glue: transport-agnostic async  │
                  │ RPC client (`CacheHost` interface) │
                  │ • normalizedCacheExchange (urql)   │
                  │ • imperative read/write/invalidate │
                  └────────────────────────────────────┘
```

### 4.1 Why the engine lives outside the page

- Keeps main thread free (normalization of large pages off-thread).
- A worker is the natural place for a shared single engine instance
  (SharedWorker) and keeps wasm out of every page context.
- On Tauri we do **not** use SharedWorker or webview storage at all —
  support is inconsistent across WKWebView/WebView2/Android WebView, and
  webviews can't share a SharedWorker across windows. The Tauri host process
  is the shared singleton: it gets us the multi-webview requirement for
  free, with native Turso filesystem storage instead of webview storage. The
  wasm/worker path is **browser-only**.

### 4.2 Multi-consumer strategy (browser only)

**Decision: Turso-backed persistence over OPFS, with one coordinated engine
owner across tabs.** The coordinator routes every request to the current
engine worker and replaces that owner after abrupt loss. Browser worker links
use Effect's scoped worker transport (`Worker` plus the
`@effect/platform-browser` parent/runner adapters): Effect owns readiness,
message-loop fibers, typed transport failures, and close framing. The elected
engine also tracks every admitted request in a scoped `FiberSet`; graceful
drain waits for that set to empty before closing the core, runner, and worker.
The cache's validated envelopes, request ids, Web Locks, owner epochs,
heartbeats, and replay policy remain application-owned. A normal `pagehide`
uses a fenced navigation-departure message: the page terminates its dedicated
worker, but the next owner opens the existing OPFS database. Only an
unannounced liveness, transport, or engine failure **after the database
open grant** selects `wipe-before-open`. A missed heartbeat alone is not owner
loss: background tabs and their dedicated workers may be suspended while the
SharedWorker still runs. The coordinator probes the physical owner Web Lock
without waiting or stealing it; a held lock (or a failed probe) retries the
heartbeat without changing epochs or touching storage. A released lock confirms
silent worker termination and triggers the usual fenced recovery. Read deadlines
still bound callers waiting on an unresponsive engine outside a visibility handoff.

Protocol v10 reports tab visibility and epoch-fenced read states: `ready`,
`waiting`, and `blocked`. A visible owner stays put even if another visible window
gets focus. When its page hides, stop routing new work into that engine and ask it
to drain immediately, without waiting for another visible consumer. An engine
already loading/opening first finishes startup before draining. The runtime waits
for admitted work and closes OPFS before acknowledging. Only then may another
eligible visible page acquire the owner lock and open the existing database.
Clients and their subscribers stay connected; an explicit page disposal can join
the same drain and retire that page normally.

If no eligible tab is visible, the coordinator enters `parked` with no engine.
Background cache work queues until a visible page resumes ownership; it never
starts a replacement in a hidden tab. A first-ever hidden registration also parks
without touching storage. If an in-progress startup becomes all-hidden, pause its
phase watchdog rather than misclassifying browser suspension as failure; resume
the phase budget when a visible consumer returns. Parking retains the required
open/reset action: it does not erase a reset requirement established by a real
failure. Storage identity and version are unchanged. A ready recovery epoch
publishes its storage outcome before immediately draining or parking, so hosts
invalidate reset data/leases even if the next owner only opens existing storage.
Reset completion accounting likewise follows accepted readiness, not whether
that epoch remains active; its read pause stays in force during the drain.

Catch-up writes keep their individual transactions and replies, but the
coordinator coalesces broad `cache-changed` and `cache-hydrated` hints across its
accepted in-flight backlog. The engine's local queue is insufficient: separate
MessagePort deliveries can make it look idle between queued commits. Each channel
keeps its latest revision and the union of search buckets; an unscoped hint stays
unscoped, and hydration never becomes an authoritative invalidation. Publish when
the last outstanding commit sends its hint or the remaining replies drain,
including failed/no-op tails. A batch also flushes after 64 completed requests so
continuous traffic cannot starve subscribers. Single-request updates, reset fences,
query dependency pushes, and mutation settlements remain immediate. Flush accepted
hints on owner departure/failure and when the last waiting caller leaves; never
carry them into another engine's revision space. `graphql_cache.change_batch`
records how many hints each coalesced broadcast replaced, without payloads.

While parked or transitioning, `waiting` pauses read/init deadlines without
creating a second page-side request queue. Reads, writes, and teardown retain
coordinator admission order. A visible consumer starts a one-second read budget
covering drain/startup/resume; changes of candidate do not extend it. If everyone
hides again, cancel that budget. On expiry, `blocked` allows ordinary query network
fallback (`cache-only` still never forwards) without repeatedly paying ten seconds.
Only read callers are canceled, not admitted engine work or writes. Readiness
restores deadlines and refreshes dependency registrations with preserved-storage
semantics, including when startup finishes on its original owner.

A replacement also invalidates document-read cursors and in-flight snapshots.
The exchange retries a still-current read once against the new generation instead
of dropping its only result: urql deduplicates a reexecution while that operation
is still pending. Teardown, remount, and newer cache/network results still fence
old reads. This applies to initial queries and affected watched rereads; continued
churn uses normal request-policy handling. Cache-and-network never forwards a
second request for this retry, and cache-only/replacement-registration-only reads
never gain a network fallback. The anonymous page-side `graphql_cache.read_retry`
span times the extra read without exporting query contents or identities.

Live notification receipt must not wait for this storage pause. The
`notificationReceiptExchange`, placed between the normalized-cache exchange and
the subscription transport, publishes notification callbacks before persistence
in both cached and uncached clients. The normalized-cache exchange still applies
subscription effects serially before cache-dependent channel reconciliation.
Resuming storage never republishes the notification callback. `notification.receive`
spans record the notification ID, patch type, and page visibility without content;
listener failures mark this span while remaining listeners still run. Result-local
weak context links `graphql.subscription.cache_queue` (the wait behind earlier
subscription effects) and `graphql.subscription.cache_apply` (cache application,
including parked-storage waits) to that receipt, even after its immediate span
ends. Cache failures mark the application phase without recording payloads or
replaying delivery. This context never enters GraphQL extensions or the wire.

Already-sent HTTP mutations may finish while parked. Their local commit, rollback,
or defer requests wait for storage and retain their position ahead of later
claims. Accepted settlement requests survive their caller disconnecting; their
orphaned replies are dropped, not their known outcomes. This queue is still
coordinator memory, not durable storage: loss before acceptance or loss of all
contexts/coordinator still needs the existing uncertain-outcome and server-side
idempotency protections. Parking never reports an unpersisted enqueue as durable.

The read budget never kills an owner, steals a lock, wipes storage, or replays a
write. If a drain itself stalls, writes wait until it can finish or existing
failure/navigation recovery applies. Owner telemetry adds `park-started`, `parked`,
`unpark-started`, and `unpark-completed` alongside the `visibility-handoff-*` events.
The backend-free `parking.browser.e2e.ts` exercises physical release, retained
clients/storage, a query admitted while parked completing across replacement
without network fallback, a response settled after parking, and notification
receipt while parked without duplicate delivery when persistence resumes, and
five queued catch-up commits producing one visible-cache refresh on return.

Every departure rejects already-routed optimistic enqueues whose replies were
lost as `admitted-enqueue-uncertain`, including requests from surviving tabs.
An engine epoch fence does not undo a committed queue entry, and a planned
recovery wipe has not erased it yet. The exchange must neither retry those
enqueues nor forward them directly to the API. Requests queued at the coordinator
but not yet routed remain eligible for one dispatch to the replacement engine;
late old-epoch responses cannot settle the rejected requests.

Safari can recreate the SharedWorker global while retaining a page's MessagePort,
including when another tab closes. A second Effect ready frame is a transport
reset, not a duplicate initial handshake: the page retires its orphanable engine
and connection, then re-registers and initializes against the new coordinator.
The same host and subscribers survive. Pending operations reject without replay;
an admitted optimistic enqueue is reported as uncertain so it cannot fall through
to a second API write. Durable storage and the cache scope are preserved, while
live-query dependencies and revision checkpoints are invalidated after reconnect.
Restarted startup is bounded by the registration retry budget; exhaustion uses
the normal session fallback without quarantining a healthy database. The
`graphql_cache.owner` event records `ownerEvent: coordinator-restarted`.

Protocol v6 separates startup into asset loading, taking the database owner
lock, and database opening. The engine loads/compiles WASM without touching OPFS
and reports `engine-assets-ready`. It then takes the owner lock only if it is
free (`ifAvailable`), never queueing behind another holder: a busy lock is retried
for about ten seconds with `owner-lock-busy` reports. Once it holds the lock it
reports `owner-lock-acquired` and waits for the coordinator's `open-engine` grant;
the coordinator records that storage may be touched before sending this grant.
Pre-grant failures, including every failure while taking the lock, preserve the
current open/reset requirement; an earlier required wipe is never forgotten.
Startup phase budgets are relayed to every page, including late joiners: asset
loading gets five minutes, taking the lock gets the retry window plus five
seconds, and database opening gets twenty seconds, plus a five-second page
response grace. Ordinary read deadlines remain ten seconds. Coordinator
registration gets sixty seconds per attempt, with three attempts separated by
100 ms and 200 ms waits. Safari can abort a shared worker's download when its
creating page leaves, then briefly reuse that failed startup for immediate
retries. These waits let the browser retire it without changing the worker name,
URL, or storage scope. Navigation and disposal cancel the wait; no new adapter
is created by a canceled initialization, even if its timer already fired.
`graphql_cache.registration_retry` reports the wait duration, retry number,
triggering error class, and whether the wait completed or was canceled. This is
separate from a repeated-ready restart and does not make generic transport
failures storage-safe. Engine recovery retains its bounded five retries.
Exhausted bootstrap retries preserve the cache
scope only when the coordinator explicitly proves storage was untouched, not from
a page's last-seen phase. Missing/broken transports remain conservatively
uncertain. Pages retry proven untouched bootstrap and owner-lock failures on reconnect,
foregrounding, or explicit draft Retry, with jittered exponential backoff capped
at thirty seconds. A newly registered host restarts an exhausted untouched
coordinator at a new owner epoch with `open-existing`; failed hosts remain
excluded. Draft writes stay blocked until the replacement opens and inspects
the preserved mutation queue. A read refused because the database was moving
between owners (`owner-handoff-blocked`) leaves the host running, so recovery
proves that same host readable on its next attempt instead of registering
another. Unknown storage failures still require explicit recovery or an update
(the compose banner offers Reload then); retry never rotates the scope or clears
persisted data.

A build's coordinator has its build time in the SharedWorker name, so builds
use separate coordinators even when their coordinator script URL is identical.
This keeps each build's tabs attached to its matching engine and GraphQL schema.
The database identity stays shared across compatible builds; the newer build
takes it over. Pages use the same build time (`__APP_BUILD_TIME__`, stamped by
Vite) in the worker name and when they register. When the lock stays busy while
tabs of another build are alive (liveness locks of tabs this coordinator never
registered; a departed tab's lock can outlast it), the coordinator posts a
takeover request on the cross-build channel
`graphql-cache-takeover:{database name}` (`coordinator-takeover.ts`, a contract
every later build must keep). Only builds that open the same database join it,
and only the coordinator whose engine holds the database, or is opening or
draining it, answers:

- **Yield**, if the requester is strictly newer. Every tab registered there gets
  `cache-superseded`. Each page retires its host to the network. The owner's
  page leaves the way a navigating page does: it terminates its engine, which
  releases the owner lock without counting as a lost owner. An enqueue that was
  already sent is reported as uncertain rather than sent again, because it may
  be in the durable queue that the newer build replays. Nothing is elected
  again. The requester's engine, still retrying the lock, opens the same
  database with its data and queued mutations. A holder whose engine is still
  opening or already draining the database (hiding its owner tab starts a
  drain, and opening the requesting tab usually hides it) answers at once but
  supersedes its tabs only once that engine is ready or has drained, so no
  engine is interrupted while its files may be changing. If that engine is
  lost first, the promised handover completes in place of the reset election,
  so a build never wipes a database it agreed to hand over.
- **Keep**, if the requester is not newer. The requester fails closed as below.

A superseded page offers a persistent reload prompt. It reloads by itself only
while hidden, online, not holding work (a call or an upload, via
`holdAutomaticReload`), and not focused on a text field that holds text.
Otherwise it retries the next time it is hidden or comes back online. A page
that registers with a superseded coordinator later, for example after a
rollback or from stale HTML, only runs uncached, because a reload could land on
the same build again.

A coordinator that holds nothing but gets a request from a newer build sends
its tabs there too, without answering. An unanswered request is posted again
every second while the engine keeps retrying the lock: the holder may be
between owners, or parked with the lock already free, and the requester's own
retries then take it. When the holder keeps the database, or when the engine
exhausts its retries (builds from before handover never answer, so their
holders cost that whole wait), the coordinator fails closed:
it refuses queued requests with `owner-lock-unavailable` and tells every
registered page `cache-unavailable`. Those pages retire their host for the rest
of the page session, without quarantine, toast, or error report; only a tab
that registers later tries again. Nothing waits in line for the lock, and a
build only ever yields to a newer one. A rollback therefore leaves the rolled-back
build uncached until the newer tabs close, instead of reloading tabs in a loop.

The browser can also hand the owner lock to the next engine before a departing
page's terminated worker has let go of the database files. Production logs show
that gap outlasting two seconds after a reload. Every holder of these files
first holds the owner lock, so a busy file seen while holding it is a predecessor
still exiting, not damage. The OPFS adapter waits up to ten seconds for busy
files within one open or wipe. If they stay busy, the engine reports
`storage-busy`, and the coordinator fails closed as above. It keeps that
attempt's open or wipe requirement instead of escalating a failed open to a
wipe, which could not remove open files anyway.

The physical database name embeds the storage versions,
`graphql-cache:{scope}:s{epoch}.v{format}.t{storage}`, so builds with different
compatibility epochs, record formats, or storage schemas use separate files and
owner locks instead of resetting each other's data. Builds at the versions in
use when names began to embed them (epoch 3, format 3, storage 11) keep the
unversioned `graphql-cache:{scope}`, so that change moved no database and the
next build still replays its queued mutations. Once an owner is active and no
other build has live tabs, the coordinator lets that page delete stale
databases of its scope: names for versions no newer than its own that it does
not open, which includes the unversioned name once the versions move past it.
A newer version is kept, because its build may come back after a rollback. The page lists OPFS and, only if a stale name exists,
starts a disposable worker (a file Turso cannot read may poison its OPFS
registry) that deletes each stale database whose owner lock is free and whose
`mutation_queue` is empty. Databases still queueing mutations, or whose queue
cannot be counted, are kept and reported.

Browsers missing the required worker, lock, or OPFS
capabilities use a storage-free no-op cache host. Tauri
detection selects the native transport before browser capability checks. All
paths remain behind the same `CacheHost` interface.

### 4.3 Storage backends

| Backend | Host | Notes |
|---------|------|-------|
| Turso over filesystem IO | Tauri native | records, search projection, mutation queue, optimistic layers, and metadata; WAL mode |
| Turso over OPFS | browser | the same frozen schema behind the OPFS IO adapter and coordinated worker lifecycle |

Normalized records are serialized with `postcard` into `records.value`, behind a
one-byte encoding tag: records of 256 bytes or more are stored deflated when that
is smaller, and everything else stays raw. Other persisted payloads (queued
mutations, optimistic layers, projections) remain plain postcard. A format bump
that only changes the record encoding carries the previous database forward by
dropping records, search projections, index facts, and calendar ranges — all
refetchable — while keeping queued mutations, optimistic layers, and their
projections. Native storage then compacts the migrated file with `VACUUM INTO`, so
the upgrade reclaims the space instead of leaving freed pages behind.
Both hosts use the same `Storage` implementation and compound entity keys.
Wasm futures are not `Send`, so the `Storage` trait's futures are bound by
`MaybeSend` (`crates/maybe_send`): `Send` on native targets, where Tauri drives
the engine directly from its multi-threaded runtime, and unbounded on wasm.

### 4.4 Data model

- **Record** = normalized entity: `key → { fields, embedded objects, links,
  staleness/lastWritten metadata }`.
- **Operation root** = `hash(query, variables) → root links + lastFetched +
  ttl`. Persisted → offline replay of previously-seen queries.
- **Dependency index** = record key → active operation ids (in-memory only)
  and record key → persisted operation hashes (disk, for GC).

### 4.5 urql exchange semantics

- On operation: read the cache and emit a full hit; partial/miss: forward.
  `cache-and-network` starts the cache read and network request concurrently,
  emitting a still-current cache hit as stale while the request is pending.
- On network result: publish foreground data before the ordered RPC `writeQuery`;
  normalization captures every record the
  response traverses and installs the active operation's dependencies in the
  same write. Complete responses register exact keys; uncertain responses are
  conservatively affected by every visible change until a later exact read or
  write. Persistence acknowledges a revision without replaying the response.
- Initial and affected cache reads share a version guard: a newer published
  result, cache read, teardown, or generation change supersedes an older read.
  A late affected read must not restore old message membership after a fresh
  thread response. Hosts with watched queries reconcile pending local edits
  against the new server snapshot after persistence, including hosts whose watch
  endpoint falls back to a full read.
- Hydration-only operations skip cache reads and active-operation registration.
  Client-only `@cacheOnly` fields are fetched and normalized but omitted from
  the result returned across the worker/Tauri boundary. The directive is
  stripped before network transport; remaining fields are projected directly
  from the validated response during the write, avoiding a denormalizing read.
- On teardown: unregister operation (unpins dependencies).
- Cross-context: engine broadcasts changed-keys; every context's exchange
  rereads its own affected active operations, preserving mounted live queries.

### 4.6 Coexistence with normy / tanstack

Near term the exchange sits under `fetchGraphqlSoup` unchanged (tanstack stays
the component-facing layer; it benefits from offline + dedup immediately). As
components move to reactive urql queries, the corresponding soup queries drop
out of the normy layer. The wasm cache is the source of truth for
GraphQL-fetched data; do not double-normalize the same data in normy — remove
soup entities from the normy config as they migrate.

## 5. Repo layout

```
crates/client/            # members of the root cargo workspace
  cache-core/                  # pure engine, native tests (schema codegen in build.rs)
  cache-turso/                 # Turso Storage (browser OPFS + Tauri filesystem)
  turso-opfs/                  # browser OPFS adapter for Turso
  cache-wasm/                  # wasm-bindgen shell (web)
apps/web/tauri/graphql_cache_plugin/ # tauri commands + engine thread wrapping
                                     # cache-core over cache-turso. Lives in the
                                     # tauri workspace (not crates/client): it
                                     # depends on the patched tauri fork pinned
                                     # there, path-deps back to crates/client.
apps/web/src/lib/graphql-cache/ # JS glue
  host/                        # CacheHost interface + worker & tauri transports
  exchange/                    # urql normalizedCacheExchange
  solid/                       # createLiveQuery, the reactive document query
  worker/                      # SharedWorker entry + worker core
```

## 6. Phases

**Phase 0 — spike** *(closed)*
- Browser probe harness built; Chromium results in Appendix A. Its original
  IDB decision was later superseded by the Turso-over-OPFS architecture in
  §4.2. Safari/Firefox probe runs and the Tauri IPC benchmark were deliberately
  skipped.
- Wire protocol delivered in Phase 3 (`src/lib/graphql-cache/protocol.ts`).
- The probe harness (`spikes/graphql-cache-probe/`) and the soup payload
  measurement script (`scripts/measure-soup-payloads.ts`) were removed
  after the decisions landed — recover them from history (`jj`/git) if
  re-measurement is ever needed; the results live in Appendix A.

**Phase 1 — cache-core (native, no wasm)** *(done — `crates/client/cache-core`)*
- Schema metadata codegen from `static_assets/schema.graphql`
  (`build.rs`; key policy derived via the presence-of-id convention, build
  fails on malformed shapes).
- Normalize/denormalize for the real `Soup` query shape, abstract types + fragment
  handling, alias-aware storage, canonical-args field keys.
- Dependency index, LRU hot tier, in-memory Storage impl, engine with
  batch-fetch read loop and changed-key/affected-ops write results.
- Deferred: nullability-based partial results (metadata already generated),
  byte-based LRU budgets, proptest round-trips, staleness metadata.

**Phase 2 — persistence** *(done — `cache-turso`)*
- Shared postcard record codec + `cache_namespace(scope)` embedding
  schema compatibility epoch + format version.
- Turso backend for both Tauri native filesystem storage and browser OPFS:
  WAL mode, batch transactions, and physical reset on incompatible storage;
  tested natively and in headless Chromium.
- Recovery browser fixtures require a matched production/test-hook WASM pair.
  Run `just build-cache-wasm-browser-production` from `apps/web` to rebuild both;
  a standalone Vite build reuses the generated artifacts. The fixture compares
  embedded `cacheBuildInfo()` metadata (package version, GraphQL schema hash,
  compatibility epoch, record format, and storage schema) before creating the
  fixture database and again before fault injection. This matched-build check
  is intentionally stricter than normal cache compatibility.
- Stale-version DB cleanup for the current scope (browser) is done; see §4.2.
  Deferred: cleanup of other scopes' databases (quarantined or rotated
  scopes), `scan_prefix`/`approx_size` for GC (hardening phase).

**Phase 3 — hosts + JS glue** *(done)*
- ~~`cache-wasm`~~: wasm-bindgen shell (async-mutex engine, string op-id
  interning `"{clientId}:{urqlKey}"`), browser-verified via
  wasm-bindgen-test. Build: `just build-cache-wasm` →
  `src/lib/graphql-cache/wasm/` (gitignored), ~460 KiB pre-gzip.
- ~~JS glue~~ (`apps/web/src/lib/graphql-cache/`, alias `@graphql-cache/*`):
  wire protocol (`protocol.ts`), `CacheWorkerCore` + SharedWorker entry,
  and `createWorkerCacheHost` implementing `CacheHost` (with a storage-free
  no-op host when SharedWorker is unavailable). The page↔coordinator and
  coordinator↔engine links run through Effect's browser Worker/WorkerRunner
  protocol; cache-specific routing, fencing, and validation stay above that
  transport. Type-checked; end-to-end browser exercise happens with the Phase
  4 exchange integration.
- ~~Tauri host~~ (`apps/web/tauri/graphql_cache_plugin`, in the *tauri*
  workspace — it needs the patched tauri fork pinned there; path-deps on
  `crates/client/{cache-core,cache-turso}`): engine behind an async mutex
  on the tauri runtime (`Storage` futures are `MaybeSend` → `Send` native;
  Turso uses its synchronous native IO driver), commands mirroring the worker protocol
  registered app-level in `src-tauri` (bundle-updater pattern, no
  capability plumbing), changed ops broadcast to every webview via the
  `graphql-cache://ops-affected` event. One native engine per app process = SharedWorker topology: no Web
  Locks / BroadcastChannel machinery. DB at
  `{app_data_dir}/graphql-cache/cache.turso`.
  JS side: `createTauriCacheHost` (`host/tauri-host.ts`) — invoke-based
  RPC with the same read-only 10s timeout + Error-normalized rejections, event
  subscription filtered by clientId prefix; `isTauri()` selects it in
  `graphql-soup.ts`.

**Phase 4 — urql exchange, behind flag** *(done — needs manual smoke test)*
- `normalizedCacheExchange`
  (`src/lib/graphql-cache/exchange/`): async cache reads with a
  forward-queue re-injection (cache is off-thread, unlike graphcache's sync
  reads), all four request policies, push-driven re-execution downgraded to
  `cache-first`, write-through of network results, cache errors degrade to
  network. 8 vitest cases against a scripted fake host.
- Wired into `graphql-soup.ts` behind `ENABLE_GRAPHQL_SOUP` override
  (browser: worker host; Tauri: native host): lazily builds the cached
  client; `fetchGraphqlSoup` uses
  `cache-and-network` (`.toPromise()` skips stale emissions → identical
  fresh semantics today) and falls back to a `cache-only` re-read on
  network errors → offline replay of previously-seen pages.
- Production build verified: worker chunks + `cache_wasm_bg.wasm` emitted
  as hashed assets (explicit `module_or_path` URL — vite copies the
  wasm-pack JS as an opaque asset, so its internal relative wasm URL had to
  be resolved at the caller).
- Exchange-level `entityResolvers` can synthesize one singular normalized
  entity relation from a field argument without persisting a link. The
  supported subset is intentionally data-only: `entityFromArgument` accepts
  a schema-generated concrete target typename and a non-list path ending in
  GraphQL `ID`. Arbitrary callbacks, scalar transforms, lists/pagination,
  partial results, and resolver writes are not supported. For extracted
  configuration, preserve field-specific checks with
  `satisfies EntityResolverConfig`; TypeScript `any`/assertions can bypass
  static checks, but malformed values are rejected during exchange
  construction and validated again by the Rust engine.
- **Manual smoke test pending**: dev-server run with the override enabled
  (localStorage `ENABLE_GRAPHQL_SOUP=true`), verify hit/miss + offline
  behavior in the browser.

**Phase 5 — write path & coexistence**
- `writeFragment`/`invalidate` from websocket handlers.
- Define normy retirement path per entity type as components move to
  reactive urql queries.

**Phase 6 — hardening**
- Eviction budgets, disk GC, telemetry (hit rate, tier sizes, read latency,
  re-execution counts), multi-tab soak tests, schema-change invalidation test.

## 7. Risks

- **Browser storage quirks** (OPFS capability differences, private mode, and
  storage eviction under pressure) — mitigated by the disposable-cache design
  and explicit owner/reset lifecycle (detect → discard → rebuild from network).
  Unsupported browsers use the storage-free no-op host. Tauri is unaffected
  because it uses native filesystem IO.
- **Pinned Turso dependency** — both hosts use the same storage engine, while
  the `IO` boundary isolates browser OPFS from native filesystem behavior.
- **RPC latency on hot paths** — reads are one round-trip to a worker/host;
  Chromium probe shows ≤1 ms for 64 KiB payloads. Batch reads per
  operation, not per record. Tauri IPC assumed adequate (benchmark skipped);
  revisit only if Phase 4 integration shows latency problems.
- **Two normalization layers during migration** — consistency hazard;
  mitigated by per-entity-type ownership rule (§4.6).
- **wasm dual-instantiation** (known loro pitfall) — single worker entry owns
  the module; never import the wasm package from page code.
- **Offline correctness** — staleness semantics must be explicit
  (`stale: true` emissions) so UI can indicate offline data.

## Appendix A — Phase 0 probe results

Harness: `spikes/graphql-cache-probe/` — removed after the §4.2 decision
landed; recover from history if needed.

### Chromium 149 (headless, Linux) — 2026-07-03

| Capability | Window | Dedicated worker | SharedWorker | Nested worker in SharedWorker |
|---|---|---|---|---|
| SharedWorker constructor | ✅ | — | — | — |
| Worker constructor (nested spawn) | — | ✅ | ❌ | — |
| OPFS root (getDirectory) | ✅ | ✅ | ✅ | — |
| createSyncAccessHandle (working) | ❌ (expected) | ✅ | ❌ | — (`Worker is not defined`) |
| Web Locks | ✅ | ✅ | ✅ | — |
| BroadcastChannel | ✅ | ✅ | ✅ | — |

Benchmarks (headless chromium on dev machine — order of magnitude only):

| Metric | Result |
|---|---|
| OPFS sync write 4 KiB | avg 2.0 ms, p50 1.0 ms, p95 5.3 ms (n=1000) |
| OPFS sync read 4 KiB (random) | avg 2.0 ms, p50 1.9 ms, p95 3.6 ms (n=1000) |
| OPFS flush after 1000 writes | 0.1 ms |
| IDB batched put ×1000 (≈1 KiB records, one txn) | 119 ms total |
| IDB individual get | avg 0.35 ms, p95 0.5 ms (n=1000) |
| IDB getAll ×1000 | 24 ms |
| postMessage RTT tiny (window↔dedicated) | avg 0.10 ms |
| postMessage RTT 64 KiB clone (window↔dedicated) | avg 0.85 ms, p95 3.0 ms |
| postMessage RTT 64 KiB clone (window↔shared) | avg 0.22 ms |

Takeaways:

1. **SharedWorker + OPFS is not viable on Chromium** (no sync handles in
   SharedWorker, no nested `Worker`).
2. **IDB point-reads (0.35 ms) beat OPFS sync 4 KiB reads (2 ms)** in this
   environment — sync-handle IO still pays a per-call cost.
3. RTT is a non-issue: ≤1 ms for 64 KiB payloads, well within the read
   budget.

These takeaways originally drove the IDB decision. The current §4.2 topology
requires SharedWorker for browser caching and deliberately falls back to no
cache when it is unavailable. Firefox/Safari probe runs and the Tauri IPC
benchmark were **skipped by decision**.

## 8. Live query API

### Choosing a reactive read

Use one default per data shape:

| Data shape | Default | Notes |
| --- | --- | --- |
| GraphQL document | `createLiveQuery` from `@graphql-cache/solid/create-live-query` | Cursor-paginated documents use `createUrqlInfiniteQuery` from `@app/lib/urql-solid`. |
| Soup list | `createSoupLiveQuery` | Feature code reads it through `useSoupAstItemsQuery`, which adds the GraphQL Soup flag, REST fallback, grouping, and entity mapping. |

`createLiveQuery` is a document-first wrapper over `createUrqlQuery`: the
document and variables are arguments, other options pass through, and the result
and live projection path are the same. Existing `createUrqlQuery` call sites are
already live and need no migration; new single-document reads use
`createLiveQuery`. Soup's maintained-view binding and keyed row projection are
internal to `src/lib/queries/soup/`, not general query APIs.

### Usage

Use a generated document and reactive variables. The normal urql provider can
supply the client; pass `client` when using a service-specific client.

```ts
const accountQuery = createLiveQuery(
  MailAccountsDocument,
  () => ({}),
  () => ({ client: getGraphqlSoupClient(), requestPolicy: 'cache-and-network' })
);

// Access inside a reactive computation or JSX; don't destructure store fields.
const accounts = () => accountQuery.data?.user.emailLinks ?? [];
```

`undefined` variables pause a query. Changing variables creates a separate cache
identity. `refetch`, request policies, loading/error state and selection functions
retain the existing urql-solid contract. Existing `createUrqlQuery` and
`createUrqlInfiniteQuery` consumers use the same live projection path without
being rewritten; every loaded infinite-query page stays subscribed. A failed
refetch reports its error but leaves mounted live data as it was: its partial
nulls are neither persisted nor reconciled into the objects readers hold.

Mutation predictions are keyed by mutation field and registered once per field,
alongside domain query definitions. A representative generated document names
the field, types its arguments through the document's variables, and types the
predicted value through its selection:

```ts
optimisticResolver(MarkEmailThreadSeenDocument, ({ input }) => ({
  __typename: 'GraphqlSoupEmailThread',
  id: input.threadId,
  isRead: true,
}));

// Any caller can then execute the ordinary generated mutation, or any other
// document that selects markEmailThreadSeen.
await client.mutation(MarkEmailThreadSeenDocument, {
  input: { threadId },
}).toPromise();
```

The representative must pass every field argument as a same-named variable, so
its variables and the field's arguments coincide. For each mutation without an
explicit optimistic context, the exchange evaluates every root field's arguments
against the operation's variables (substituting variables and applying variable
defaults) and places the resolver's value under that document's response key.
Predictions are all or nothing: if any root field has no resolver, carries a
directive such as `@include` or `@skip`, or its resolver returns `undefined`, the
operation is sent without a prediction. Registering two resolvers for one field
is an error.

Cache-core normalizes the prediction through the executing document's selection.
Fields that document does not select are ignored, and selected fields missing
from the prediction keep their cached values on existing entities. Nested
response keys come from the representative, so a document that selects a field
under a different alias does not receive that field's predicted value.

Email sends use the independent email working-copy database and fetch-only
GraphQL client. The cache queue holds draft autosaves and ordinary mutations;
it does not persist, dispatch, or cancel sends. The email dispatcher owns send
leases and recovery, including when no composer is mounted.

The durable optimistic queue owns ordering, retries, commit and rollback. The
query author supplies no optimistic callbacks, result traversal or cache writes.
Both the list and a detail query for that thread observe the same effective
value. Changes to `isRead` preserve row objects and do not notify subscribers to
unrelated fields.

### Adoption and mutation coverage

Mounted project details, project identity chips, and agent-session mentions use
this live path as well. Project identity reads are cache-first; the shared
`GraphqlUser.initiative` entity resolver lets them reuse complete authorized
project records loaded by Soup or detail queries, without fetching on row remount.
Missing fields still require an authorized network read. Detail reads retain
cache-and-network behavior, and identity reads retain explicit permission
revalidation. Mention lookups share stable batches: adding another visible item
does not clear an existing item's data or restart its request.
Project creation links the complete server-normalized record to its detail query,
including when the user root is not cached yet. Async creation stops publishing
after viewer changes, cache replacement, or storage reset.
Task project assignments use the standard Project entity property and its
optimistic property mutation; the former task-to-project reference query and
separate assignment mutations no longer exist. Task creation includes that
property in its ordinary create request. Project descriptions use the project's
collaborative surface, provisioned by an authoritative ensure mutation.

Permissions and server-owned membership still revalidate on activity, focus, and
the existing project polling interval. Project denials are scoped to the client,
viewer, project, and operation, surviving row remounts until a fresh authorized
network response succeeds. Recovery requests capture the current denial version;
older responses and cache updates cannot clear a newer denial. A rejected
previous-viewer cache hit triggers one immediate network recovery per activation.
Disabled reads and results for another viewer are not exposed. Other query
consumers retain mount-local denial state. Mentions also refresh on session rename,
deletion, metadata updates, and reconnect when the normalized cache is unavailable.
Invalidations arriving during a refresh cause a trailing authorized read instead
of being discarded; simultaneous refresh requests share one read.

[Mutation coverage](../src/lib/queries/mutation-coverage.test.ts) enumerates all
37 mutation documents and fails when a document has no declared strategy.
Because predictions are keyed by mutation field, it also checks that local
resolver documents select only resolved fields, and that any other document
reaching a field resolver is a listed exception the resolver declines.
RenameDatabase and RenameForm call `renameEntities` and so reach its resolver,
which declines database and form entities; they stay authoritative, and the test
proves they receive no prediction. Each representative document must declare
every schema argument of its field with the schema's type:

| Strategy | Operations |
| --- | --- |
| Local resolver (7) | MarkEmailThreadSeen, MarkEmailThreadUnread, SetEmailThreadArchived, UpdateNotifications, RenameEntities, UpdateInitiative, DeleteEntityProperty |
| Existing domain optimistic recipe (12) | SaveEmailDraft, DeleteEmailDraft, SetFavorite, ReorderFavorites, SetEntityProperty, UpdateEntityPropertyOptions, CreateCalendarEvent, UpdateCalendarEvent, DeleteCalendarEvent, RespondToCalendarEvent, InviteCalendarEventGuests, MarkWorkFeedItemsDone |
| Authoritative outcome (11) | SendEmailMessage, CreateInitiative, DeleteInitiative, EnsureInitiativeDescriptionSurface, RenameDatabase, TrashDatabase, RenameForm, TrashForm, RecordChannelActivity, UpdateNotificationsForEntity, UndoWorkFeedItemsDone |
| Document only; no production caller (7) | MoveEntities, UpdateEntitySharePolicies, TrashEntities, RestoreEntities, DeleteEntitiesPermanently, DuplicateEntities, SetEntityFavorite |

The project resolver predicts names and members; sharing waits for the server.
Notification optimism predicts MARK_DONE; conditional seen/reopen transitions
remain authoritative. Renames patch both displayName and the selected source-name
alias. Property removal unlinks only the assignment from its parent, retaining a
rollbackable link until the server confirms deletion.

Server-generated identities, per-task permission outcomes, and exact notification
IDs used by undo are not fabricated. A queued acknowledgement is not a completed
server response. GraphQL renames keep optimism in the normalized layer; remaining
legacy readers revalidate on final settlement instead of retaining independent
optimistic writes that cannot roll back after an offline queue returns.

```ts
// Names, members, and property removal require no caller-owned cache writes.
await client.mutation(UpdateInitiativeDocument, {
  initiativeId: projectId,
  input: { name: 'Launch', memberIds: [] },
}).toPromise();

await client.mutation(DeleteEntityPropertyDocument, {
  entityType: 'DOCUMENT', entityId: taskId, entityPropertyId: assignmentId,
}).toPromise();
```

### Projection contract

Cache-core compiles response paths while reading normalized records. Bindings
understand response aliases, argument-qualified fields, concrete fragment types,
variable defaults and `@include`/`@skip`. Identity aliases are supported, and
bindings follow list compaction when tombstoned items are omitted. A
subscription retains its bindings and the last response it was sent; both count
toward the bound on count and estimated retained bytes.

Subsequent reads carry the last accepted engine revision. For scalar, scalar-list
and opaque-scalar changes, the engine reads only changed dependency records and
returns response-path patches. Relationships, embedded-object edits, list
membership and order, tombstones, invalidation and journal gaps re-read the
query, rebuild its bindings and diff the result against the retained response.
Diffs only target paths present in the previous response: an object whose key
set changed (another fragment type) or a list whose length or item identities
(`id`, `__typename`) changed is replaced at its own path. A new root, or
replacements larger than half of the response (such as a compacted page),
return the complete result instead: such a patch would carry nearly as much
and cost the engine a copy of every replaced value. Eviction and cursor
mismatch also return a complete result. The JS adapter preserves
immutable urql snapshots and applies those paths in one Solid batch. Query
teardown and account/engine reset discard the corresponding retained state.
Unknown directives, schema drift and incomplete cached results follow the
query's normal network policy; `cache-only` never starts a network request.

### Collection semantics and limits

The generic projection reflects cached GraphQL results. It does not infer server
resolver logic, authorization, aggregates, full-text ranking, or whether an entity
belongs in an arbitrary filtered/paginated list. Such changes need a declared
domain collection policy or server revalidation. A Soup page read as a plain
document would retain its server-provided membership, which is why Soup lists
use `createSoupLiveQuery`: it adds Soup's local membership, ordering, pagination
and Mail policy through its predicate adapter. That policy remains outside
generic cache-core.

Supported Soup predicates can read indexed matches before a server response,
using an empty baseline. `useSoupAstItemsQuery.cacheStatus` reports local
predicate readiness separately from network loading; `ready` does not prove
complete server membership. `fetchError` retains background failures even when
the display-oriented `error` keeps cached results quiet. Explicit entity lookups
pass typed identities through `graphqlCacheFirstEntities`. The single Soup owner
keeps the full-identity cache predicate separate from a stable missing-entity
network request, including pagination and retries. Identity includes entity type,
so equal IDs in different entity types remain independent. Channel lookups use
`queries/channel/by-ids` for channel identities, batching, and bounded unread
refreshes. Soup exposes generic revalidation descriptors rather than registering
channel notification readers. Consumers receive rows and unresolved IDs without
coordinating query lifetimes.
Deletion markers use the same `typename:id` identity through pending mutations,
retention, display filtering, and restore confirmation. Deleting or restoring a
document must not hide or restore an unrelated channel with the same ID. The
GraphQL-enabled deletion flow also scopes REST Soup and search side-cache
removals to the entity type, including grouped caches and partial-failure rollback.

Mail list pages carry same-query server membership in the existing `baseline`
field. The Mail adapter reconciles only baseline rows outside the indexed window,
retaining unknown rows and rejecting confirmed nonmembers. Known read, archive,
and signal flags can disprove an incomplete row's membership through the compiled
predicate; missing facts never prove a new match. Optimistic and committed flags
are read from the same engine revision as the page.

Fallbacks preserve the server's query-dependent preview fields while selecting
live flags independently of canonical preview hydration. Lists with retained rows,
or older native hosts without `retainedKeys`, remain eligible for mutation-driven
server revalidation. Indexed cursors do not move to retained rows; continuation
publishes an ordered through-read of the union instead of appending across them.
New server membership triggers evaluation even when the local list is already
longer. A baseline beyond the 5,000-row cap discards the local projection and uses
the live server list; indexed rows do not count against that baseline cap.

Grouped Soup uses `graphql/create-grouped-soup-live-query.ts` to own the initial
request and every loaded per-bin continuation. With maintained cache queries and
a supported filter plus created/updated sort, their combined server membership
is the baseline for the same predicate adapter used by flat Soup. Selected
normalized rows then derive date, project and property memberships (including
multi-value and scoped property joins); entity-type bins retain their invariant
server keys. Missing grouping evidence or an unrecognized grouping field retains
the old membership. When local selection is
incomplete, display fields come from current merged server pages before falling
back to the original evidence; current page fields do not rebase membership or
count evidence. Unsupported
filters/sorts or hosts retain the merged live server pages. Cached Mail keeps its
separate date-grouping policy.

Server membership evidence is captured separately from normalized field/link
updates, and local evaluation waits for network persistence. Filter/account/cache
generation changes discard old local evidence and continuation owners. Initial
network refreshes rebuild each loaded continuation chain from its new cursor,
retaining the previous owner until all previously loaded pages are ready (or the
server ends the chain). Failed replacements leave the old rows available and
report the paging error; explicit refresh waits for these replacements. A group
whose fresh initial page has no cursor drops obsolete continuations immediately.
The `graphql_cache.soup_grouped_refresh` span records the loaded page count and
replacement outcome. Group readers delegate paging
to this owner, so moving a continuation row cannot leave a second copy behind.
The initial cursor remains baseline metadata; paging follows the last loaded
server continuation, never a locally fabricated cursor.

The reconciliation core in `grouped/reconciliation.ts` deliberately ignores
candidates outside loaded pages: a bounded flat query cannot prove complete bin
coverage. Counts retain unseen server membership and apply proven deltas, not
loaded-row totals. Complete prior multi-value membership is necessary to prove
count increases: a row loaded in A can already belong to an unloaded part of B.
Restored cached pages cannot prove complete prior property membership: their
normalized values may be newer than their embedded bins. They use loaded
membership evidence only, without inferring count increases for existing bins.
Date rollover uses the original server bin as old membership. The
`graphql_cache.soup_grouped_local_evaluation` span records grouping field,
loaded baseline size and resulting bin count.

#### Mail window evaluation cost

Mail through-cursor reads start with the requested visible minimum plus one
lookahead row (bounded by the index page limit), then grow their scan size
geometrically only when the cursor is deeper. Previously each read started with
499 indexed rows and loaded their sort projections even for a 20-row window.
The shared `soup_filter_cache_adapter::mail` owner applies this policy to native
and browser engines. Cursor fingerprints are independent of page size; retained
server membership and the 5,000-row window ceiling keep their existing semantics.

Repeat the native benchmark with
`SOUP_BENCHMARK_FIXTURE=/tmp/mail-fixture.json cargo run --release -p soup-filter-cache-adapter --example mail_window_benchmark`.
It seeds 2,000 canonical threads in in-memory Turso and measures 20 warm through
reads at each window size. The optional fixture uses the Rust capsule encoder.
For worker/OPFS and JavaScript phase timings, serve
`src/lib/queries/soup/graphql/browser-test/vite.config.ts` from `apps/web`, then run
`bun scripts/benchmark-mail-evaluation.ts /tmp/mail-fixture.json /tmp/mail-timings.json`.
Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` for a system browser. The runner throttles
the renderer 4x, isolates worker samples by operation/window, and separates
cache-read round trips from JavaScript projection. It does not measure network,
DOM rendering, or native IPC. Setup and warmup are excluded from reported runs.

On the measured 2,000-thread fixture, native median 20-row evaluation fell from
21.48 to 3.07 ms; browser filter round trip fell from 25.10 to 3.00 ms and total
cache-read/projection evaluation from 28.45 to 5.10 ms. A 499-row window was
approximately unchanged. The initial 20-row worker filter was 24.5 ms while
JavaScript projection was about 0.1 ms: the dominant cost was inside the worker,
not cross-worker transport or JavaScript materialization. These are fixture
measurements, not production p90s.

#### Cache notification coalescing

Native maintained views return a `registrationId` bound to the engine's retained
validated specification. The native host keeps at most 32 descriptors; subsequent
reads of the same descriptor send only its view id, registration token and
subscriber revision. Token lookup and the read share the engine lease. Replacement,
release, eviction or reset makes resume miss, so the host registers the complete
specification again. Older binaries without a token continue using full requests.
Revision/reset/delta semantics remain the same. Empty explicit-key selections
need only a fresh engine revision and send no unused selection document.

Soup's revision observer and maintained predicate reader both use
`subscribeToVisibleCacheChanges`: leading/trailing 250 ms coalescing while
visible, one dirty refresh after visibility returns, and serialized asynchronous
reads. Generation resets and explicit/initial reads remain immediate. The
revision fence still observes every accepted notification before scheduling
work, so a late persistence acknowledgement cannot regain network authority.
Predicate snapshots publish revision progress independently of stable row/order
identities; the Soup adapter memoizes those inputs before materializing rows.

Hydration still emits notifications, but a shared cache-core owner may attach
`unchangedViews`: immutable observation tokens whose displayed windows are proven
unchanged through that notification's revision. Each accepted maintained-view
read or Mail page advertises its own token. Fragment reads bind recursive record
dependencies; the Mail compiler also binds the readable-account catalog's
`emailLinks` field, so unrelated fields on that parent do not wake Mail.

The owner uses the complete record/projection journal, validated predicate,
selected and baseline keys, and a proven full-window sort cutoff. A matching
entrant, selected dependency change, uncertain facts, optimistic composition,
journal barrier/gap, or evicted token prevents a proof. Observations are bounded
to 64 snapshots. Proof failure preserves the committed hydration and broadcasts
broadly. Older native engines omit tokens and continue conservative refreshes;
no new request arguments are sent across that deployed boundary.

Mail cutoffs additionally require a known matching lookahead row, tracked as a
record/projection dependency. Its continued membership proves the cursor still
exists. Exhausted windows omit that cutoff so older hydration can expose a new
continuation; deleting the last lookahead also invalidates the proof.

The subscriber skips only its exact accepted observation. Pagination clears its
proof until a through-read observes the combined window. Batched hydration
notifications intersect proofs across all writes. Calendar coverage commits
record their complete normalized deletion set in the same journal and carry the
same proof metadata, without changing calendar range invalidation. Quick Access search bucket
hints remain insufficient for Soup property/membership invalidation. Filtering,
sorting, proof decisions and maintained view deltas stay in the shared Rust
owners; screen components do not inspect changed entity kinds.

`soup.network`, `soup.cache`, and the initial `soup.local` pending phases join
existing route flows through paint. Incremental cache evaluations create no
standalone spans and do not compare no-op span identity. The shared Soup
telemetry owner aggregates predicate/local read counts, rows, changed-row
counts, retries, errors, discarded reads, durations, authority transitions and
stale-fallback durations into `graphql_cache.soup_updates.summary` logs at most
once per five active minutes per tab. It retains only fixed numeric categories,
uses no timers, and isolates exporter failures. Durations in that summary are
aggregate measurements, not duplicate duration attributes on operation spans.
`urql.reconcile` times the Solid bridge, and subscription cache application has
separate write/delete children and an effect count so transport waits are visible
per effect.

#### Grouped projection performance

Run `bun scripts/benchmark-grouped-soup.ts /tmp/grouped-soup.json` from
`apps/web` (set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` for a system Chromium).
It bundles the production functions into an isolated Chromium page: 20 warmups
and 100 samples per case, with 100/1,000/5,000 unique loaded rows, property
(single and three-value), project and date groups. Projection reads real Solid
store proxies inside a tracked memo and indexes current page items for display
fallback; deterministic rows move groups or fail the
filter. Page merging uses ten-row continuations. Flat materialization is a
comparison, not equivalent grouped behavior.

The measurements isolate main-thread projection and page merging; they exclude
worker predicate execution, IPC, network, UI mapping and DOM rendering. A 4× CPU
throttle is a stress case, not a claim about any particular mobile device.

Measured on an Intel Xeon Platinum 8581C with Chromium 155.0.8059.79:

| Loaded rows, three-value properties | Group projection p95 | Flat materialization p95 | Page merge p95, before → after |
| --- | --- | --- | --- |
| 100 | 0.8 ms | 0.2 ms | 0.2 → 0.1 ms |
| 1,000 | 6.0 ms | 0.7 ms | 10.0 → 0.4 ms |
| 5,000 | 30.8 ms | 3.4 ms | 258.1 → 1.8 ms |
| 100, 4× throttle | 2.8 ms | 0.8 ms | 0.9 → 0.7 ms |
| 1,000, 4× throttle | 25.3 ms | 3.0 ms | 41.5 → 1.8 ms |
| 5,000, 4× throttle | 129.7 ms | 14.0 ms | 1,067.2 → 7.8 ms |

Page merging now accumulates each bin once instead of copying all earlier pages
for every continuation. The identity-read regression test guards linear work
without a machine-dependent timing assertion. Small loaded views have modest
projection cost; the 5,000-row reconciliation ceiling is not a frame-time budget.
Full property regrouping at that depth still exceeds a 16.7 ms frame, especially
under throttling, and needs incremental projection before claiming smooth bulk
updates at the ceiling.

Network responses must provide the schema's identity fields (usually `id`, and
`__typename` for abstract types) for normalization. They are not automatically
injected. Queries against other schemas, incremental `@defer`/`@stream` delivery
and arbitrary server-derived mutations are not promises of this API. A mutation
with no registered prediction still runs normally, and its normalized server
response updates subscribers. Existing websocket writers provide remote changes;
this work does not introduce a new server subscription engine.

Background hydration retains its existing opt-in notification contract. Soup's
local collection source opts in; ordinary foreground queries refresh on their
normal affected-operation notifications.

## CRM contact hydration

The auxiliary lane in `src/lib/queries/soup/backfill.ts` hydrates CRM contacts
alongside companies and foreign entities. Contacts require the explicit
`crmContactFilter: { literal: { include: true } }` opt-in; an omitted filter
returns no contacts. `SoupBackfill` already selects `GraphqlCrmContactFields`
under `items @cacheOnly`, so records are persisted without materializing their
payloads in the page. The backend scopes contacts to visible contacts in the
viewer's accessible CRM-enabled teams.

Checkpoint version 18 restarts scans saved before contacts were included. The
lane retains normal cursor pagination, retries, cancellation, storage-generation
checks, and `graphql_cache.backfill` telemetry. Subsequent passes refresh all
visible contacts because the contact filter has no updated-at watermark.

## Authoritative Mail membership repair

The shared Soup adapter reconciles supported `UPDATED_AT` Mail first pages
inside `properties::augment_authoritative`, under the same engine lock and
transaction as their normalized write. It compares up to 500 local matches
against returned IDs, bounded by the last canonical view timestamp and ID when
`nextCursor` exists. Exhausted/empty first pages cover the whole matching slice.
Missing matches become durable incomplete projections, not deleted records or
invented archive/signal facts. Mail retention excludes explicitly invalidated
(`Dirty`) baseline rows in the same projection scope unless an optimistic shadow
takes precedence; an older open view cannot restore the revoked evidence.
This differs from missing metadata, which still retains same-query membership.
Full canonical snapshots restore their proof;
partial patches cannot. Backfills, cursor pages, incomplete responses,
unsupported predicates, identity switches, and pending optimistic rows do not
supply this negative evidence. The existing authoritative-write telemetry covers
this preparation/write path; no new worker command or database migration is needed.
See [cached Mail verification](../../../docs/agent-guide/email.md#cached-mail-filtering).

## Bounded Quick Access search

Typed cache search binds normalized subsequence patterns into Turso and streams
matching compact projections into a Rust heap of at most `limit + 1` documents.
It no longer retains per-bucket text catalogs. Matching and ranking semantics,
optimistic overlays, and indexed empty-query browsing are preserved; leading
wildcards still scan selected buckets. Storage schema 12 makes the browse index
covering by appending search text and source hashes. This is an incompatible
cutover, not a migration: native caches reset, including queued mutations;
browsers open a fresh `s4.v4.t12` file and do not replay older files' queues.
Existing cleanup safeguards for those older files remain. That streaming-search
cutover did not change the record format or schema epoch. See
[streaming text search](../../../crates/client/README.md#streaming-text-search)
for the memory boundary and native/OPFS verification.

## Contact cache foundation

Projection 5 indexes only viewer-scoped `GraphqlContact` records into `person`;
public profiles and the authenticated viewer record do not establish directory
membership. Names and emails share the existing streamed matcher. Search replies
advertise `projectionVersion`, absent on older native engines, so future callers
can gate contact search rather than interpreting unsupported projection as empty.

`ContactDirectoryBackfill` persists nodes through hydration and returns the
generated cursor-only projection. Hydration omits viewer contact-page and exact
lookup wrappers. Foreground contact query variants share Soup's 64-page / 512 KiB
budget; retention version 2 compacts older viewers without clearing entities,
queue state, or storage generation.

Contact synchronization shares Soup's authenticated leader and rollout gate.
Fetch-only transport returns one 500-row page for explicit scoped admission:
the core checks the captured generation and expected/response identities under
the same engine lock as the write, without switching accounts. Coordinator
protocol 14 forwards that scope; native hosts refuse guarded writes on older
engines. Checkpoints advance only after persistence and a generation recheck.
Invalidations coalesce on a 15-minute cadence without interrupting active scans;
hourly passes refresh names. Scan omissions never delete records.

The first UI consumer is `/app/debug/data`: its contact card uses one replaceable
50-row window, with immediately collected query history. The reader validates
viewer identity and storage generation around cache reads, preserves target user
IDs, and uses bounded server pages for cold/unsupported caches. Offline windows
remain explicitly incomplete; authorization failures never become cached successes.
Server continuations stay server-side even if hydration finishes between pages.
Exact ID/email resolution derives only requested viewer-scoped UUIDv5 keys
(verified against shared backend fixtures) and projects bounded records offline.
Online batches check current membership; omissions never resurrect cached rows.
Guarded foreground hydration warms returned contacts on supported engines.
Calendar search organizer/attendee filters now combine bounded suggestions with
independent selected-email labels and do not use the global full-list hook.
Their avatars consume resolved names rather than adding name-store history.
Drive creators and CRM Notes creators now use the same reads via lazy option
sources in the shared list filter menu and mobile drawer. Selected IDs and Me
remain separate from the bounded visible page; selection changes do not shuffle
clicked rows or accumulate prior pages. Only replaces the whole current group,
including selected IDs outside the page. Tasks' AI-filter catalog and CRM company
owner/team semantics have not been changed.
Other picker migrations, before-limit DM ranking/exclusions, and authoritative
removal reconciliation remain in [the contacts checklist](../../../docs/design/disk-backed-contacts.md).

### Deterministic person-policy foundation

`subsequence_match::ranking` and the browser name scorer use corpus-independent
quality and the same recipient tiers, rather than scaling a row against the
strongest result currently loaded. Surface weights and boosts remain explicit;
command keywords retain their dedicated eligibility matcher.

The core's new person-policy API stores local DM recency/command-target and
secondary-inbox facts as private fields on existing normalized record keys. Only
server-supplied complete contact records can rank. Context snapshots use scoped,
compare-and-set begin/patch/commit epochs; patches cap at 500 and incomplete
snapshots report pending, not an empty directory. Search streams matching records
into at most `limit + 1` unique winners, applying exclusions and DM deduplication
before that limit. This joined-record path costs more than ordinary covering-only
search; it does not change storage schema 12. `CacheHost.people` now exposes state,
update and search through coordinator protocol 14 and dedicated native commands.
The app's retiring-host wrapper forwards this capability through the current host,
including methods captured before disposal. Retired reads report unsupported;
retired context writes reject instead of acknowledging a discarded publication.
Ranked person continuations bind the scope, policy and publication epoch and pin
the first window's scoring clock. A bounded-memory second pass suppresses prior
DM aliases; short/empty pages can still continue. Ordinary incremental changes
have keyset semantics; this is not a transactional directory snapshot.
Rust-derived Zod contracts validate ingress and bounded replies; missing native
commands/older WASM report unsupported reads and reject writes. Scope and storage
errors are never swallowed. Context updates publish person hydration hints only.
Host/worker/native spans record operation, counts and opaque correlation metadata,
never names, addresses or search text; live trace connectivity remains unverified.
The channel/inbox context publisher now runs under Soup's existing leader and
rollout/generation gate. Ownership-tagged selectors reuse scoped query data without
contact-directory reads or app suspension. A committed snapshot is followed by
changed/removed-peer patches, at most 500 rows per write and 500 pending IDs. Changes
to an in-flight ID survive its earlier ack; overflow and uncertain writes start a
new epoch. Missing inputs pause rather than publish emptiness. Source changes
coalesce for 250 ms, with three exponential retries and reconnect wakeup; lost
scope or unsupported hosts stop until the lifecycle changes. Context maps scale
with existing DM peers/inboxes; full channel sources are still in memory.
Quick Access now reads a replaceable person window rather than `useContacts()` or
its global item index. Commands/mentions forward typed queries; CRM alias matching
uses exact lookup for only the current 50-row CRM window. Soup facets and property
pickers preserve selections separately. Native policy version 3 applies final
mention-menu scoring and property-picker self/domain boosts before the result limit. Shared recipients and AI planner
pools still retain their explicit legacy sources; whole-app memory verification
and bounded shared display-name storage remain pending.

## Cached email Quick Access

The disposable Quick Access projection is version 6; version 6 includes the local-part contact label fallback in matching. Version 4 added task
projects (`GraphqlSoupInitiative`, bucket `initiative`), searched on their display
name with viewed-first recency read from their embedded `metadata`. Email rows index the thread
subject, latest sender name/address, and embedded `senders` names/addresses, so an
earlier sender remains searchable after another participant replies. Snippets and
message bodies are excluded. The frontend materializes only matched thread keys
with `EmailQuickAccessFields` and uses the projection text for ranking and pending
query filtering; cache hydration, visibility, and deletion changes refresh rows.
Desktop Command K explicitly excludes the email bucket; mobile Search includes it.
Unsynced email working copies merge into that bucket before any normalized
thread exists, using the same account-scoped recovery source as Drafts. Local
subjects take precedence over stale cached copies; sync retires the recovery row.
The backfill leader also warms `MailAccounts` concurrently with paged hydration
so first-use offline composition can resolve sender ownership and aliases.

Normalized email Quick Access results require the existing `enable-graphql-soup`
rollout and a healthy normalized cache; local recovery rows remain available while
that rollout is enabled even if the cache host is unavailable. The legacy REST
sources do not supply email Quick Access rows.
Quick Access observes flag loading reactively so a cold launch can attach the cache
after PostHog responds. For a local native preview without PostHog configuration,
build with `VITE_ENABLE_GRAPHQL_SOUP=true` to exercise this path; do not change the
remote rollout or backfill to make a test pass.

Opening an older cache rebuilds search documents through the existing projection
version mechanism, preserving normalized records, pending mutations, and storage
generation. This does not expand hydration: automatic backfill remains 90 days of
signal email and 30 days of noise email, plus any other cached threads. Explicit
full-text search reaches older uncached mail.


### Foreground writes and background hydration

Native `EngineAccess` reserves FIFO mutex turns for foreground commands.
Background hydration waits on release notifications without reserving a turn;
a foreground authoritative write advances the admission epoch. A waiting page
whose epoch is superseded returns an error before touching storage. The worker
owner applies the same rule by rejecting earlier queued hydration within the
current lifecycle segment. Foreground write order is preserved. An already
running storage transaction finishes atomically.

Soup backfill treats this supersession as flow control: it refetches the same
cursor after a short interruptible delay, preserving its checkpoint. Ordinary
network/storage failures retain the lane's existing bounded retry policy.
Calendar range and delta callers await their persisted occurrence fetches
before sending coverage/replacement commits; those commits may supersede
unrelated queued hydration just like other authoritative writes.

`graphql.subscription.cache_queue` times preceding effects from the same
subscription operation. `graphql.subscription.cache_apply` starts afterward
and includes host readiness, IPC, engine admission and persistence. Native
writes and deletes have no IPC deadline (see Native IPC transport), so a long
apply is a slow engine queue, not a timeout. Apply/write/delete spans carry
`cache.failure` from the bounded cache error classifier; use it with
`cache.effects_applied` to separate engine failures from slow applies. Native
engine admission has a `graphql_cache.native.lock` phase, emitted once by `EngineAccess`
for each foreground or hydrate acquisition. Its `graphql_cache.lock.wait_ms`
includes waiting until admission or supersession, not time holding the lock. Native scheduling changes require a
rebuilt native binary; older installed binaries retain their scheduling.

### Native IPC transport

The Tauri host coalesces identical concurrent `readQuery` calls, including their
operation registration identity. It never retains a completed result. Commands
and native change notifications invalidate pending-read reuse, so writes and
resets cannot cause a later caller to share an older read. Conservative operation
invalidations coalesce until the next task. Before delivering field patches,
cache changes (including resets), hydration or mutation settlements, the host
flushes earlier invalidations so other observers cannot overtake them. Disposal
drops pending callbacks.

Tauri cannot cancel a command, and the engine runs commands one at a time, so a
caller that stops waiting only loses the outcome of work that still happens.
As in worker-host, only reads and initialization have the ten-second deadline:
a read falls back to the network, and every request waits behind init. Writes,
hydration, queue claims and settlements, deletes, invalidations, teardown and
clear wait for the engine's answer. A timeout would report a failure for a
commit that still lands, and callers act on it: the mutation queue runner holds
later edits for its five-minute lease after an unconfirmed commit, and a failed
logout clear rotates the cache scope, which the running native engine refuses
with `graphql cache scope mismatch`.

The deadline counts only time the page runs on time. When the page itself
stalls (an occluded or napping macOS window, a long task), the overdue timer
would otherwise run before an answer the engine already sent and fail every
request in flight at once, so a timer that fires more than a second late starts
a new window.

Native live views advertise a specification-bound registration token. The host
retains at most 32 descriptors and resumes an unchanged specification from its
id, token and revision; a missing registration triggers a full request. Changed
specifications, release, reset and disposal invalidate retention. Older
installed binaries omit the token and keep receiving full requests. Empty record
selections fetch only the current revision, with no unused fragment.

`graphql_cache.ipc.request` is a `perf`-class span (`sampling: 'perf'`) that
records command and outcome, plus `graphql_cache.ipc.page_stall_ms` when a page
stall extended its deadline. The webview does not re-encode read
arguments to count bytes or create spans for notification callbacks.
`graphql_cache.ipc.notification` in the native emitter measures serialization and
emission, recording the single serialized payload's byte count. Native read, watch,
write, and hydration spans include the shared owner’s lock-wait child phase,
with `graphql_cache.lock.kind` set to `foreground` or `hydrate`. Native receive spans
carry the originating webview trace id, since the native logger does not adopt
the browser OpenTelemetry context. No payload content is
recorded. Broadcast operation notifications carry operation ids and optional field
patches, without a redundant entity-key list. The native emitter serializes once
and uses `emit_str`; consumers still receive ordinary JSON events.
