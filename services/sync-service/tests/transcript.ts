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
  sockets: Map<WebSocket, { resolve?: () => void; closed: Promise<void> }>;
};
const captures = new Map<Miniflare, Capture>();

async function dump(mf: Miniflare, capture: Capture) {
  // A ping/pong fence drains client messages already sent before the scenario
  // ended. Its listener precedes application listeners, so shared test clients
  // never see the fence's pong in their own receive queue.
  for (const [socket, fence] of capture.sockets) {
    if (socket.readyState === 2) await fence.closed;
    if (socket.readyState !== 1) continue;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Transcript socket fence timed out')), 5000);
      fence.resolve = () => { clearTimeout(timeout); resolve(); };
      socket.send('ping');
    });
  }
  const namespace = await mf.getDurableObjectNamespace('DOCUMENT_SYNC_SESSION');
  for (const room of capture.rooms) {
    const stub = namespace.get(namespace.idFromString(room));
    const marker = `${capture.entries.length}:${room}`;
    const received = new Promise<void>(resolve => capture.waiters.set(marker, resolve));
    const response = await stub.fetch(`http://sync-test/__sync_test_dump?marker=${encodeURIComponent(marker)}`);
    await response.json();
    await received;
    capture.waiters.delete(marker);
  }
}

/** Capture only the feature's dedicated tracing target; preserve line order. */
export function runtimeCapture(disposeAfterTest: boolean) {
  const capture: Capture = {
    entries: [], rooms: new Set(), written: 0, waiters: new Map(), disposeAfterTest, disposed: false, sockets: new Map(),
  };
  return {
    attach(mf: Miniflare) {
      captures.set(mf, capture);
      const dispatch = mf.dispatchFetch.bind(mf);
      mf.dispatchFetch = async (...args: Parameters<typeof dispatch>) => {
        const response = await dispatch(...args);
        const socket = response.webSocket;
        if (socket) {
          const closed = Promise.withResolvers<void>();
          const fence: { resolve?: () => void; closed: Promise<void> } = { closed: closed.promise };
          capture.sockets.set(socket, fence);
          socket.addEventListener('message', event => {
            if (event.data !== 'pong' || !fence.resolve) return;
            event.stopImmediatePropagation();
            const resolve = fence.resolve;
            delete fence.resolve;
            resolve();
          });
          socket.addEventListener('close', () => {
            fence.resolve?.();
            closed.resolve();
            capture.sockets.delete(socket);
          });
        }
        return response;
      };
      const dispose = mf.dispose.bind(mf);
      mf.dispose = async () => {
        if (capture.disposed) return;
        await dump(mf, capture);
        capture.disposed = true;
        await dispose();
      };
    },
    stdio(stdout: Readable, stderr: Readable) {
      for (const stream of [stdout, stderr]) {
        createInterface({ input: stream }).on('line', line => {
          const start = line.indexOf('{');
          if (start < 0) return;
          let record: Entry;
          try { record = JSON.parse(line.slice(start)); } catch { return; }
          if (record.target !== 'sync_transcript') return;
          const fields = record.fields as { transcript?: string };
          if (!fields?.transcript) return;
          const entry: Entry = JSON.parse(fields.transcript);
          capture.entries.push(entry);
          if (typeof entry.marker === 'string') capture.waiters.get(entry.marker)?.();
          if (typeof entry.room === 'string') capture.rooms.add(entry.room);
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
      const entries: Entry[] = [];
      for (const [mf, capture] of captures) {
        if (capture.entries.length === capture.written) continue;
        if (!capture.disposed) {
          if (capture.disposeAfterTest) await mf.dispose();
          else await dump(mf, capture);
        }
        // Include a shared runtime's preceding inputs so every fixture replays
        // independently, including tests which reuse a beforeAll instance.
        entries.push(...capture.entries);
        capture.written = capture.entries.length;
        if (capture.disposed) captures.delete(mf);
      }
      if (!entries.length) return;
      const directory = join(process.env.SYNC_TRANSCRIPT_DIR ?? 'tests/transcripts', basename(state.testPath ?? 'unknown', '.ts'));
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, `${fileName(state.currentTestName ?? 'unknown')}.jsonl`), entries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
    }, 60_000);
  });
}
