import type { PipedreamConnectEvent } from './connect-ui';

export const PIPEDREAM_CALLBACK_PATH = '/pipedream-connect-callback';

// One-use callbacks belong to a live native session, never persisted storage.
const pending = new Map<string, (event: PipedreamConnectEvent) => void>();

export function registerPipedreamCallback(
  onEvent: (event: PipedreamConnectEvent) => void
) {
  const state = crypto.randomUUID();
  pending.set(state, onEvent);
  return { state, remove: () => pending.delete(state) };
}

/** Consume even stale callbacks so they never replace the user's current route. */
export function handlePipedreamCallback(path: string, query: string): boolean {
  if (path !== PIPEDREAM_CALLBACK_PATH) return false;
  const params = new URLSearchParams(query);
  const state = params.get('state') ?? '';
  const callback = pending.get(state);
  if (!callback) return true;
  const accountId = params.get('account_id');
  const outcome = params.get('outcome');
  if (outcome !== 'closed' && !(outcome === 'success' && accountId))
    return true;
  pending.delete(state);
  callback(
    outcome === 'success' && accountId
      ? { type: 'success', accountId }
      : { type: 'close' }
  );
  return true;
}

export function clearPipedreamCallbacks() {
  const callbacks = [...pending.values()];
  pending.clear();
  for (const callback of callbacks) callback({ type: 'close' });
}
