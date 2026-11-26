/**
 * Calls back once the page has been visible for `timeoutMs` in all. Time spent
 * hidden does not count: the cache is parked then. Returns its cancel function.
 */
export function visibleTimeout(
  onTimeout: () => void,
  timeoutMs: number
): () => void {
  let remainingMs = timeoutMs;
  let startedAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const pause = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
    remainingMs = Math.max(0, remainingMs - (performance.now() - startedAt));
  };
  const sync = () => {
    pause();
    if (isPageHidden()) return;
    startedAt = performance.now();
    timer = setTimeout(expire, remainingMs);
  };
  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    if (typeof document !== 'undefined')
      document.removeEventListener('visibilitychange', sync);
  };
  const expire = () => {
    cancel();
    onTimeout();
  };

  if (typeof document !== 'undefined')
    document.addEventListener('visibilitychange', sync);
  sync();
  return cancel;
}

const isPageHidden = (): boolean =>
  typeof document !== 'undefined' && document.visibilityState === 'hidden';
