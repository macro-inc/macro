import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { EphemeralStore } from 'loro-crdt';
import { FromPeer, FromRemote } from '../bebop/generated/schema.ts';

function files(root) {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map(entry => join(entry.parentPath, entry.name)).sort();
}

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, ordered(value)]));
  }
  return value;
}

// Only awareness timestamps may be discarded inside binary messages. Preserve
// the remaining encoded payload and each original envelope/chunk boundary.
function awarenessFrames(entries) {
  const pending = new Map();
  for (const entry of entries) {
    if (entry.in === 'new') {
      for (const key of pending.keys()) if (key.startsWith(`${entry.room}:`)) pending.delete(key);
    }
    const field = entry.in === 'message' ? 'binary_b64' : entry.out === 'send' ? 'frame_b64' : undefined;
    if (!field || !entry[field]) continue;
    const key = `${entry.room}:${entry.ws_id}:${field}`;
    const chunks = pending.get(key) ?? [];
    const bytes = Buffer.from(entry[field], 'base64');
    if (!bytes.length) continue;
    chunks.push({ entry, bytes });
    pending.set(key, chunks);
    if (bytes[0] !== 1) continue;
    pending.delete(key);
    let decoded;
    try {
      const payload = Buffer.concat(chunks.map(chunk => chunk.bytes.subarray(1)));
      decoded = field === 'binary_b64' ? FromPeer.decode(payload) : FromRemote.decode(payload);
    } catch { continue; }
    const awareness = decoded.value?.awareness;
    if (!awareness) continue;
    const store = new EphemeralStore(Number.MAX_SAFE_INTEGER);
    store.inner.apply(awareness);
    const states = store.getAllStates();
    store.inner.free();
    const value = { ...decoded.value, awareness: new Uint8Array() };
    let withoutAwareness;
    if (decoded.isRemoteInitialSync?.()) withoutAwareness = FromRemote.fromRemoteInitialSync(value);
    else if (decoded.isRemoteAwareness?.()) withoutAwareness = FromRemote.fromRemoteAwareness(value);
    else if (decoded.isPeerAwareness?.()) withoutAwareness = FromPeer.fromPeerAwareness(value);
    else continue;
    for (const chunk of chunks) {
      delete chunk.entry[field];
      chunk.entry.frame = { header: chunk.bytes[0], length: chunk.bytes.length };
    }
    entry.payload_without_awareness_b64 = Buffer.from(withoutAwareness.encode()).toString('base64');
    entry.awareness = states;
  }
}

