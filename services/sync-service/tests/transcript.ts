import { createInterface } from 'node:readline';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { Readable } from 'node:stream';
import type { Miniflare, WebSocket } from 'miniflare';
import { beforeEach, onTestFinished, expect } from 'vitest';

type Entry = Record<string, unknown>;
type Capture = {
  entries: Entry[];
  rooms: Set<string>;
  written: number;
  waiters: Map<string, () => void>;
  disposeAfterTest: boolean;
  disposed: boolean;
  historyKey?: string;
  connectionCounts: Map<string, number>;
  seedIndex: number;
  queue: Promise<unknown>;
  closed: Set<unknown>;
  sockets: Map<WebSocket, { resolve?: () => void; path: string; query: string; ordinal: number; consume?: boolean }>;
};
const captures = new Map<Miniflare, Capture>();
const socketCaptures = new WeakMap<WebSocket, Capture>();

/** Give recorded inputs a fixed delivery order across sockets and HTTP. */
export function sendRecordedInput(socket: WebSocket, send: () => void, ping: boolean) {
  const capture = socketCaptures.get(socket);
  if (!capture) return send();
  capture.queue = capture.queue.then(async () => {
    const fence = capture.sockets.get(socket);
    if (!fence || capture.closed.has(socketId(capture, fence))) return send();
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Recorded input fence timed out')), 5000);
      fence.consume = !ping;
      fence.resolve = () => { clearTimeout(timeout); resolve(); };
      send();
      if (!ping) socket.send('ping');
    });
  });
}

/** Close one recorded input at a time, waiting for its server callback to start. */
export async function closeRecordedInput(socket: WebSocket) {
  const capture = socketCaptures.get(socket);
  if (!capture) { socket.close(); return; }
  await capture.queue;
  const fence = capture.sockets.get(socket);
  if (!fence) return;
  const id = socketId(capture, fence);
  socket.close();
  for (let attempt = 0; !capture.closed.has(id); attempt += 1) {
    if (attempt === 1000) throw new Error(`Missing recorded close callback for ${String(id)}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

/** Wait for actual alarm completions rather than racing a wall-clock sleep. */
export async function recordedAlarms(mf: Miniflare, documentId: string, count: number) {
  const capture = captures.get(mf)!;
  for (let attempt = 0; attempt < 2500; attempt += 1) {
    const room = capture.entries.find(entry => entry.in === 'fetch' && entry.room !== '@worker' && entry.path === `/document/${documentId}/connect`)?.room;
    if (room && capture.entries.filter(entry => entry.room === room && entry.out === 'alarm').length >= count) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Recorded alarm deadline exceeded');
}

async function completed<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Transcript did not finish ${label}`)), 5000);
    })]);
  } finally { clearTimeout(timer!); }
}

function socketId(capture: Capture, fence: { path: string; query: string; ordinal: number }) {
  const accepts = capture.entries.flatMap((entry, index) => {
    if (entry.out !== 'accept') return [];
    const input = capture.entries.slice(0, index).findLast(candidate => candidate.room === entry.room && candidate.in === 'fetch');
    return input?.path === fence.path && input?.query === fence.query ? [entry] : [];
  });
  return accepts[fence.ordinal]?.ws_id;
}

