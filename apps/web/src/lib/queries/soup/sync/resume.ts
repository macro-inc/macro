/**
 * Running a stopped sync again.
 *
 * A sync whose stream used up its retries stops. It runs again when the device
 * comes back online, when the app returns to the foreground, or when a pause
 * runs out, whichever is first. The pause is what covers a server that was
 * unreachable while the device stayed online, which raises no event.
 */

/** What ended the wait before a resumed run. */
export type SyncResumeReason = 'online' | 'foreground' | 'timer';

/** A run of the sync that follows a stop. */
export type SyncResume = {
  /** Stops before this run, in a row. */
  count: number;
  by: SyncResumeReason;
};

/** Pause after the first stop; doubled per further stop, up to the cap. */
export const SYNC_RESUME_PAUSE_MS = 60_000;
export const SYNC_RESUME_PAUSE_MAX_MS = 5 * 60_000;

/**
 * The pause after the sync's `stops`-th stop in a row, spread by a fifth
 * either way so clients do not return together after an outage.
 */
export function syncResumePauseMs(stops: number, random = Math.random): number {
  const pause = Math.min(
    SYNC_RESUME_PAUSE_MAX_MS,
    SYNC_RESUME_PAUSE_MS * 2 ** (stops - 1)
  );
  return pause * (0.8 + random() * 0.4);
}

/**
 * Resolves with what makes the sync worth running again: the device came
 * back online, the app returned to the foreground, or `pauseMs` ran out.
 * Aborting `signal` stops waiting; the promise then never resolves.
 */
export function waitToResumeSync(
  pauseMs: number,
  signal: AbortSignal
): Promise<SyncResumeReason> {
  return new Promise((resolve) => {
    const online = () => finish('online');
    const visible = () => {
      if (document.visibilityState === 'visible') finish('foreground');
    };
    const timer = setTimeout(() => finish('timer'), pauseMs);
    const stop = () => {
      clearTimeout(timer);
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', visible);
      signal.removeEventListener('abort', stop);
    };
    function finish(reason: SyncResumeReason) {
      stop();
      resolve(reason);
    }
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', visible);
    signal.addEventListener('abort', stop);
  });
}
