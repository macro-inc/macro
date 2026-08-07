/**
 * The fold, as the app calls it: one async function, worker behind it.
 *
 * One worker per tab, started on first use and kept — every agent channel
 * folds through it, so the wasm module is instantiated once rather than per
 * channel.
 */

import type { AgentSessionLogEntryDto } from '@service-storage/generated/schemas/agentSessionLogEntryDto';
import type { FoldRequest, FoldResponse } from './protocol';
import type { FoldedMessage } from './types';

interface Pending {
  resolve: (messages: FoldedMessage[]) => void;
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
      waiting.resolve(response.messages);
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
    // worker that is not listening.
    worker = undefined;
  });

  worker = started;
  return started;
}

/**
 * Fold a session's log into the messages a channel renders.
 *
 * `entries` are passed through exactly as the raw-log endpoint served them:
 * the wasm side reads the same `{userId?, direction, content}` shape the
 * server writes and a recording stores.
 */
export function foldSession(
  sessionId: string,
  entries: AgentSessionLogEntryDto[]
): Promise<FoldedMessage[]> {
  const id = nextId++;
  const request: FoldRequest = { id, sessionId, entries };

  return new Promise<FoldedMessage[]>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ensureWorker().postMessage(request);
  });
}
