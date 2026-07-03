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
   `GraphqlSoupChannelMessage.messageId`, embedded non-keyable types like
   `GraphqlSoupPropertyValue`). Schema lives in-repo
   (`rust/cloud-storage/schema.graphql`) → embed metadata at build time, no
   runtime introspection.
9. **External write API** — no GraphQL subscriptions exist; updates arrive
   via websocket-service. Expose `writeFragment` / `invalidate(entityKey)` so
   websocket handlers can patch records and trigger re-execution.
10. **Eviction & GC** — active operations pin their dependencies; memory tier
    is LRU with a byte budget; disk tier has a byte budget with orphan sweep
    (records unreachable from any persisted operation root).
11. **Cache identity & lifecycle** — namespace by `userId + schemaHash +
    cacheFormatVersion`; discard on mismatch (cache is disposable, rebuild
    from network); clear on logout.
12. **Native-testable core** — the Rust engine is a pure crate (`cargo test`,
    no wasm) with storage/clock behind traits.
13. **Future** — mutations don't exist in the schema yet; design leaves room
    for optimistic updates, mutation-driven invalidation, and an offline
    mutation queue, but none of that is in scope now.

### Open questions

- Encryption-at-rest for cached content (email bodies/snippets will flow
  through this). OPFS/IDB are origin-scoped but plaintext on disk.
- Disk budget (proposal: 256 MB default, configurable).
- Memory hot-tier budget (proposal: 32 MB default).

## 3. Current state (as of writing)

- urql usage is imperative-only: `@urql/core` + `fetchExchange`, called via
  `fetchGraphqlSoup()` (`packages/service-clients/service-storage/graphql-soup.ts`),
  results mapped to REST `SoupApiItem` shapes and fed into TanStack
  solid-query infinite queries (`packages/queries/soup/items.ts`), gated by
  `ENABLE_GRAPHQL_SOUP` with REST fallback.
- A separate normalization layer exists at the tanstack level:
  `@normy/query-core` (`packages/queries/soup/normalized-cache/`).
- WASM precedent: loro-crdt via `vite-plugin-wasm`; note the documented
  dual-instantiation pitfall in `packages/app/vite.base.ts` — the cache wasm
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
│ module in a worker            │        │ Tauri host process (Rust);      │
│ • SharedWorker where available│        │ no OPFS/SharedWorker/webview    │
│   → OPFS sync-access backend  │        │ storage ever                    │
│ • fallback: worker-per-tab    │        │ • naturally shared across ALL   │
│   → IndexedDB backend +       │        │   webviews/windows              │
│   BroadcastChannel invalidate │        │ • SQLite (or fs) storage        │
│                               │        │ • glue over invoke + channels/  │
│                               │        │   events                        │
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
- OPFS `createSyncAccessHandle` is worker-only.
- On Tauri we do **not** use OPFS or SharedWorker at all — webview storage
  and worker support are inconsistent across WKWebView/WebView2/Android
  WebView, and webviews can't share a SharedWorker across windows. The Tauri
  host process is the shared singleton: it gets us the multi-webview
  requirement for free, with real SQLite instead of webview storage. The
  wasm/worker/OPFS path is **browser-only**.

### 4.2 Multi-consumer strategy (browser only)

- **Preferred:** SharedWorker owning the wasm engine + OPFS sync-access
  storage (single instance, single writer). Chrome/Edge/Firefox/Safari ≥ 16
  support SharedWorker.
- **Fallback:** dedicated worker per tab over the IndexedDB backend (IDB is
  safe for concurrent multi-instance access), Web Locks to serialize writes,
  BroadcastChannel for cross-tab dependency-invalidation broadcasts.
- Selection at startup: Tauri detection (`isTauri`) → native transport;
  otherwise browser capability check picks SharedWorker+OPFS or the IDB
  fallback. All paths sit behind the same `Storage` trait and `CacheHost`
  RPC interface.

### 4.3 Storage backends

