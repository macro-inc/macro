// Installed only by the `transcript` Cargo feature. Calls retain native receivers,
// arguments, return values and errors; no clocks or entropy are substituted.
const rooms = new Map();
const socketIds = new WeakMap();
const originalSend = WebSocket.prototype.send;
const originalClose = WebSocket.prototype.close;
let installedSockets = false;
let activeContext;

function bytes(value) {
  const view = value instanceof ArrayBuffer ? new Uint8Array(value) : value;
  let text = '';
  for (const byte of view) text += String.fromCharCode(byte);
  return btoa(text);
}

function valueOf(value) {
  if (value === undefined) return { undefined: true };
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return { bytes_b64: bytes(new Uint8Array(value.buffer ?? value, value.byteOffset ?? 0, value.byteLength)) };
  }
  if (value instanceof Date) return { date_ms: value.getTime() };
  if (value instanceof Map) return [...value].map(([key, value]) => [key, valueOf(value)]);
  if (Array.isArray(value)) return value.map(valueOf);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, value]) => [key, valueOf(value)]));
  }
  if (typeof value === 'bigint') return value.toString();
  return value;
}

function proxyMethods(target, port, record, special = {}) {
  return new Proxy(target, {
    get(target, key) {
      if (Object.hasOwn(special, key)) return special[key];
      if (key === "constructor") return Reflect.get(target, key, target);
      const value = Reflect.get(target, key, target);
      if (typeof value !== 'function') return value;
      return (...args) => {
        const context = record.context();
        record({ port: `${port}.${String(key)}`, args: valueOf(args) }, context);
        try {
          const result = Reflect.apply(value, target, args);
          if (result instanceof Promise) {
            return result.then(result => {
              record({ return: `${port}.${String(key)}`, value: valueOf(result) }, context);
              return result;
            }, error => {
              record({ throw: `${port}.${String(key)}`, error: String(error) }, context);
              throw error;
            });
          }
          // SQL cursors remain native and are read by the worker as before.
          return result;
        } catch (error) {
          record({ throw: `${port}.${String(key)}`, error: String(error) }, context);
          throw error;
        }
      };
    },
  });
}

