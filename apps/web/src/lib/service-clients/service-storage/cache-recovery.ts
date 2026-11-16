import { fireAndForget } from '@core/util/fireAndForget';
import {
  isCacheSupersededError,
  isOwnerHandoffBlockedError,
  isOwnerLockUnavailableError,
} from '@graphql-cache/protocol';
import { CacheBootstrapExhaustedError } from '@graphql-cache/worker/startup';
import { createSignal } from 'solid-js';

export type CacheRecoveryState =
  | 'ready'
  | 'recovering'
  | 'unavailable'
  | 'recovery-required';

/** Restarts allowed in a row before the page stops retrying until reload. A
 * cache that fails again after each restart would otherwise rebuild the client
 * for the rest of the page session. */
export const MAX_RECOVERY_ATTEMPTS = 10;

/** How long a restarted cache must stay up before its failures count afresh. */
export const RECOVERY_HEALTHY_MS = 60_000;

/** Only known untouched/bootstrap or owner-handoff failures permit reopening.
 * A newer build that took the database over never hands it back to this one. */
export function canRetryCacheFailure(error: unknown): boolean {
  if (isCacheSupersededError(error)) return false;
  return (
    error instanceof CacheBootstrapExhaustedError ||
    isOwnerLockUnavailableError(error) ||
    isOwnerHandoffBlockedError(error)
  );
}

/** Why a page stopped retrying its cache until reload. */
export type CacheRecoveryStopReason =
  | 'superseded'
  | 'attempts-exhausted'
  | 'unrecoverable';

export type CacheRecoveryOptions = {
  /** Called when a cache fails again before it stayed up after a restart. */
  onRelapse?: (attempts: number, error: unknown) => void;
  /** Called once each time the page stops retrying until reload. */
  onStopped?: (
    reason: CacheRecoveryStopReason,
    attempts: number,
    error: unknown
  ) => void;
};

function stopReason(error: unknown): CacheRecoveryStopReason {
  if (isCacheSupersededError(error)) return 'superseded';
  return canRetryCacheFailure(error) ? 'attempts-exhausted' : 'unrecoverable';
}

/** Owns a page session's retry cycle, never the persisted cache or its scope. */
export function createCacheRecovery(
  rebuild: () => Promise<void>,
  options: CacheRecoveryOptions = {}
) {
  const [state, setState] = createSignal<CacheRecoveryState>('ready');
  let failure: unknown;
  let generation = 0;
  // Restarts since the cache last stayed up for RECOVERY_HEALTHY_MS. A restart
  // that succeeds but fails again soon after keeps counting, so its backoff
  // grows and the cap still applies.
  let attempt = 0;
  let pending: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let healthyTimer: ReturnType<typeof setTimeout> | undefined;
  let listening = false;

  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const clearHealthyTimer = () => {
    if (healthyTimer !== undefined) clearTimeout(healthyTimer);
    healthyTimer = undefined;
  };
  const resume = () => {
    if (
      navigator.onLine === false ||
      document.visibilityState === 'hidden' ||
      state() !== 'unavailable'
    )
      return;
    fireAndForget(retry(), 'graphql-cache-recovery');
  };
  const listen = () => {
    if (listening) return;
    listening = true;
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
  };
  const unlisten = () => {
    if (!listening) return;
    listening = false;
    window.removeEventListener('online', resume);
    document.removeEventListener('visibilitychange', resume);
  };
  const schedule = () => {
    clearTimer();
    if (state() !== 'unavailable') return;
    listen();
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5));
    timer = setTimeout(resume, delay * (0.8 + Math.random() * 0.4));
  };
  const failed = (error: unknown) => {
    failure = error;
    if (healthyTimer !== undefined) options.onRelapse?.(attempt, error);
    clearHealthyTimer();
    // Only these typed errors prove restarting cannot bypass a quarantined
    // journal: nothing opened storage, or a read was refused while the database
    // moved between owners. Unknown storage/transport failures stay closed, and
    // so does a cache that kept failing after every restart.
    const recoverable =
      canRetryCacheFailure(error) && attempt < MAX_RECOVERY_ATTEMPTS;
    const stopping = !recoverable && state() !== 'recovery-required';
    setState(recoverable ? 'unavailable' : 'recovery-required');
    if (recoverable) schedule();
    else {
      clearTimer();
      unlisten();
      if (stopping) options.onStopped?.(stopReason(error), attempt, error);
    }
  };
  async function run(epoch: number) {
    try {
      await rebuild();
      if (generation !== epoch) return;
      failure = undefined;
      clearTimer();
      unlisten();
      setState('ready');
      clearHealthyTimer();
      healthyTimer = setTimeout(() => {
        healthyTimer = undefined;
        attempt = 0;
      }, RECOVERY_HEALTHY_MS);
    } catch (error) {
      if (generation !== epoch) return;
      failed(error);
      throw error;
    } finally {
      if (generation === epoch) pending = undefined;
    }
  }
  function retry(): Promise<void> {
    if (pending) return pending;
    if (state() === 'ready') return Promise.resolve();
    if (state() === 'recovery-required') return Promise.reject(failure);
    if (navigator.onLine === false)
      return Promise.reject(
        new Error('Reconnect to retry draft synchronization.')
      );
    clearTimer();
    attempt += 1;
    setState('recovering');
    pending = run(generation);
    return pending;
  }
  return {
    state,
    failed,
    retry,
    /** Restarts made since the cache last stayed up, for telemetry. */
    attempts: () => attempt,
    reset() {
      generation += 1;
      pending = undefined;
      failure = undefined;
      attempt = 0;
      clearTimer();
      clearHealthyTimer();
      unlisten();
      setState('ready');
    },
  };
}
