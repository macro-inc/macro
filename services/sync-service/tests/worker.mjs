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
    this.callbacks = new Set();
    this.accepted = 0;
    this.expireAfterAccept = 0;
    const storage = new Proxy(state.storage, {
      get: (target, key) => {
        if (key === 'constructor') return Reflect.get(target, key, target);
        if (key === 'put') return (...args) => {
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
    if (control.pathname === '/__sync_test_accept_count') return Response.json(this.accepted);
    if (control.pathname === '/__sync_test_flush_alarm') {
      while (this.callbacks.size) await Promise.allSettled([...this.callbacks]);
      if (await this.state.storage.getAlarm() !== null) {
        // Model the runtime consuming the scheduled alarm before delivery.
        await this.state.storage.deleteAlarm();
        await this.alarm();
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
    const kv = stored.map(([key, value]) => [key,
      value instanceof Uint8Array || value instanceof ArrayBuffer ? { bytes_b64: b64(value) } : value]);
    // Match DurableKv::list_do_kv's Uint8Array conversion, while retaining
    // structured metadata separately for the typed RoomStorage replay.
    const kv_bytes = stored.map(([key, value]) => [key, { bytes_b64: b64(new Uint8Array(value)) }]);
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
