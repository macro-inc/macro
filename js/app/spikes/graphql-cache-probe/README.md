# GraphQL cache — browser storage probe (Phase 0 spike)

> **Status: decision made — spike closed.** Based on the Chromium results
> (see Appendix A of the design doc), we committed to IndexedDB-backed
> persistence via the Rust [`idb` crate](https://docs.rs/idb/latest/idb/),
> with the engine in a SharedWorker where available and a dedicated-worker
> fallback. OPFS was dropped; Firefox/Safari runs were skipped. The harness
> is kept for future re-measurement.

Probes browser capabilities and storage performance needed by the normalized
GraphQL cache (see `js/app/docs/graphql-normalized-cache-plan.md`, Phase 0).

This targets **browsers only** (Chrome / Firefox / Safari). Tauri always uses
the native host and never touches OPFS/SharedWorker, so webviews are out of
scope.

## What it measures

Capabilities:

- `SharedWorker` availability
- OPFS (`navigator.storage.getDirectory`) in window / dedicated worker /
  SharedWorker
- `createSyncAccessHandle` in a dedicated worker (expected: yes) and in a
  SharedWorker (expected: no — spec restricts sync handles to dedicated
  workers)
- **Nested dedicated worker spawned from inside a SharedWorker, using
  `createSyncAccessHandle`** — this is the actual leader topology the design
  depends on (SharedWorker owns the engine, delegates sync file IO to a
  nested worker). If this fails on any target browser, the web leader must be
  a Web-Locks-elected dedicated worker instead.
- Web Locks and BroadcastChannel in window + workers
- `navigator.storage.persist()` / `estimate()`

Benchmarks (rough, order-of-magnitude — run on a quiet machine):

- OPFS sync-access-handle: sequential 4 KiB writes, random 4 KiB reads, flush
- IndexedDB: batched puts (single txn), individual gets, `getAll`
- `postMessage` round-trip: tiny payload and 64 KiB structured clone, to both
  dedicated and shared workers (validates the ~1–2 ms read-latency budget)

## Run

```sh
cd js/app/spikes/graphql-cache-probe
python3 -m http.server 8931
# or: bunx serve -p 8931 .
```

Open `http://localhost:8931` in each target browser, click **Run probes**,
then **Copy markdown** and paste the results into the support-matrix section
of the design doc.

Notes:

- Must be served over http(s) (workers don't run from `file://`).
  `localhost` counts as a secure context.
- Safari: run both normal and private windows (private mode changes storage
  behavior).
- Firefox: OPFS requires 111+.
