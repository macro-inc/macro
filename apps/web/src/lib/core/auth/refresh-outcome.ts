/**
 * `rejected`: /jwt/refresh definitively refused the session. `refreshed`: a
 * refresh succeeded. `reset`: the session changed (login, logout).
 */
export type RefreshOutcome = 'rejected' | 'refreshed' | 'reset';

const listeners = new Set<(outcome: RefreshOutcome) => void>();

/** Observes refresh outcomes; the session gate uses this to notice expiry. */
export function subscribeRefreshOutcome(
  listener: (outcome: RefreshOutcome) => void
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishRefreshOutcome(outcome: RefreshOutcome) {
  for (const listener of listeners) listener(outcome);
}