export function observePorts(state, env, emit) {
  const room = state.id.toString();
  let callback = 0;
  const pending = new Set();
  const context = () => activeContext?.room === room ? activeContext.callback : callback;
  const record = (event, callbackId = context()) => emit(JSON.stringify({ room, callback: callbackId, ...event }));
  record.context = context;
  rooms.set(room, {
    record,
    async drain() { while (pending.size) await Promise.allSettled([...pending]); },
    begin(event) {
      callback += 1;
      record({ ...event, unix_ms: Date.now(), monotonic_ms: performance.now() });
      return callback;
    },
  });
  globalThis.__syncTranscriptRooms = rooms;
  record({ in: 'new', unix_ms: Date.now(), monotonic_ms: performance.now() });

  if (!installedSockets) {
    installedSockets = true;
    WebSocket.prototype.send = function(data) {
      const socket = socketIds.get(this);
      socket?.record(typeof data === 'string'
        ? { out: 'send_text', ws_id: socket.id, text: data }
        : { out: 'send', ws_id: socket.id, frame_b64: bytes(data) });
      try {
        return Reflect.apply(originalSend, this, [data]);
      } catch (error) {
        socket?.record({ throw: 'connections.send', ws_id: socket.id, error: String(error) });
        throw error;
      }
    };
    WebSocket.prototype.close = function(code, reason) {
      const socket = socketIds.get(this);
      socket?.record({ out: 'close', ws_id: socket.id, code, reason });
      try {
        return Reflect.apply(originalClose, this, arguments);
      } catch (error) {
        socket?.record({ throw: 'connections.close', ws_id: socket.id, error: String(error) });
        throw error;
      }
    };
  }

  function remember(ws) {
    const [id] = state.getTags(ws);
    socketIds.set(ws, { id, record });
    return ws;
  }
  for (const ws of state.getWebSockets()) remember(ws);

  let nextTransaction = 0;
  const storage = proxyMethods(state.storage, 'storage', record, {
    transaction(callback) {
      const transaction = nextTransaction++;
      const callbackId = record.context();
      let attempt = 0;
      record({ port: 'storage.transaction', args: [], transaction }, callbackId);
      try {
        const result = state.storage.transaction(native => {
          const currentAttempt = attempt++;
          const observed = (event) => record({ ...event, transaction, attempt: currentAttempt }, callbackId);
          observed.context = () => callbackId;
          observed({ port: 'storage.transaction.begin', args: [] });
          return callback(proxyMethods(native, 'storage.transaction', observed));
        });
        return result.then(value => {
          record({ return: 'storage.transaction', value: valueOf(value), transaction }, callbackId);
          return value;
        }, error => {
          record({ throw: 'storage.transaction', error: String(error), transaction }, callbackId);
          throw error;
        });
      } catch (error) {
        record({ throw: 'storage.transaction', error: String(error), transaction }, callbackId);
        throw error;
      }
    },
    sql: proxyMethods(state.storage.sql, 'sql', record),
  });
  const observedState = proxyMethods(state, 'state', record, {
    storage,
    getWebSockets(...args) {
      const sockets = state.getWebSockets(...args).map(remember);
      record({ port: 'connections.list', args, ws_ids: sockets.map(ws => socketIds.get(ws).id) });
      return sockets;
    },
    getTags(ws) {
      const tags = state.getTags(ws);
      record({ port: 'connections.tags', tags });
      return tags;
    },
    acceptWebSocket(ws, tags) {
      record({ out: 'accept', ws_id: tags?.[0] });
      const result = state.acceptWebSocket(ws, tags);
      remember(ws);
      return result;
    },
    waitUntil(promise) {
      record({ port: 'wait_until' });
      pending.add(promise);
      promise.then(() => pending.delete(promise), () => pending.delete(promise));
      return state.waitUntil(promise);
    },
  });

  const bindings = new Map();
  for (const name of ['SNAPSHOT_STORE_KV', 'DOCUMENT_VERSIONING_KV', 'DOCUMENT_SNAPSHOT_BUCKET']) {
    if (env[name]) bindings.set(name, proxyMethods(env[name], name, record));
  }
  if (env.USER_PEER_MAPPING) {
    const db = env.USER_PEER_MAPPING;
    const statements = new WeakMap();
    const statement = (native, sql, params = []) => {
      const proxy = proxyMethods(native, 'd1', record, {
      bind(...args) { return statement(native.bind(...args), sql, args); },
      async run(...args) {
        record({ port: 'd1.run', sql, params: valueOf(params) });
        return native.run(...args);
      },
      async first(...args) {
        const context = record.context();
        record({ port: 'd1.first', sql, params: valueOf(params), args: valueOf(args) }, context);
        const result = await native.first(...args);
        record({ return: 'd1.first', value: valueOf(result) }, context);
        return result;
      },
      async all(...args) {
        const context = record.context();
        record({ port: 'd1.all', sql, params: valueOf(params) }, context);
        const result = await native.all(...args);
        record({ return: 'd1.all', value: valueOf(result.results) }, context);
        return result;
      },
      });
      statements.set(proxy, { native, sql, params });
      return proxy;
    };
    bindings.set('USER_PEER_MAPPING', proxyMethods(db, 'd1', record, {
      prepare(sql) { return statement(db.prepare(sql), sql); },
      batch(batch) {
        const entries = batch.map(item => statements.get(item));
        record({ port: 'd1.batch', statements: entries.map(({ sql, params }) => ({ sql, params: valueOf(params) })) });
        return db.batch(entries.map(({ native }) => native));
      },
    }));
  }
  return [observedState, new Proxy(env, {
    get(target, key) { return bindings.get(key) ?? Reflect.get(target, key, target); },
  })];
}

export function clockRead(room, kind, value) {
  // Rust clock sites run inside the currently executing DO callback. The test
  // adapter sets this only while calling into the actual worker.
  rooms.get(room)?.record({ clock: kind, value });
}

export function getCallback(room) { return rooms.get(room)?.record.context() ?? 0; }
export function enterCallback(room, callback) {
  const previous = activeContext;
  activeContext = { room, callback };
  return previous;
}
export function leaveCallback(previous) { activeContext = previous; }