| Backend    | Host           | Notes                                          |
|------------|----------------|------------------------------------------------|
| SQLite     | Tauri native   | records + links + meta tables; WAL mode        |
| OPFS       | browser (leader) | log-structured KV, sync access handles, compaction |
| IndexedDB  | browser (fallback) | chunked KV via JS callbacks into the worker  |

`Storage` trait (async): `get_batch`, `put_batch`, `delete_batch`,
`scan_prefix`, `approx_size`. Records serialized with `postcard`.

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
rust/graphql-cache/            # new cargo workspace (or members of an existing one)
  cache-core/                  # pure engine, native tests
  cache-schema-codegen/        # schema.graphql → type metadata (build.rs or CLI)
  cache-wasm/                  # wasm-bindgen shell (web)
  cache-tauri/                 # tauri plugin/commands wrapping cache-core
js/app/packages/graphql-cache/ # JS glue
  host/                        # CacheHost interface + worker & tauri transports
  exchange/                    # urql normalizedCacheExchange
  worker/                      # SharedWorker/worker entry, leader election
```

## 6. Phases

**Phase 0 — spike (validate the risky bits first)**
- OPFS sync-access + SharedWorker support matrix in browsers only:
  Chrome/Firefox/Safari. (Tauri always uses the native host, so webview
  storage capabilities are irrelevant.)
- Tauri IPC throughput for cache-read payloads (invoke + channels) on
  desktop and mobile to validate read-latency budgets.
- Measure real soup payloads: record count/size per page → set tier budgets.
- Deliverable: go/no-go on architecture 4.2/4.3, wire protocol sketch.

**Phase 1 — cache-core (native, no wasm)**
- Schema metadata codegen from `rust/cloud-storage/schema.graphql`.
- Normalize/denormalize for the real `Soup` query document (fixtures from
  recorded responses), union handling, key config.
- Dependency index, LRU hot tier, in-memory Storage impl.
- Exhaustive native tests incl. property tests (normalize→denormalize
  round-trip).

**Phase 2 — persistence**
- SQLite backend (unlocks Tauri first — simplest host, biggest user base).
- OPFS log-structured backend + compaction; IndexedDB fallback backend.
- Namespace/versioning, corruption → discard & rebuild, logout clearing.

**Phase 3 — hosts + JS glue**
- `cache-tauri` plugin (commands + change-broadcast events).
- `cache-wasm` + worker entry + leader election + BroadcastChannel fanout.
- `CacheHost` TS interface with both transports; `isTauri` → native,
  otherwise browser capability-based selection.

**Phase 4 — urql exchange, behind flag**
- `normalizedCacheExchange` with policies, re-execution, teardown.
- Wire into the soup client under `ENABLE_GRAPHQL_SOUP`-style flag;
  `cache-and-network` for the soup infinite query; REST fallback untouched.
- Offline: serve persisted operation roots when network fails/absent.

**Phase 5 — write path & coexistence**
- `writeFragment`/`invalidate` from websocket handlers.
- Define normy retirement path per entity type as components move to
  reactive urql queries.

**Phase 6 — hardening**
- Eviction budgets, disk GC, telemetry (hit rate, tier sizes, read latency,
  re-execution counts), multi-tab soak tests, schema-change invalidation test.

## 7. Risks

- **Browser storage quirks** (Safari OPFS/SharedWorker edge cases, storage
  eviction under pressure) — mitigated by the IDB fallback path and the
  disposable-cache design; Phase 0 exists to confirm. Tauri is unaffected
  (native host only).
- **RPC latency on hot paths** — reads are one round-trip to a worker/host;
  budget ~1–2 ms web, measure Tauri IPC in Phase 0. Batch reads per
  operation, not per record.
- **Two normalization layers during migration** — consistency hazard;
  mitigated by per-entity-type ownership rule (§4.6).
- **wasm dual-instantiation** (known loro pitfall) — single worker entry owns
  the module; never import the wasm package from page code.
- **Offline correctness** — staleness semantics must be explicit
  (`stale: true` emissions) so UI can indicate offline data.
