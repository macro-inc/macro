# GraphQL Normalized Cache — Design & Plan

Status: **draft / pre-implementation**

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
8. **Schema awareness** — `GraphqlSoupEntity` is a 9-variant union; the cache
   needs possible-types metadata and per-type key config (e.g.
   `GraphqlSoupChannelMessage.messageId`, embedded non-keyable types like the variants of
   `GraphqlPropertyValue`). Schema lives in-repo
   (`static_assets/schema.graphql`) → embed metadata at build time, no
   runtime introspection.
9. **External write API** — no GraphQL subscriptions exist; updates arrive
   via websocket-service. Expose `writeFragment` / `invalidate(entityKey)` so
   websocket handlers can patch records and trigger re-execution.
10. **Eviction & GC** — active operations pin their dependencies; memory tier
    is LRU with a byte budget; disk tier has a byte budget with orphan sweep
    (records unreachable from any persisted operation root).
11. **Cache identity & lifecycle** — namespace by `scope + schemaHash +
    cacheFormatVersion`, where **scope is an anonymous client-generated
    uuid** (localStorage), *not* user identity: construction is synchronous
    and offline-capable (no identity waterfall), and no PII appears in
    enumerable storage metadata (IDB database names / SQLite filenames).
    User↔cache consistency is enforced by **identity witnessing**, split
    into two halves: *extraction* lives in the urql exchange
    (`extractIdentity: (data) => data.user.id` — the schema exposes
    `QueryRoot → user: GraphqlUser!`, viewer pattern), and *enforcement*
    lives in the engine as a schema-agnostic mechanism — writes carry an
    opaque session tag compared against the binding stored in the same
    database (`__meta:identity`), so compare-and-wipe is atomic with the
    triggering write (no stale-in-flight-write races). A mismatch wipes and
    rebinds (“silent restart”) and all active operations re-execute. Eager
    path: clear on logout.
    Discard on schema/format mismatch (cache is disposable, rebuild from
    network).

    **Key policy — presence-of-id convention**: no client-side key config.
    An output object type with `id: ID!` is keyed by `__typename:id`; no
    `id` field → embedded. The SDL is the policy (schema authors must only
    name a field `id` when it is a global identity — hence
    `GraphqlProperty.propertyDefinitionId` and
    `GraphqlSoupChannelMessage.id`); the build fails on malformed shapes.
12. **Native-testable core** — the Rust engine is a pure crate (`cargo test`,
    no wasm) with storage/clock behind traits.
13. **Durable optimistic mutations** — optimistic GraphQL mutations are
    persisted with their replay request, restored across restarts, and applied
    strictly in enqueue order. Retryability is decided by an exchange callback;
    retryable failures retain their optimistic layer. Each queued network
    attempt has a one-minute timeout, comfortably inside its five-minute lease.

### Open questions

- Encryption-at-rest for cached content (email bodies/snippets will flow
  through this). IDB/SQLite are origin-/app-scoped but plaintext on disk.
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
│ IndexedDB via the `idb` crate │        │ no webview storage ever         │
│ (storage entirely in Rust)    │        │ • naturally shared across ALL   │
│ • SharedWorker: one engine    │        │   webviews/windows              │
│   shared by every browser tab │        │ • SQLite (or fs) storage        │
│ • no SharedWorker: storage-   │        │ • glue over invoke + channels/  │
│   free no-op cache host       │        │   events                        │
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
  free, with real SQLite instead of webview storage. The wasm/worker path is
  **browser-only**.

### 4.2 Multi-consumer strategy (browser only)

