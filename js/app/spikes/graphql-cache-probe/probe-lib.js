// Shared probe routines used by both the dedicated worker and (where
// possible) the SharedWorker. Classic script (importScripts-compatible) —
// no modules, to maximize browser compatibility.

/** Wraps a promise with a timeout so a hung API can't stall the matrix. */
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${ms}ms: ${label}`)), ms)
    ),
  ]);
}

/** Serializes a probe outcome. */
function outcome(supported, detail) {
  return { supported, detail: detail ?? null };
}

async function probeOpfsRoot() {
  try {
    if (!('storage' in navigator) || !navigator.storage.getDirectory) {
      return outcome(false, 'navigator.storage.getDirectory missing');
    }
    const root = await withTimeout(
      navigator.storage.getDirectory(),
      3000,
      'getDirectory'
    );
    return outcome(!!root);
  } catch (e) {
    return outcome(false, String(e));
  }
}

async function probeSyncAccessHandle() {
  try {
    if (!('storage' in navigator) || !navigator.storage.getDirectory) {
      return outcome(false, 'no OPFS');
    }
    const root = await navigator.storage.getDirectory();
    const file = await root.getFileHandle('__probe_sah.bin', { create: true });
    if (typeof file.createSyncAccessHandle !== 'function') {
      return outcome(false, 'createSyncAccessHandle not a function');
    }
    const handle = await withTimeout(
      file.createSyncAccessHandle(),
      3000,
      'createSyncAccessHandle'
    );
    const buf = new Uint8Array([1, 2, 3, 4]);
    handle.write(buf, { at: 0 });
    handle.flush();
    const read = new Uint8Array(4);
    handle.read(read, { at: 0 });
    handle.close();
    await root.removeEntry('__probe_sah.bin').catch(() => {});
    const ok = read[0] === 1 && read[3] === 4;
    return outcome(ok, ok ? null : 'readback mismatch');
  } catch (e) {
    return outcome(false, String(e));
  }
}

async function probeWebLocks() {
  try {
    if (!('locks' in navigator))
      return outcome(false, 'navigator.locks missing');
    const res = await withTimeout(
      navigator.locks.request('__probe_lock', () => 'ok'),
      3000,
      'locks.request'
    );
    return outcome(res === 'ok');
  } catch (e) {
    return outcome(false, String(e));
  }
}

function probeBroadcastChannel() {
  try {
    if (typeof BroadcastChannel !== 'function') {
      return outcome(false, 'BroadcastChannel missing');
    }
    const ch = new BroadcastChannel('__probe_bc');
    ch.close();
    return outcome(true);
  } catch (e) {
    return outcome(false, String(e));
  }
}

function probeNestedWorkerCtor() {
  return outcome(typeof Worker === 'function');
}

/** Full capability sweep for the current context. */
// biome-ignore lint/correctness/noUnusedVariables: used by workers via importScripts
async function runCaps() {
  return {
    opfsRoot: await probeOpfsRoot(),
    syncAccessHandle: await probeSyncAccessHandle(),
    webLocks: await probeWebLocks(),
    broadcastChannel: probeBroadcastChannel(),
    workerCtor: probeNestedWorkerCtor(),
  };
}

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

function stats(samplesMs) {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const total = sorted.reduce((a, b) => a + b, 0);
  const pick = (q) =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return {
    n: sorted.length,
    totalMs: +total.toFixed(2),
    avgMs: +(total / sorted.length).toFixed(4),
    p50Ms: +pick(0.5).toFixed(4),
    p95Ms: +pick(0.95).toFixed(4),
  };
}

/**
 * OPFS sync-access-handle benchmark. Dedicated-worker only.
 * Sequential 4KiB writes, one flush, then random 4KiB reads.
 */
// biome-ignore lint/correctness/noUnusedVariables: used by workers via importScripts
async function benchOpfsSync(opCount) {
  const N = opCount || 1000;
  const CHUNK = 4096;
  const root = await navigator.storage.getDirectory();
  const file = await root.getFileHandle('__bench_sah.bin', { create: true });
  const handle = await file.createSyncAccessHandle();
  try {
    handle.truncate(0);
    const data = new Uint8Array(CHUNK).fill(7);

    const writes = [];
    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      handle.write(data, { at: i * CHUNK });
      writes.push(performance.now() - t0);
    }

    const tFlush0 = performance.now();
    handle.flush();
    const flushMs = +(performance.now() - tFlush0).toFixed(3);

    const readBuf = new Uint8Array(CHUNK);
    const reads = [];
    for (let i = 0; i < N; i++) {
      const at = Math.floor(Math.random() * N) * CHUNK;
      const t0 = performance.now();
      handle.read(readBuf, { at });
      reads.push(performance.now() - t0);
    }

    return {
      chunkBytes: CHUNK,
      write: stats(writes),
      flushMs,
      read: stats(reads),
    };
  } finally {
    handle.close();
    await root.removeEntry('__bench_sah.bin').catch(() => {});
  }
}

/**
 * IndexedDB benchmark: batched puts in one txn, individual gets, getAll.
 * Records shaped like normalized cache records (~1KiB JSON-ish values).
 */
// biome-ignore lint/correctness/noUnusedVariables: used by workers via importScripts
function benchIdb(recordCount) {
  const N = recordCount || 1000;
  const DB = '__probe_idb_bench';
  const STORE = 'records';

  const value = (i) => ({
    key: `GraphqlSoupDocument:doc-${i}`,
    fields: {
      name: `Document ${i} — ${'x'.repeat(512)}`,
      ownerId: `user-${i % 50}`,
      updatedAt: new Date().toISOString(),
      links: Array.from(
        { length: 8 },
        (_, j) => `GraphqlSoupProperty:p-${i}-${j}`
      ),
    },
    meta: { lastWritten: Date.now(), stale: false },
  });

  return new Promise((resolve, reject) => {
    const del = indexedDB.deleteDatabase(DB);
    del.onerror = () => reject(del.error);
    del.onsuccess = del.onblocked = () => {
      const open = indexedDB.open(DB, 1);
      open.onupgradeneeded = () =>
        open.result.createObjectStore(STORE, { keyPath: 'key' });
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;

        const tPut0 = performance.now();
        const putTxn = db.transaction(STORE, 'readwrite');
        const store = putTxn.objectStore(STORE);
        for (let i = 0; i < N; i++) store.put(value(i));
        putTxn.oncomplete = () => {
          const batchedPutTotalMs = +(performance.now() - tPut0).toFixed(2);

          // Individual gets, sequential await-per-get (worst case read path).
          const getSamples = [];
          let i = 0;
          const getTxn = () =>
            db.transaction(STORE, 'readonly').objectStore(STORE);
          const nextGet = () => {
            if (i >= N) {
              const tAll0 = performance.now();
              const allReq = getTxn().getAll();
              allReq.onsuccess = () => {
                const getAllMs = +(performance.now() - tAll0).toFixed(2);
                db.close();
                indexedDB.deleteDatabase(DB);
                resolve({
                  n: N,
                  batchedPutTotalMs,
                  get: stats(getSamples),
                  getAllMs,
                });
              };
              allReq.onerror = () => reject(allReq.error);
              return;
            }
            const key = `GraphqlSoupDocument:doc-${Math.floor(Math.random() * N)}`;
            const t0 = performance.now();
            const req = getTxn().get(key);
            req.onsuccess = () => {
              getSamples.push(performance.now() - t0);
              i++;
              nextGet();
            };
            req.onerror = () => reject(req.error);
          };
          nextGet();
        };
        putTxn.onerror = () => reject(putTxn.error);
      };
    };
  });
}