/** Normalize recorded entropy/time references, retaining raw fixtures for replay. */
export function normalize(lines) {
  const entries = lines.filter(line => line.trim()).map(line => JSON.parse(line));
  const expirations = new Set();
  for (const entry of entries) {
    if (!entry.in) continue;
    for (const token of JSON.stringify(entry).match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? []) {
      try { expirations.add(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).exp); } catch {}
    }
  }
  // A stored expiry must belong to this socket's grant, even when another
  // recorded grant happens to contain the incorrect value.
  const grants = new Map();
  const socketExpirations = new Map();
  for (const entry of entries) {
    if (entry.in === 'fetch') {
      const token = entry.query?.match(/(?:\?|&)token=([^&]+)/)?.[1];
      if (token) {
        try { grants.set(entry.room, JSON.parse(Buffer.from(decodeURIComponent(token).split('.')[1], 'base64url').toString()).exp); } catch {}
      }
    }
    if (entry.out === 'accept') socketExpirations.set(entry.ws_id, grants.get(entry.room));
  }
  function checkSocketExpiry(key, value) {
    const expected = socketExpirations.get(key);
    if (expected !== undefined && value?.expires_at !== undefined && value.expires_at !== expected) {
      value.expires_at = { invalid_expiry: value.expires_at };
    }
  }
  for (const entry of entries) {
    if (entry.port === 'storage.put') checkSocketExpiry(entry.args?.[0], entry.args?.[1]);
    if (entry.out === 'dump') for (const [key, value] of entry.kv) checkSocketExpiry(key, value);
  }
  awarenessFrames(entries);
  // Different callbacks may interleave at await points. Compare each callback's
  // ordered effects, and retain an independent per-socket wire-order check.
  const socketOrder = entries.filter(entry => ['send', 'send_text', 'close'].includes(entry.out));
  const rooms = new Map();
  const generations = new Map();
  for (const entry of entries) {
    if (!rooms.has(entry.room)) rooms.set(entry.room, rooms.size);
    if (entry.in === 'new') generations.set(entry.room, (generations.get(entry.room) ?? -1) + 1);
    entry.generation = generations.get(entry.room) ?? 0;
  }
  entries.sort((a, b) => rooms.get(a.room) - rooms.get(b.room) || a.generation - b.generation || (a.callback ?? 0) - (b.callback ?? 0));
  const sockets = new Map();
  const operationTimes = new Set(entries.filter(entry => entry.clock === 'op_id_nanos').map(entry => BigInt(entry.value).toString(16)));
  const operations = new Map();
  const blameTimes = new Map();
  const alarms = new Map();
  const alarmClocks = new Map();
  let currentRoom;
  const instants = new Map();
  let clockIndex = 0;
  for (const entry of entries) {
    if (!entry.clock) continue;
    if (entry.clock === 'blame_ms') blameTimes.set(String(entry.value), `<clock:${clockIndex}>`);
    clockIndex += 1;
  }
  clockIndex = 0;

  function text(value) {
    let result = value.replace(/expire_after_accept:(\d+)/g, (value, expiry) => expirations.has(Number(expiry)) ? 'expire_after_accept:<expires>' : value).replace(/http:\/\/127\.0\.0\.1:\d+/g, 'http://127.0.0.1:<port>').replace(/ws_id[0-9a-f-]{36}/g, id => {
      if (!sockets.has(id)) sockets.set(id, `ws_id<${sockets.size}>`);
      return sockets.get(id);
    });
    result = result.replace(/([0-9a-f]{16})\.([0-9a-f]{8})/g, (id, time, counter) => {
      if (!operationTimes.has(time.replace(/^0+/, ''))) return id;
      if (!operations.has(id)) operations.set(id, `op<${operations.size}>.${counter}`);
      return operations.get(id);
    });
    // JWT entropy is input data: compare the actual claims and validity window,
    // while retaining the original signed token in the replay fixture.
    result = result.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, token => {
      const [header, payload] = token.split('.');
      try {
        const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
        if (claims.iat !== undefined) claims.iat = '<issued>';
        if (claims.exp !== undefined) claims.exp = '<expires>';
        return `jwt(${header},${JSON.stringify(ordered(claims))})`;
      } catch { return token; }
    });
    return result;
  }
  function visit(value, key) {
    if (typeof value === 'string') return text(value);
    if (Array.isArray(value)) return value.map(item => visit(item));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item, key)]));
    }
    if (key === 'expires_at' && expirations.has(value)) return '<expires>';
    if (key === 'timestamp_ms' && blameTimes.has(String(value))) return blameTimes.get(String(value));
    if (key === 'date_ms') return alarms.get(`${currentRoom}:${value}`) ?? value;
    return value;
  }
  const normalized = entries.map(entry => {
    currentRoom = entry.room;
    delete entry.marker;
    if (entry.clock) {
      if (entry.clock === 'alarm_set_ms') alarmClocks.set(entry.room, Number(entry.value));
      if (entry.clock === 'state_instant') {
        const previous = instants.get(entry.room);
        const value = BigInt(entry.value);
        if (previous !== undefined) entry.ordering_to_previous = value === previous ? 'equal' : value > previous ? 'after' : 'before';
        instants.set(entry.room, value);
      }
      if (entry.clock === 'blame_ms') blameTimes.set(String(entry.value), `<clock:${clockIndex}>`);
      clockIndex += 1;
      delete entry.value;
    }
    if (entry.in) {
      delete entry.unix_ms;
      delete entry.monotonic_ms;
    }
    if (entry.port === 'storage.setAlarm') {
      const deadline = entry.args[0].date_ms;
      const now = alarmClocks.get(entry.room);
      if (now !== undefined) alarms.set(`${entry.room}:${deadline}`, { alarm: alarms.size, delay_ms: deadline - now });
    }
    if (entry.return === 'storage.getAlarm' && typeof entry.value === 'number') {
      entry.value = alarms.get(`${entry.room}:${entry.value}`) ?? entry.value;
    }
    if (entry.port === 'd1.batch') {
      for (const statement of entry.statements) {
        if (statement.sql.includes('INSERT INTO blame')) {
          const time = String(statement.params[3]);
          if (blameTimes.has(time)) statement.params[3] = blameTimes.get(time);
        }
      }
    }
    if (entry.out === 'response' && entry.headers?.['content-type']?.includes('json')) {
      const body = text(Buffer.from(entry.body_b64, 'base64').toString()).replace(/(\"timestamp_ms\"\s*:\s*)(\d+)/g, (match, prefix, value) => blameTimes.has(value) ? prefix + JSON.stringify(blameTimes.get(value)) : match);
      entry.body_b64 = Buffer.from(body).toString('base64');
    }
    const normalized = visit(entry);
    if (entry.out === 'dump') {
      normalized.kv.sort(([a], [b]) => a.localeCompare(b));
      normalized.kv_bytes?.sort(([a], [b]) => a.localeCompare(b));
      if (typeof normalized.alarm === 'number') normalized.alarm = alarms.get(`${entry.room}:${normalized.alarm}`) ?? normalized.alarm;
    }
    return JSON.stringify(ordered(normalized));
  });
  const outputs = new Map();
  for (const entry of socketOrder) {
    const key = text(`${entry.room}:${entry.ws_id}`);
    const values = outputs.get(key) ?? [];
    values.push(ordered(visit(entry)));
    outputs.set(key, values);
  }
  normalized.push(JSON.stringify({ socket_order: Object.fromEntries(outputs) }));
  return normalized.join('\n') + '\n';
}


function corpus(root) {
  if (root.startsWith('git:')) {
    const revision = root.slice(4);
    const prefix = 'services/sync-service/tests/transcripts/';
    const paths = execFileSync('git', ['ls-tree', '--full-tree', '-r', '--name-only', revision, '--', prefix], { encoding: 'utf8' }).trim().split('\n').filter(path => path.endsWith('.jsonl'));
    return new Map(paths.map(path => [path.slice(prefix.length), normalize(execFileSync('git', ['show', `${revision}:${path}`], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).split('\n'))]));
  }
  return new Map(files(root).map(path => [relative(root, path), normalize(readFileSync(path, 'utf8').split('\n'))]));
}

export function compare(expected, actual) {
  const left = corpus(expected);
  const right = corpus(actual);
  const differences = [];
  for (const path of new Set([...left.keys(), ...right.keys()])) {
    if (left.get(path) === right.get(path)) continue;
    const a = (left.get(path) ?? '').split('\n');
    const b = (right.get(path) ?? '').split('\n');
    const line = a.findIndex((value, index) => value !== b[index]);
    differences.push(`${path}:${line < 0 ? a.length : line + 1}\nexpected: ${a[line]?.slice(0, 1000)}\nactual: ${b[line]?.slice(0, 1000)}`);
  }
  return differences;
}
