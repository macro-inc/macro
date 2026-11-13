// Isolated physical-storage controls. worker-build never bundles this module.
import { DurableObject } from 'cloudflare:workers';
import worker, { DocumentSyncSession as Session } from '../build/worker/shim.mjs';

export default worker;

export class DocumentSyncSession extends DurableObject {
  constructor(state, env) {
    super(state, env);
    this.state = state;
    this.env = env;
    this.failure = null;
    this.events = [];
    this.sendFailure = null;
    const originals = new WeakMap();
    const storage = new Proxy(state.storage, {
      get: (target, method) => {
        if (['get', 'put', 'delete'].includes(method)) return (...args) => {
          const key = String(args[0]);
          this.events.push([method, key]);
          if (this.failure?.method === method && key.startsWith(this.failure.prefix)) {
            this.failure = null;
            throw new Error('injected physical storage failure');
          }
          return target[method](...args);
        };
        const value = Reflect.get(target, method, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const context = new Proxy(state, {
      get: (target, key) => {
        if (key === 'storage') return storage;
        if (key === 'getWebSockets') return (...args) => target.getWebSockets(...args).map(socket => {
          if (!this.sendFailure || target.getTags(socket)[0] !== this.sendFailure.id) return socket;
          const wrapped = new Proxy(socket, { get: (raw, method) => {
            if (method === 'send') return (...sendArgs) => {
              this.sendFailure.count += 1;
              if (this.sendFailure.count === this.sendFailure.nth) throw new Error('injected receiver send failure');
              return raw.send(...sendArgs);
            };
            const value = Reflect.get(raw, method, raw);
            return typeof value === 'function' ? value.bind(raw) : value;
          } });
          originals.set(wrapped, socket);
          return wrapped;
        });
        if (key === 'getTags') return socket => target.getTags(originals.get(socket) ?? socket);
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    this.session = new Session(context, env);
  }
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/__reader_test_seed') {
      for (const row of await request.json()) {
        if (!/^(?:o\/|a\/|operation-chunks\/|SYNC_FANOUT_DEBT$)/.test(row.key)) throw new Error('invalid test key');
        const bytes = new Uint8Array(row.bytes);
        await this.state.storage.put(row.key, row.kind === 'tuple' ? [row.tag ?? 0x53430001, bytes] : row.kind === 'array' ? row.bytes : bytes);
      }
      return new Response(null, { status: 204 });
    }
    if (path === '/__reader_test_value') {
      const key = new URL(request.url).searchParams.get('key');
      if (key !== 'SYNC_FANOUT_DEBT') throw new Error('invalid test key');
      const value = await this.state.storage.get(key);
      return Response.json(value === undefined ? null : [...value]);
    }
    if (path === '/__reader_test_dump') {
      const rows = [...await this.state.storage.list()];
      const history = [];
      for (const [key, value] of rows) {
        if (!/^(?:o\/|a\/|actor\/|operation-chunks\/|SYNC_FANOUT_DEBT$)/.test(key)) continue;
        const tuple = Array.isArray(value) && value.length === 2 && value[0] === 0x53430001;
        const bytes = new Uint8Array(tuple ? value[1] : value);
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
        history.push({ key, kind: tuple ? 'tuple' : Array.isArray(value) ? 'array' : 'bytes',
          tag: tuple ? value[0] : null, bytes: bytes.length,
          sha256: [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('') });
      }
      return Response.json({ keys: rows.map(([key]) => key), history, events: this.events, sockets: this.state.getWebSockets().map(socket => this.state.getTags(socket)[0]) });
    }
    if (path === '/__reader_test_send_failure') {
      this.sendFailure = { ...await request.json(), count: 0 };
      return new Response(null, { status: 204 });
    }
    if (path === '/__reader_test_fault') {
      this.failure = await request.json();
      return new Response(null, { status: 204 });
    }
    if (path === '/__reader_test_events_reset') {
      this.events.length = 0;
      return new Response(null, { status: 204 });
    }
    if (path === '/__reader_test_alarm') return this.session.alarm();
    return this.session.fetch(request);
  }
  webSocketMessage(...args) { return this.session.webSocketMessage(...args); }
  webSocketClose(...args) { return this.session.webSocketClose(...args); }
  webSocketError(...args) { return this.session.webSocketError(...args); }
  alarm() {
    if (this.env.SYNC_TEST_HOLD_ALARMS) return new Response(null, { status: 204 });
    return this.session.alarm();
  }
}
