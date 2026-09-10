/**
 * Serve replay sessions through the real `agentHarnessServiceClient`.
 *
 * The client is a plain object, so the first registration wraps its methods
 * in place. Wrapped methods consult a registry keyed by session id and fall
 * through to the captured originals for every id they do not know — live
 * sessions are untouched, and nothing outside the replay debug page imports
 * this module, so the production path never patches.
 */

import { agentHarnessServiceClient } from '@service-agent-harness/client';
import type { ControlRequest } from '@service-agent-harness/generated/schemas';
import { ok } from 'neverthrow';

type Client = typeof agentHarnessServiceClient;

/** The replay driver's answers for one registered session id. */
export type ReplayBackend = {
  get: () => ReturnType<Client['get']>;
  getLog: () => ReturnType<Client['getLog']>;
  control: (request: ControlRequest) => ReturnType<Client['control']>;
};

const backends = new Map<string, ReplayBackend>();

let patched = false;

function ensurePatched(): void {
  if (patched) return;
  patched = true;
  const real: Client = { ...agentHarnessServiceClient };
  agentHarnessServiceClient.get = (sessionId) =>
    backends.get(sessionId)?.get() ?? real.get(sessionId);
  agentHarnessServiceClient.getLog = (sessionId) =>
    backends.get(sessionId)?.getLog() ?? real.getLog(sessionId);
  agentHarnessServiceClient.control = (sessionId, request) => {
    const backend = backends.get(sessionId);
    if (backend) return backend.control(request);
    return real.control(sessionId, request);
  };
  // Replay has no server-side queue: every control acks as `sent`, so the
  // queue is always empty rather than a fall-through to a session the
  // service has never heard of.
  agentHarnessServiceClient.queue = async (sessionId) =>
    backends.has(sessionId) ? ok({ entries: [] }) : real.queue(sessionId);
  // `delete` stays real: a replay session has nothing behind it to delete.
}

/**
 * Route the client's calls for `sessionId` to `backend`. Returns the
 * unregister function; every other session id keeps its real behavior.
 */
export function registerReplaySession(
  sessionId: string,
  backend: ReplayBackend
): () => void {
  ensurePatched();
  backends.set(sessionId, backend);
  return () => {
    backends.delete(sessionId);
  };
}
