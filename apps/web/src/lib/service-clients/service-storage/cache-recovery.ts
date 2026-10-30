import { fireAndForget } from '@core/util/fireAndForget';
import { isOwnerLockUnavailableError } from '@graphql-cache/protocol';
import { CacheBootstrapExhaustedError } from '@graphql-cache/worker/startup';
import { createSignal } from 'solid-js';

export type CacheRecoveryState =
  | 'ready'
  | 'recovering'
  | 'unavailable'
  | 'recovery-required';

/** Owns a page session's retry cycle, never the persisted cache or its scope. */
export function createCacheRecovery(rebuild: () => Promise<void>) {
  const [state, setState] = createSignal<CacheRecoveryState>('ready');
  let failure: unknown;
  let generation = 0;
  let attempt = 0;
  let pending: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let listening = false;

  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
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
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(attempt++, 5));
    timer = setTimeout(resume, delay * (0.8 + Math.random() * 0.4));
  };
  const failed = (error: unknown) => {
    failure = error;
    // Only these typed errors prove restarting cannot bypass a quarantined
    // journal. Unknown storage/transport failures stay closed for recovery.
    const recoverable =
      error instanceof CacheBootstrapExhaustedError ||
      isOwnerLockUnavailableError(error);
    setState(recoverable ? 'unavailable' : 'recovery-required');
    if (recoverable) schedule();
    else {
      clearTimer();
      unlisten();
    }
  };
  async function run(epoch: number) {
    try {
      await rebuild();
      if (generation !== epoch) return;
      failure = undefined;
      attempt = 0;
      clearTimer();
      unlisten();
      setState('ready');
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
    setState('recovering');
    pending = run(generation);
    return pending;
  }
  return {
    state,
    failed,
    retry,
    reset() {
      generation += 1;
      pending = undefined;
      failure = undefined;
      attempt = 0;
      clearTimer();
      unlisten();
      setState('ready');
    },
  };
}