async function dump(mf: Miniflare, capture: Capture) {
  await capture.queue;
  // A ping/pong fence drains client messages already sent before the scenario
  // ended. Its listener precedes application listeners, so shared test clients
  // never see the fence's pong in their own receive queue.
  for (const [socket, fence] of capture.sockets) {
    if (capture.closed.has(socketId(capture, fence))) continue;
    if (socket.readyState !== 1) continue;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Transcript socket fence timed out')), 5000);
      fence.consume = true;
      fence.resolve = () => { clearTimeout(timeout); resolve(); };
      socket.send('ping');
    });
  }
  for (const [socket, fence] of capture.sockets) {
    const id = socketId(capture, fence);
    if (capture.closed.has(id)) continue;
    if (socket.readyState === 1) socket.close(1000, 'transcript scenario complete');
    for (let attempt = 0; !capture.closed.has(id); attempt += 1) {
      if (attempt === 1000) throw new Error(`Missing close callback for ${String(id)}`);
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  }
  for (const room of capture.rooms) {
    await completed(mf.dispatchFetch(`http://sync-test/__sync_test_flush_alarm?room=${room}`), `alarm flush for ${room}`);
    const marker = `${capture.entries.length}:${room}`;
    const received = new Promise<void>(resolve => capture.waiters.set(marker, resolve));
    const response = await completed(mf.dispatchFetch(`http://sync-test/__sync_test_dump?room=${room}&marker=${encodeURIComponent(marker)}`), `dump for ${room}`);
    await completed(response.json(), `body for ${room}`);
    await completed(received, `stdout for ${room}`);
    capture.waiters.delete(marker);
  }
}

function seedValue(value: unknown): unknown {
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return { bytes_b64: Buffer.from(bytes).toString('base64') };
  }
  if (Array.isArray(value)) return value.map(seedValue);
  return value;
}

