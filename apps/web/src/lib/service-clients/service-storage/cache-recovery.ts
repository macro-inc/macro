import { fireAndForget } from '@core/util/fireAndForget';
import {
  CacheHostDisposedError,
  CacheHostFailedError,
  CacheRequestTimeoutError,
} from '@graphql-cache/host/errors';
import { CacheNavigationError } from '@graphql-cache/host/navigation-error';
import { visibleTimeout } from '@graphql-cache/host/visible-timeout';
import { CoordinatorRestartedError } from '@graphql-cache/host/worker-host';
import {
  isCacheSupersededError,
  isOwnerEpochLostError,
  isOwnerHandoffBlockedError,
  isOwnerLockUnavailableError,
} from '@graphql-cache/protocol';
import { createSignal } from 'solid-js';

export type CacheRecoveryState =
  | 'ready'
  | 'recovering'
  | 'unavailable'
  | 'recovery-required';

/** How long, while the page is visible, a cache may be off before it is
 * reported. The page goes on retrying. */
export const CACHE_OFF_LIMIT_MS = 5 * 60_000;

/** How long a restarted cache must stay up before its failures count afresh. */
export const RECOVERY_HEALTHY_MS = 60_000;

/** The page replaced its host, or its session ended, during a restart. */
export class CacheRecoverySupersededError extends Error {
  constructor() {
    super('Cache recovery was superseded.');
    this.name = 'CacheRecoverySupersededError';
  }
}

/** A restart ended without a cache to ask. */
export class CacheNotRestartedError extends Error {
  constructor() {
    super('Local cache could not restart.');
    this.name = 'CacheNotRestartedError';
  }
}

/** Only these failures permit reopening: each leaves the database and its scope
 * as they were. A newer build that took the database over never hands it back
 * to this one, and a native engine reports its failures untyped. */
export function canReopenCache(error: unknown): boolean {
  if (isCacheSupersededError(error)) return false;
  return (
    error instanceof CacheHostFailedError ||
    error instanceof CoordinatorRestartedError ||
    isOwnerLockUnavailableError(error) ||
    isOwnerHandoffBlockedError(error)
  );
}

/** Whether a failed cache may be asked, or built, again: also after a startup
 * nobody answered, and when only the request was lost. */
export function canRetryCacheFailure(error: unknown): boolean {
  return (
    canReopenCache(error) ||
    isOwnerEpochLostError(error) ||
    error instanceof CacheRequestTimeoutError ||
    error instanceof CacheNavigationError ||
    error instanceof CacheHostDisposedError ||
    error instanceof CacheRecoverySupersededError ||
    error instanceof CacheNotRestartedError
  );
}

/** Why a page stopped retrying its cache until reload. */
export type CacheRecoveryStopReason = 'superseded' | 'unrecoverable';

export type CacheRecoveryOptions = {
  /** Called when a cache fails again before it stayed up after a restart. */
  onRelapse?: (relapses: number, error: unknown) => void;
  /** Called once each time the page stops retrying until reload. */
  onStopped?: (
    reason: CacheRecoveryStopReason,
    relapses: number,
    error: unknown
  ) => void;
  /** Called once each time the cache stays off past CACHE_OFF_LIMIT_MS. */
  onOffPastLimit?: (attempts: number, error: unknown) => void;
};

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
  // keeps growing.
  let attempt = 0;
  // Restarts in a row whose cache failed again before staying up.
  let relapses = 0;
  let pending: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let healthyTimer: ReturnType<typeof setTimeout> | undefined;
  let listening = false;
  let cancelOffLimit: (() => void) | undefined;

  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const clearHealthyTimer = () => {
    if (healthyTimer !== undefined) clearTimeout(healthyTimer);
    healthyTimer = undefined;
  };
  const clearOffLimit = () => {
    cancelOffLimit?.();
    cancelOffLimit = undefined;
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
    if (healthyTimer !== undefined) {
      relapses += 1;
      options.onRelapse?.(relapses, error);
    }
    clearHealthyTimer();
    // Retries are bounded in rate, never in number.
    const recoverable = canRetryCacheFailure(error);
    const stopping = !recoverable && state() !== 'recovery-required';
    setState(recoverable ? 'unavailable' : 'recovery-required');
    if (recoverable) {
      cancelOffLimit ??= visibleTimeout(
        () => options.onOffPastLimit?.(attempt, failure),
        CACHE_OFF_LIMIT_MS
      );
      schedule();
    } else {
      clearTimer();
      clearOffLimit();
      unlisten();
      if (stopping)
        options.onStopped?.(
          isCacheSupersededError(error) ? 'superseded' : 'unrecoverable',
          relapses,
          error
        );
    }
  };
  async function run(epoch: number) {
    try {
      await rebuild();
      if (generation !== epoch) return;
      failure = undefined;
      clearTimer();
      clearOffLimit();
      unlisten();
      setState('ready');
      clearHealthyTimer();
      healthyTimer = setTimeout(() => {
        healthyTimer = undefined;
        attempt = 0;
        relapses = 0;
      }, RECOVERY_HEALTHY_MS);
    } catch (error) {
      if (generation !== epoch) return;
      // A host that failed meanwhile has said why, which decides; what the
      // restart then rejects with is only a consequence.
      if (state() === 'recovering') failed(error);
      else schedule();
      throw error;
    } finally {
      if (generation === epoch) pending = undefined;
    }
  }
  function begin(): Promise<void> {
    clearTimer();
    attempt += 1;
    setState('recovering');
    pending = run(generation);
    return pending;
  }
  async function available(): Promise<void> {
    const epoch = generation;
    try {
      await pending;
    } catch {
      // It asked before the host served again.
    }
    if (generation === epoch && state() === 'unavailable' && !pending)
      await begin();
  }
  function retry(): Promise<void> {
    if (pending) return pending;
    if (state() === 'ready') return Promise.resolve();
    if (state() === 'recovery-required') return Promise.reject(failure);
    if (navigator.onLine === false)
      return Promise.reject(
        new Error('Reconnect to retry draft synchronization.')
      );
    return begin();
  }
  return {
    state,
    failed,
    retry,
    /** The host serves again: prove it at once, also offline or hidden. */
    available,
    /** Restarts made since the cache last stayed up, for telemetry. */
    attempts: () => attempt,
    reset() {
      generation += 1;
      pending = undefined;
      failure = undefined;
      attempt = 0;
      relapses = 0;
      clearTimer();
      clearHealthyTimer();
      clearOffLimit();
      unlisten();
      setState('ready');
    },
  };
}