**Decision: IndexedDB-backed persistence via the [`idb`
crate](https://docs.rs/idb/latest/idb/), with one engine in a SharedWorker.
Browsers without SharedWorker support use a storage-free no-op cache host.
OPFS is dropped.**

Rationale (see Appendix A):

- OPFS sync access handles are unusable from SharedWorker on Chromium (no
  sync handles, no nested `Worker` to delegate to), forcing a
  leader-election topology with failover — significant complexity.
- IDB point-reads measured *faster* than OPFS sync 4 KiB reads in the probe
  (0.35 ms vs 2 ms avg), and batched writes (119 ms / 1000 records / txn)
  are fine for our write rates.
- IDB is available in SharedWorker on supported browsers.
- Using the `idb` Rust crate keeps the entire storage layer inside the wasm
  module (no JS-callback storage shim; JS glue is transport only).

Topology:

- **Browser: SharedWorker** hosting the wasm engine — one instance across
  tabs, no election or cross-engine coordination.
- **No SharedWorker:** return a no-op `CacheHost` that always misses, ignores
  writes, and does not initialize wasm or persistent storage. Mutations pass
  through the exchange without durable optimism.
- Selection at startup: Tauri detection (`isTauri`) → native transport;
  otherwise SharedWorker support selects either the browser cache or no-op
  host. All paths sit behind the same `CacheHost` interface.

### 4.3 Storage backends

| Backend    | Host         | Notes                                          |
|------------|--------------|------------------------------------------------|
| SQLite     | Tauri native | records, mutation queue, optimistic layers, and meta; WAL mode |
| IndexedDB  | browser      | via the `idb` crate; stable per-scope DB with object stores for records, mutation queue, optimistic layers, and meta |

`Storage` trait (async): `get_batch`, `put_batch`, `delete_batch`,
`scan_prefix`, `approx_size`. Records serialized with `postcard` (stored as
`Uint8Array` values in IDB / blobs in SQLite). Note: wasm futures are not
`Send`, so the trait's futures are bound by `MaybeSend` (`crates/maybe_send`):
`Send` on native targets — the Tauri host drives the engine directly from its
multi-threaded runtime — and unbounded on wasm, implementable by `idb`.

### 4.4 Data model

- **Record** = normalized entity: `key → { fields, embedded objects, links,
  staleness/lastWritten metadata }`.
- **Operation root** = `hash(query, variables) → root links + lastFetched +
  ttl`. Persisted → offline replay of previously-seen queries.
- **Dependency index** = record key → active operation ids (in-memory only)
  and record key → persisted operation hashes (disk, for GC).

### 4.5 urql exchange semantics

- On operation: RPC `readQuery` → full hit: emit (stale-flagged if
  `cache-and-network`, then forward to network); partial/miss: forward.
- On network result: RPC `writeQuery`; engine returns the set of changed
  record keys; exchange re-executes affected active operations (mirrors
  graphcache `cache-and-network` re-emission behavior).
- On teardown: unregister operation (unpins dependencies).
- Cross-context: engine broadcasts changed-keys; every context's exchange
  re-executes its own affected active operations.

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
  cache-sqlite/                # Storage over SQLite (Tauri native host)
  cache-idb/                   # Storage over IndexedDB (browser wasm host)
  cache-wasm/                  # wasm-bindgen shell (web)
apps/web/tauri/graphql_cache_plugin/ # tauri commands + engine thread wrapping
                                     # cache-core over cache-sqlite. Lives in the
                                     # tauri workspace (not crates/client): it
                                     # depends on the patched tauri fork pinned
                                     # there, path-deps back to crates/client.
apps/web/src/lib/graphql-cache/ # JS glue
  host/                        # CacheHost interface + worker & tauri transports
  exchange/                    # urql normalizedCacheExchange
  worker/                      # SharedWorker entry + worker core
```

## 6. Phases

**Phase 0 — spike** *(closed)*
- Browser probe harness built; Chromium results in Appendix A. **Decision
  made: IDB-backed persistence via the `idb` crate in a SharedWorker, with
  caching disabled when SharedWorker is unavailable (§4.2).** Safari/Firefox
  probe runs and the Tauri IPC benchmark were deliberately skipped.
- Wire protocol delivered in Phase 3 (`src/lib/graphql-cache/protocol.ts`).
- The probe harness (`spikes/graphql-cache-probe/`) and the soup payload
  measurement script (`scripts/measure-soup-payloads.ts`) were removed
  after the decisions landed — recover them from history (`jj`/git) if
  re-measurement is ever needed; the results live in Appendix A.

**Phase 1 — cache-core (native, no wasm)** *(done — `crates/client/cache-core`)*
- Schema metadata codegen from `static_assets/schema.graphql`
  (`build.rs`; key policy derived via the presence-of-id convention, build
  fails on malformed shapes).
- Normalize/denormalize for the real `Soup` query shape, union + fragment
  handling, alias-aware storage, canonical-args field keys.
- Dependency index, LRU hot tier, in-memory Storage impl, engine with
  batch-fetch read loop and changed-key/affected-ops write results.
- Deferred: nullability-based partial results (metadata already generated),
  byte-based LRU budgets, proptest round-trips, staleness metadata.

**Phase 2 — persistence** *(done — `cache-sqlite`, `cache-idb`)*
- Shared postcard record codec + `cache_namespace(scope)` embedding
  schema hash + format version.
- SQLite backend (Tauri native): WAL mode, batch txns, namespace
  wipe-on-mismatch; tested natively incl. engine integration.
- IndexedDB backend via the `idb` crate: one DB per namespace, atomic
  batch txns; tested in headless Chromium via wasm-bindgen-test incl.
  engine-over-IDB round trip.
- Deferred: stale-namespace DB cleanup (browser), `scan_prefix`/
  `approx_size` for GC (hardening phase).

**Phase 3 — hosts + JS glue** *(done)*
- ~~`cache-wasm`~~: wasm-bindgen shell (async-mutex engine, string op-id
  interning `"{clientId}:{urqlKey}"`), browser-verified via
  wasm-bindgen-test. Build: `just build-cache-wasm` →
  `src/lib/graphql-cache/wasm/` (gitignored), ~460 KiB pre-gzip.
- ~~JS glue~~ (`apps/web/src/lib/graphql-cache/`, alias `@graphql-cache/*`):
  wire protocol (`protocol.ts`), `CacheWorkerCore` + SharedWorker entry,
  and `createWorkerCacheHost` implementing `CacheHost` (with a storage-free
  no-op host when SharedWorker is unavailable). Type-checked; end-to-end browser exercise
  happens with the Phase 4 exchange integration.
- ~~Tauri host~~ (`apps/web/tauri/graphql_cache_plugin`, in the *tauri*
  workspace — it needs the patched tauri fork pinned there; path-deps on
  `crates/client/{cache-core,cache-sqlite}`): engine behind an async mutex
  on the tauri runtime (`Storage` futures are `MaybeSend` → `Send` native;
  SQLite completes immediately), commands mirroring the worker protocol
  registered app-level in `src-tauri` (bundle-updater pattern, no
  capability plumbing), changed ops broadcast to every webview via the
  `graphql-cache://ops-affected` event. One native engine per app process = SharedWorker topology: no Web
  Locks / BroadcastChannel machinery. DB at
  `{app_data_dir}/graphql-cache/cache.sqlite`.
  JS side: `createTauriCacheHost` (`host/tauri-host.ts`) — invoke-based
  RPC with the same 10s timeout + Error-normalized rejections, event
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

- **Browser storage quirks** (Safari IDB edge cases/private mode, storage
  eviction under pressure) — mitigated by the disposable-cache design
  (detect → discard → rebuild from network). Browsers without SharedWorker
  use the storage-free no-op host. Tauri is unaffected (native host only).
- **`idb` crate dependency** — maintained third-party wasm bindings; if it
  stalls, the `Storage` trait isolates us (swap for hand-rolled
  `web-sys`-based bindings).
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
