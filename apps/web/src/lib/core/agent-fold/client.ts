/**
 * The fold, as the app calls it: async functions, worker behind them.
 *
 * One worker per tab, started on first use and kept — every agent channel
 * folds through it, so the wasm module is instantiated once rather than per
 * channel, and the live sessions' machines all live in one place.
 */

import type {
  FoldedMessage,
  FoldedStreamEvent,
  SessionMetadata,
} from '@service-agent-fold/generated/types';
import type { AgentSessionLogEntryDto } from '@service-agent-harness/generated/schemas';
import type { FoldRequest, FoldResponse } from './protocol';

/** A machine-backed read: the fold's messages plus its current metadata. */
export type SessionFoldSnapshot = {
  messages: FoldedMessage[];
  metadata: SessionMetadata;
};

/** What a machine that has folded nothing knows — every field still absent. */
const EMPTY_METADATA: SessionMetadata = {
  harness: 'unknown',
  model: null,
  supportedModels: [],
  title: null,
  availableCommands: [],
  status: null,
};

interface Pending {
  resolve: (response: Extract<FoldResponse, { ok: true }>) => void;
  reject: (error: Error) => void;
}

let worker: Worker | undefined;
const pending = new Map<number, Pending>();
let nextId = 0;

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
    // follower has to reopen — see `openSession`.
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
 * Fold a session's log into the messages a channel renders, keeping nothing.
 *
 * `entries` are passed through exactly as the raw-log endpoint served them:
 * the wasm side reads the same `{userId?, direction, content}` shape the
 * server writes, a recording stores, and the realtime event carries.
 *
 * For a session that is still running, {@link openSession} instead — that
 * leaves a machine behind for {@link pushSessionEntries} to continue.
 */
export async function foldSession(
  sessionId: string,
  entries: AgentSessionLogEntryDto[]
): Promise<FoldedMessage[]> {
  const response = await request((id) => ({
    id,
    kind: 'once',
    sessionId,
    entries,
  }));
  return response.kind === 'once' ? response.messages : [];
}

/**
 * Fold a fetched log and leave the machine open for what comes next.
 *
 * Discards any machine already open for the session, because `entries` start
 * at the top of the log: seeding a machine that has already folded them would
 * derive every message a second time. So a caller opens once, when it has a
 * fresh snapshot, and pushes from then on.
 */
export async function openSession(
  sessionId: string,
  entries: AgentSessionLogEntryDto[]
): Promise<SessionFoldSnapshot> {
  const response = await request((id) => ({
    id,
    kind: 'open',
    sessionId,
    entries,
  }));
  return response.kind === 'open'
    ? { messages: response.messages, metadata: response.metadata }
    : { messages: [], metadata: EMPTY_METADATA };
}

/**
 * Fold more frames into an open session, in log order.
 *
 * Rejects when the session has no open machine — the worker will not seed one
 * from the middle of a log, since the messages that would derive belong to a
 * session that never happened.
 */
export async function pushSessionEntries(
  sessionId: string,
  entries: AgentSessionLogEntryDto[]
): Promise<FoldedStreamEvent[]> {
  const response = await request((id) => ({
    id,
    kind: 'push',
    sessionId,
    entries,
  }));
  return response.kind === 'push' ? response.changes : [];
}

/**
 * Every message an open session has folded so far.
 *
 * For a reader joining a session someone else is already following: the open
 * machine is ahead of any snapshot that reader could fetch, so asking it beats
 * reopening it.
 *
 * Rejects when the session has no open machine.
 */
export async function sessionMessages(
  sessionId: string
): Promise<SessionFoldSnapshot> {
  const response = await request((id) => ({ id, kind: 'messages', sessionId }));
  return response.kind === 'messages'
    ? { messages: response.messages, metadata: response.metadata }
    : { messages: [], metadata: EMPTY_METADATA };
}

/** Drop a session's machine once nothing is watching it. */
export function closeSession(sessionId: string): void {
  void request((id) => ({ id, kind: 'close', sessionId })).catch(
    (error: unknown) => {
      console.warn('[agent-fold] session could not be closed', error);
    }
  );
}
