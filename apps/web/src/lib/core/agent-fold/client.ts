/**
 * The fold, as the app calls it: async functions, worker behind them.
 *
 * One worker per tab, started on first use and kept — every agent surface
 * folds through it, so the wasm module is instantiated once rather than per
 * surface, and the live sessions' machines all live in one place.
 */

import type {
  FoldedMessage,
  FoldedStreamEvent,
  SessionMetadata,
} from '@service-agent-fold/generated/types';
import type { FoldInput, FoldRequest, FoldResponse } from './protocol';

export type { FoldInput } from './protocol';

/** A machine-backed read: the fold's messages plus its current metadata. */
export type SessionFoldSnapshot = {
  messages: FoldedMessage[];
  metadata: SessionMetadata;
};

interface Pending {
  resolve: (response: Extract<FoldResponse, { ok: true }>) => void;
  reject: (error: Error) => void;
}

let worker: Worker | undefined;
const pending = new Map<number, Pending>();
let nextId = 0;

/**
 * Lazily constructed on purpose: on iOS, WKWebView deadlocks when a module
 * Worker is constructed eagerly over `tauri://` (apps/web/AGENTS.md).
 */
function ensureWorker(): Worker {
  if (worker) return worker;

  const started = new Worker(new URL('./fold.worker.ts', import.meta.url), {
    type: 'module',
  });

  started.addEventListener('message', (event: MessageEvent<FoldResponse>) => {
    const response = event.data;
    const waiting = pending.get(response.id);
    if (!waiting) return;
    pending.delete(response.id);
    if (response.ok) {
      waiting.resolve(response);
    } else {
      waiting.reject(new Error(response.error));
    }
  });

  started.addEventListener('error', (event) => {
    // The worker itself failed, so nothing in flight will ever be answered.
    const error = new Error(`agent fold worker failed: ${event.message}`);
    for (const waiting of pending.values()) waiting.reject(error);
    pending.clear();
    // Dropped so the next call starts a fresh one rather than waiting on a
    // worker that is not listening. Every open machine died with it, so a
    // follower has to push a fresh snapshot.
    worker = undefined;
  });

  worker = started;
  return started;
}

function request(
  build: (id: number) => FoldRequest
): Promise<Extract<FoldResponse, { ok: true }>> {
  const id = nextId++;
  const message = build(id);

  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ensureWorker().postMessage(message);
  });
}

/**
 * Fold inputs into a session's machine, in order, and hear what changed.
 *
 * The first input a session ever sends must be a snapshot; the machine
 * refuses live and speculative inputs before one, since folding from the
 * middle of a log derives a session that never happened.
 */
export async function pushSession(
  sessionId: string,
  inputs: FoldInput[]
): Promise<FoldedStreamEvent[]> {
  const response = await request((id) => ({
    id,
    kind: 'push',
    sessionId,
    inputs,
  }));
  return response.kind === 'push' ? response.changes : [];
}

/**
 * Everything a session's machine holds right now.
 *
 * For a surface joining a session someone else is already following: the
 * open machine is ahead of any snapshot that surface could fetch, so asking
 * it beats refetching. Rejects when the session has no open machine.
 */
export async function readSession(
  sessionId: string
): Promise<SessionFoldSnapshot> {
  const response = await request((id) => ({ id, kind: 'read', sessionId }));
  if (response.kind !== 'read') {
    throw new Error(`unexpected fold response for session ${sessionId}`);
  }
  return { messages: response.messages, metadata: response.metadata };
}

/** Drop a session's machine once nothing is watching it. */
export function closeSession(sessionId: string): void {
  void request((id) => ({ id, kind: 'close', sessionId })).catch(
    (error: unknown) => {
      console.warn('[agent-fold] session could not be closed', error);
    }
  );
}
