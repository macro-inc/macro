// Local test adapter: none of these RPC methods are bundled by worker-build.
import { DurableObject } from 'cloudflare:workers';
import workerdUnsafe from 'workerd:unsafe';
import { observePorts, clockRead, getCallback, enterCallback, leaveCallback } from '../src/transcript/ports.js';
globalThis.__syncObservePorts = observePorts;
globalThis.__syncClockRead = clockRead;
globalThis.__syncGetCallback = getCallback;
globalThis.__syncEnterCallback = enterCallback;
globalThis.__syncLeaveCallback = leaveCallback;
import worker, { DocumentSyncSession as Session } from '../build/worker/shim.mjs';

function b64(data) {
  let result = '';
  for (const byte of new Uint8Array(data)) result += String.fromCharCode(byte);
  return btoa(result);
}

let frontEnvironment;
let frontRecorder;

export default class TestWorker extends worker {
  constructor(context, env) {
    if (env.SYNC_RECORD && !frontEnvironment) {
      const state = { id: { toString: () => '@worker' }, storage: { sql: {} }, getWebSockets: () => [] };
      const observed = observePorts(state, env, transcript => console.log(JSON.stringify({ target: 'sync_transcript', fields: { transcript } })));
      frontEnvironment = observed[1];
      frontRecorder = globalThis.__syncTranscriptRooms.get('@worker');
    }
    super(context, env.SYNC_RECORD ? frontEnvironment : env);
    this.frontRecorder = env.SYNC_RECORD ? frontRecorder : undefined;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/__sync_test_dump' || url.pathname === '/__sync_test_flush_alarm') {
      const namespace = this.env.DOCUMENT_SYNC_SESSION;
      const stub = namespace.get(namespace.idFromString(url.searchParams.get('room')));
      return stub.fetch(`http://sync-test${url.pathname}?marker=${encodeURIComponent(url.searchParams.get('marker'))}`);
    }
    if (url.pathname === '/__sync_test_evict') {
      const namespace = this.env.DOCUMENT_SYNC_SESSION;
      const stub = namespace.get(namespace.idFromString(url.searchParams.get('room')));
      await workerdUnsafe.evict(stub, { webSockets: 'hibernate' });
      return new Response(null, { status: 204 });
    }
    const recorder = this.frontRecorder;
    const callback = recorder?.begin({ in: 'fetch', boundary: 'worker', method: request.method,
      path: url.pathname, query: url.search,
      headers: Object.fromEntries(['origin', 'authorization', 'x-internal-auth-key', 'content-length', 'x-sync-test-stop-after']
        .filter(key => request.headers.has(key)).map(key => [key, request.headers.get(key)])),
      body_b64: b64(await request.clone().arrayBuffer()) });
    const response = await super.fetch(request);
    recorder?.record({ out: 'response', status: response.status,
      headers: Object.fromEntries([...response.headers].filter(([key]) => key === 'content-type' || key.startsWith('access-control-'))),
      body_b64: response.status === 101 ? '' : b64(await response.clone().arrayBuffer()) }, callback);
    return response;
  }
}
export class DocumentSyncSession extends DurableObject {
  constructor(state, env) {
    super(state, env);
    this.state = state;
    this.env = env;
    if (env.SYNC_TEST_WALL_MS !== undefined) Date.now = () => Number(env.SYNC_TEST_WALL_MS);
    this.callbacks = new Set();
    this.accepted = 0;
    this.expireAfterAccept = 0;
    this.operationChunkFailure = 0;
    this.archiveFailure = false;
    this.operationTransactions = 0;
    this.operationAtomicBatches = 0;
    this.rootWriteCalls = 0;
    this.messageTimings = [];
    this.operationWrites = { pending: 0, archive: 0, status: 0 };
    const observeOperationWrite = (key, value) => {
      if (typeof key === 'object' && key !== null && value === undefined) {
        for (const [name, entry] of Object.entries(key)) observeOperationWrite(name, entry);
        return;
      }
      key = String(key);
      if (key.startsWith('a/') || key.startsWith('operation-chunks/a/')) {
        if (this.archiveFailure) throw new Error('injected archive write failure');
      }
      if (key.startsWith('a/')) this.operationWrites.archive += 1;
      if (key.startsWith('o/!archive-status-v1/')) this.operationWrites.status += 1;
      else if (key.startsWith('o/') && !key.startsWith('o/!')) this.operationWrites.pending += 1;
    };
    const storage = new Proxy(state.storage, {
      get: (target, key) => {
        if (key === 'constructor') return Reflect.get(target, key, target);
        if (key === 'transaction') return callback => {
          this.operationTransactions += 1;
          return target.transaction(transaction => callback(new Proxy(transaction, {
          get: (transaction, method) => {
            if (method === 'put') return async (key, value) => {
              observeOperationWrite(key, value);
              if (String(key).startsWith('operation-chunks/') && this.operationChunkFailure > 0) {
                this.operationChunkFailure -= 1;
                if (this.operationChunkFailure === 0) throw new Error('injected operation chunk write failure');
              }
              return transaction.put(key, value);
            };
            const value = Reflect.get(transaction, method, transaction);
            return typeof value === 'function' ? value.bind(transaction) : value;
          },
        })));
        };
        if (key === 'put') return (...args) => {
          this.rootWriteCalls += 1;
          if (typeof args[0] === 'object' && args[0] !== null) this.operationAtomicBatches += 1;
          observeOperationWrite(args[0], args[1]);
          if (String(args[0]).startsWith('ws_id') && this.expireAfterAccept) {
            return new Promise(resolve => setTimeout(resolve, Math.max(0, this.expireAfterAccept - Date.now()))).then(() => target.put(...args));
          }
          return target.put(...args);
        };
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const testState = new Proxy(state, {
      get: (target, key) => {
        if (key === 'constructor') return Reflect.get(target, key, target);
        if (key === 'storage') return storage;
        if (key === 'acceptWebSocket') return (...args) => {
          this.accepted += 1;
          return target.acceptWebSocket(...args);
        };
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    this.session = new Session(testState, env);
  }

  track(promise) {
    this.callbacks.add(promise);
    promise.then(() => this.callbacks.delete(promise), () => this.callbacks.delete(promise));
    return promise;
  }

  recorder() {
    return globalThis.__syncTranscriptRooms?.get(this.state.id.toString());
  }

  async fetch(request) {
    const control = new URL(request.url);
    if (control.pathname === '/__sync_test_atomic_batch_probe') {
      await this.state.storage.put('batch-probe-first', 'old');
      let error;
      try {
        await this.state.storage.put({'batch-probe-first': 'new', 'batch-probe-large': new Uint8Array(9_000_000)});
      } catch (failure) { error = String(failure); }
      const first = await this.state.storage.get('batch-probe-first');
      const large = await this.state.storage.get('batch-probe-large');
      await this.state.storage.delete(['batch-probe-first', 'batch-probe-large']);
      return Response.json({error, first, largeMissing: large === undefined});
    }
    if (control.pathname === '/__sync_test_message_timing') {
      return Response.json({messages: this.messageTimings, writes: this.operationWrites, transactions: this.operationTransactions, atomicBatches: this.operationAtomicBatches, rootWriteCalls: this.rootWriteCalls});
    }
    if (control.pathname === '/__sync_test_operation_archive') {
      if (control.searchParams.has('fail')) this.archiveFailure = control.searchParams.get('fail') === '1';
      // Test-only legacy migration seed: remove completion metadata and,
      // optionally, the archive while retaining the exact original pending row.
      const unwrapInlineReceipt = async key => {
        const value = await this.state.storage.get(key);
        if (Array.isArray(value) && value.length === 2 && value[0] === 0x53430001 && value[1] instanceof Uint8Array) await this.state.storage.put(key, [...value[1]]);
      };
      if (control.searchParams.has('seedStates')) {
        const rows = [...(await this.state.storage.list({prefix: 'o/'})).keys()].filter(key => !key.startsWith('o/!'));
        if (rows.length !== 3) throw new Error('archive reader seed requires exactly three pending rows');
        await unwrapInlineReceipt(rows[0]);
        await unwrapInlineReceipt(rows[1]);
        await this.state.storage.delete(`o/!archive-status-v1/${rows[0].slice(2)}`);
        await this.state.storage.put(`o/!archive-status-v1/${rows[1].slice(2)}`,
          [...new TextEncoder().encode(JSON.stringify({state: 'incomplete', attribution: null}))]);
        await this.state.storage.delete(`a/${rows[1].slice(2)}`);
      }
      if (control.searchParams.has('legacy')) {
        const pending = await this.state.storage.list({prefix: 'o/'});
        for (const key of pending.keys()) if (!key.startsWith('o/!')) await unwrapInlineReceipt(key);
        const rows = await this.state.storage.list({prefix: 'o/!archive-status-v1/'});
        for (const key of rows.keys()) await this.state.storage.delete(key);
        if (control.searchParams.get('legacy') === 'missing') {
          const archive = await this.state.storage.list({prefix: 'a/'});
          for (const key of archive.keys()) await this.state.storage.delete(key);
        }
      }
      return Response.json(this.operationWrites);
    }
    if (control.pathname === '/__sync_test_operation_chunks') {
      this.operationChunkFailure = Number(control.searchParams.get('failAt') ?? 0);
      return new Response(null, { status: 204 });
    }
    if (control.pathname === '/__sync_test_sqlite_row_limit') {
      const size = Number(control.searchParams.get('size'));
      if (control.searchParams.has('array')) {
        const bytes = Array(size).fill(255);
        await this.state.storage.put('row_limit_array_probe', bytes);
        const stored = await this.state.storage.get('row_limit_array_probe');
        await this.state.storage.delete('row_limit_array_probe');
        return Response.json({ array: Array.isArray(stored), length: stored.length,
          first: stored[0], last: stored.at(-1) });
      }
      this.state.storage.sql.exec('CREATE TABLE IF NOT EXISTS row_limit_probe (value BLOB)');
      try {
        this.state.storage.sql.exec('INSERT INTO row_limit_probe VALUES (?)', new Uint8Array(size));
        this.state.storage.sql.exec('DELETE FROM row_limit_probe');
        return new Response(null, { status: 204 });
      } catch (error) {
        return new Response(String(error), { status: 413 });
      }
    }
    if (control.pathname === '/__sync_test_accept_count') return Response.json(this.accepted);
    if (control.pathname === '/__sync_test_flush_alarm') {
      while (this.callbacks.size) await Promise.allSettled([...this.callbacks]);
      if (await this.state.storage.getAlarm() !== null || this.env.SYNC_TEST_HOLD_ALARMS) {
        // Model the runtime consuming the scheduled alarm before delivery.
        await this.state.storage.deleteAlarm();
        this.forceAlarm = true;
        try { await this.alarm(); } finally { this.forceAlarm = false; }
      }
      await this.recorder()?.drain();
      return new Response(null, { status: 204 });
    }
    if (control.pathname === '/__sync_test_forget_id') {
      this.recorder()?.begin({ in: 'seed', binding: 'storage', method: 'delete', args: ['DOCUMENT_ID'] });
      await this.state.storage.delete('DOCUMENT_ID');
      return new Response(null, { status: 204 });
    }
    if (control.pathname === '/__sync_test_alarm') return this.alarm();
    if (control.pathname === '/__sync_test_error') {
      await this.webSocketError(this.state.getWebSockets()[0], new Error('test socket error'));
      return new Response(null, { status: 204 });
    }
    if (control.pathname === '/__sync_test_dump') {
      return Response.json(await this.transcriptDump(control.searchParams.get('marker')));
    }
    const stop = request.headers.get('x-sync-test-stop-after');
    this.expireAfterAccept = stop?.startsWith('expire_after_accept:') ? Number(stop.split(':')[1]) * 1000 : 0;
    const recorder = this.recorder();
    let callback;
    if (recorder) {
      const url = new URL(request.url);
      const headers = Object.fromEntries(['origin', 'authorization', 'x-internal-auth-key', 'content-length', 'x-sync-test-stop-after']
        .filter(key => request.headers.has(key)).map(key => [key, request.headers.get(key)]));
      callback = recorder.begin({ in: 'fetch', method: request.method, path: url.pathname,
        query: url.search, headers, body_b64: b64(await request.clone().arrayBuffer()) });
    }
    globalThis.__syncTranscriptCurrent = recorder;
    let response;
    try {
      response = await this.track(this.session.fetch(request));
    } catch (error) {
      recorder?.record({ out: 'fetch_error', error: String(error) }, callback);
      throw error;
    }
    if (recorder) {
      const headers = Object.fromEntries([...response.headers].filter(([key]) => key === 'content-type' || key.startsWith('access-control-')));
      recorder.record({ out: 'response', status: response.status, headers,
        body_b64: response.status === 101 ? '' : b64(await response.clone().arrayBuffer()) }, callback);
    }
    return response;
  }

  async webSocketMessage(ws, message) {
    const recorder = this.recorder();
    recorder?.begin({ in: 'message', ws_id: this.state.getTags(ws)[0],
      ...(typeof message === 'string' ? { text: message } : { binary_b64: b64(message) }) });
    globalThis.__syncTranscriptCurrent = recorder;
    if (this.env.SYNC_TEST_MESSAGE_TIMING) {
      const start = performance.now();
      const bytes = typeof message === 'string' ? message.length : message.byteLength;
      try { return await this.track(this.session.webSocketMessage(ws, message)); }
      finally { this.messageTimings.push({start, end: performance.now(), bytes}); }
    }
    return this.track(this.session.webSocketMessage(ws, message));
  }

  async webSocketClose(ws, code, reason, clean) {
    const recorder = this.recorder();
    recorder?.begin({ in: 'close', ws_id: this.state.getTags(ws)[0], code, reason, clean });
    globalThis.__syncTranscriptCurrent = recorder;
    return this.track(this.session.webSocketClose(ws, code, reason, clean));
  }

  async webSocketError(ws, error) {
    const recorder = this.recorder();
    recorder?.begin({ in: 'error', ws_id: this.state.getTags(ws)[0] });
    globalThis.__syncTranscriptCurrent = recorder;
    return this.track(this.session.webSocketError(ws, error));
  }

  async alarm() {
    if (this.env.SYNC_TEST_HOLD_ALARMS && !this.forceAlarm) return new Response(null, { status: 204 });
    const recorder = this.recorder();
    const callback = recorder?.begin({ in: 'alarm' });
    globalThis.__syncTranscriptCurrent = recorder;
    const response = await this.track(this.session.alarm());
    recorder?.record({ out: 'alarm', status: response.status, body_b64: b64(await response.clone().arrayBuffer()) }, callback);
    return response;
  }

  async transcriptDump(marker) {
    while (this.callbacks.size) await Promise.allSettled([...this.callbacks]);
    await this.recorder()?.drain();
    const stored = [...await this.state.storage.list()];
    const storedValue = value => value instanceof Uint8Array || value instanceof ArrayBuffer
      ? {bytes_b64: b64(value)} : Array.isArray(value) ? value.map(storedValue) : value;
    const kv = stored.map(([key, value]) => [key, storedValue(value)]);
    // Match DurableKv::list_do_kv's Uint8Array conversion, while retaining
    // structured metadata separately for the typed RoomStorage replay.
    const kv_bytes = stored.map(([key, value]) => [key, {bytes_b64: b64(
      Array.isArray(value) && value.length === 2 && value[0] === 0x53430001 && value[1] instanceof Uint8Array
        ? value[1] : new Uint8Array(value))}]);
    const tables = this.state.storage.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'kv_store'").toArray();
    const sql = tables.length ? this.state.storage.sql.exec('SELECT id, chunk, data FROM kv_store ORDER BY id, chunk').toArray()
      .map(row => ({ ...row, data: { bytes_b64: b64(row.data) } })) : [];
    const d1 = {};
    for (const table of ['peer_user_map', 'blame']) {
      const key = table === 'peer_user_map' ? 'peer_id' : 'node_id';
      d1[table] = (await this.env.USER_PEER_MAPPING.prepare(`SELECT * FROM ${table} ORDER BY document_id, ${key}`).all()).results;
    }
    const snapshots = [];
    const namespace = this.env.SNAPSHOT_STORE_KV;
    let cursor;
    do {
      const page = await namespace.list({ cursor });
      for (const key of page.keys) snapshots.push([key.name, { bytes_b64: b64(await namespace.get(key.name, 'arrayBuffer')) }]);
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    const result = { room: this.state.id.toString(), out: 'dump', accepted: this.accepted, kv, kv_bytes, sql, d1, snapshots, alarm: await this.state.storage.getAlarm(), marker };
    this.recorder()?.record(result);
    return result;
  }
}