function facade<T extends object>(target: T, overrides: Record<string, unknown>): T {
  return new Proxy(target, {
    get(target, key) {
      if (key === 'then') return undefined;
      if (typeof key === 'string' && Object.hasOwn(overrides, key)) return overrides[key];
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/** Capture only the feature's dedicated tracing target; preserve line order. */
export function runtimeCapture(disposeAfterTest: boolean, historyKey?: string) {
  const capture: Capture = {
    entries: [], rooms: new Set(), written: 0, waiters: new Map(), disposeAfterTest, disposed: false, sockets: new Map(), historyKey, connectionCounts: new Map(), seedIndex: 0, queue: Promise.resolve(), closed: new Set(),
  };
  return {
    attach(mf: Miniflare) {
      captures.set(mf, capture);
      const seed = (binding: string, method: string, args: unknown[]) => capture.entries.push({
        in: 'seed', room: '@harness', callback: capture.seedIndex++, binding, method,
        args: args.map(seedValue), unix_ms: Date.now(), monotonic_ms: performance.now(),
      });
      const getKV = mf.getKVNamespace.bind(mf);
      mf.getKVNamespace = async (...args: Parameters<typeof getKV>) => {
        const native = await getKV(...args);
        return facade(native, {
          put: (...values: Parameters<typeof native.put>) => {
            seed(args[0], 'put', values);
            return native.put(...values);
          },
          delete: (...values: Parameters<typeof native.delete>) => {
            seed(args[0], 'delete', values);
            return native.delete(...values);
          },
        });
      };
      const getD1 = mf.getD1Database.bind(mf);
      mf.getD1Database = async (...args: Parameters<typeof getD1>) => {
        const native = await getD1(...args);
        type Statement = ReturnType<typeof native.prepare>;
        const statement = (prepared: Statement, sql: string, params: unknown[] = []): Statement => facade(prepared, {
          bind: (...values: Parameters<Statement['bind']>) => statement(prepared.bind(...values), sql, values),
          run: () => {
            seed(args[0], 'run', [sql, params]);
            return prepared.run();
          },
        });
        return facade(native, { prepare: (sql: string) => statement(native.prepare(sql), sql) });
      };
      const dispatch = mf.dispatchFetch.bind(mf);
      mf.dispatchFetch = (...args: Parameters<typeof dispatch>) => {
        const body = args[1]?.body;
        if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
          const copy = body instanceof ArrayBuffer ? new Uint8Array(body).slice() : new Uint8Array(body.buffer, body.byteOffset, body.byteLength).slice();
          args[1] = { ...args[1], body: copy };
        }
        const pending = capture.queue.then(async () => {
        const response = await dispatch(...args);
        const socket = response.webSocket;
        if (socket) {
          const url = new URL(typeof args[0] === 'string' ? args[0] : args[0].url);
          const key = url.pathname + url.search;
          const ordinal = capture.connectionCounts.get(key) ?? 0;
          capture.connectionCounts.set(key, ordinal + 1);
          const fence = { path: url.pathname, query: url.search, ordinal, consume: false, resolve: undefined as (() => void) | undefined };
          capture.sockets.set(socket, fence);
          socketCaptures.set(socket, capture);
          socket.addEventListener('message', event => {
            if (event.data !== 'pong' || !fence.resolve) return;
            if (fence.consume) event.stopImmediatePropagation();
            const resolve = fence.resolve;
            delete fence.resolve;
            resolve();
          });
          socket.addEventListener('close', () => {
            fence.resolve?.();
            capture.sockets.delete(socket);
          });
        }
        return response;
        });
        capture.queue = pending.then(() => undefined);
        return pending;
      };
      const dispose = mf.dispose.bind(mf);
      mf.dispose = async () => {
        if (capture.disposed) return;
        let failure: { error: unknown } | undefined;
        try { await dump(mf, capture); }
        catch (error) { failure = { error }; }
        finally {
          capture.disposed = true;
          try { await dispose(); }
          catch (error) {
            if (failure) throw new AggregateError([failure.error, error], 'Capture and runtime disposal failed');
            throw error;
          }
        }
        if (failure) throw failure.error;
      };
    },
    stdio(stdout: Readable, stderr: Readable) {
      for (const stream of [stdout, stderr]) {
        createInterface({ input: stream }).on('line', line => {
          if (process.env.SYNC_RECORD_DEBUG === '1') process.stderr.write(`${line}\n`);
          const start = line.indexOf('{');
          if (start < 0) return;
          let record: Entry;
          try { record = JSON.parse(line.slice(start)); } catch { return; }
          if (record.target !== 'sync_transcript') return;
          const fields = record.fields as { transcript?: string };
          if (!fields?.transcript) return;
          const entry: Entry = JSON.parse(fields.transcript);
          capture.entries.push(entry);
          if (entry.out === 'close' || entry.in === 'close') {
            capture.closed.add(entry.ws_id);
            for (const fence of capture.sockets.values()) {
              if (socketId(capture, fence) === entry.ws_id) fence.resolve?.();
            }
          }
          if (typeof entry.marker === 'string') capture.waiters.get(entry.marker)?.();
          if (typeof entry.room === 'string' && entry.room !== '@worker') capture.rooms.add(entry.room);
        });
      }
    },
  };
}

function fileName(value: string) {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, '_');
}

if (process.env.SYNC_RECORD === '1') {
  beforeEach(() => {
    const state = { ...expect.getState() };
    onTestFinished(async () => {
      await Promise.all([...captures.values()].map(capture => capture.queue));
      const entries: Entry[] = [];
      const changed = [...captures.values()].filter(capture => capture.entries.length !== capture.written);
      const histories = new Set(changed.flatMap(capture => capture.historyKey ? [capture.historyKey] : []));
      for (const [mf, capture] of captures) {
        if (capture.entries.length === capture.written && !histories.has(capture.historyKey!)) continue;
        if (!capture.disposed) {
          if (capture.disposeAfterTest) await mf.dispose();
          else await dump(mf, capture);
        }
        // Include a shared runtime's preceding inputs so every fixture replays
        // independently, including tests which reuse a beforeAll instance.
        entries.push(...capture.entries);
        capture.written = capture.entries.length;
        if (capture.disposed && !capture.historyKey) captures.delete(mf);
      }
      if (!entries.length) return;
      const directory = join(process.env.SYNC_TRANSCRIPT_DIR ?? '../../crates/sync_server_sim/tests/transcripts', basename(state.testPath ?? 'unknown', '.ts'));
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, `${fileName(state.currentTestName ?? 'unknown')}.jsonl`), entries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
    }, 60_000);
  });
}
