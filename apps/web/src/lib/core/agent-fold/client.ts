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
import workerUrl from './fold.worker.ts?worker&url';
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

/**
 * The worker's script never ran.
 *
 * Browsers can omit the error message for missing scripts, blocked scripts,
 * or invalid packaging. Keep the URL for diagnosis without assuming a cause.
 */
export class AgentFoldWorkerUnavailable extends Error {
  constructor(readonly workerUrl: string) {
    super(`agent fold worker script could not be loaded (${workerUrl})`);
    this.name = 'AgentFoldWorkerUnavailable';
  }
}

/**
 * What an `error` event from the worker means, as precisely as the browser
 * lets us put it. The empty-message case is {@link AgentFoldWorkerUnavailable};
 * anything else threw while starting up and says so itself.
 */
function workerStartupFailure(url: string, message: string): Error {
  if (!message) return new AgentFoldWorkerUnavailable(url);
  const error = new Error(`agent fold worker failed to start: ${message}`);
  error.name = 'AgentFoldWorkerStartupFailed';
  return error;
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

  // Explicitly bundle the worker while retaining its URL for diagnostics.
  // A standalone new URL('./fold.worker.ts', import.meta.url) makes Vite
  // emit raw TypeScript as an asset instead of compiling a worker entry.
  const started = new Worker(workerUrl, { type: 'module' });

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
    // One error event takes down every fold in flight, which is why a single
    // failure reports as many: the count is concurrent folds, not causes.
    const error = workerStartupFailure(workerUrl, event.message ?? '');
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
    try {
      const target = ensureWorker();
      pending.set(id, { resolve, reject });
      target.postMessage(message);
    } catch (error) {
      pending.delete(id);
      reject(error);
    }
  });
}

/**
 * Start the shared fold on composer focus, while the user is still typing.
 * A real request already starts the same worker, so repeat focus is free.
 * No session is opened and a preload failure must not interrupt the input.
 */
export async function preloadAgentFold(): Promise<void> {
  if (worker) return;
  try {
    await request((id) => ({ id, kind: 'preload' }));
  } catch (error) {
    console.warn('[agent-fold] fold could not be preloaded', error);
  }
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
