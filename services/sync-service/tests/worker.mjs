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

export default class TestWorker extends worker {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/__sync_test_evict') {
      const namespace = this.env.DOCUMENT_SYNC_SESSION;
      const stub = namespace.get(namespace.idFromString(url.searchParams.get('room')));
      await workerdUnsafe.evict(stub, { webSockets: 'hibernate' });
      return new Response(null, { status: 204 });
    }
    return super.fetch(request);
  }
}
export class DocumentSyncSession extends DurableObject {
  constructor(state, env) {
    super(state, env);
    this.state = state;
    this.env = env;
    this.callbacks = new Set();
    this.session = new Session(state, env);
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
    if (control.pathname === '/__sync_test_dump') {
      return Response.json(await this.transcriptDump(control.searchParams.get('marker')));
    }
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
    recorder?.begin({ in: 'alarm' });
    globalThis.__syncTranscriptCurrent = recorder;
    return this.track(this.session.alarm());
  }

  async transcriptDump(marker) {
    while (this.callbacks.size) await Promise.allSettled([...this.callbacks]);
    await this.recorder()?.drain();
    const kv = [...await this.state.storage.list()].map(([key, value]) => [key,
      value instanceof Uint8Array || value instanceof ArrayBuffer ? { bytes_b64: b64(value) } : value]);
    const tables = this.state.storage.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'kv_store'").toArray();
    const sql = tables.length ? this.state.storage.sql.exec('SELECT id, chunk, data FROM kv_store ORDER BY id, chunk').toArray()
      .map(row => ({ ...row, data: { bytes_b64: b64(row.data) } })) : [];
    const d1 = {};
    for (const table of ['peer_user_map', 'blame']) {
      d1[table] = (await this.env.USER_PEER_MAPPING.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results;
    }
    const snapshots = [];
    const namespace = this.env.SNAPSHOT_STORE_KV;
    let cursor;
    do {
      const page = await namespace.list({ cursor });
      for (const key of page.keys) snapshots.push([key.name, { bytes_b64: b64(await namespace.get(key.name, 'arrayBuffer')) }]);
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    const result = { room: this.state.id.toString(), out: 'dump', kv, sql, d1, snapshots, marker };
    this.recorder()?.record(result);
    return result;
  }
}
