import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';

/**
 * Wall-clock time that ticks only while `run` returns a key, so idle rooms do
 * not re-render on a timer. A new key restarts the clock; `stopWhen` ends a
 * run early, such as when a race times out without any document change.
 */
export function createClock(
  run: Accessor<string | number | undefined>,
  options: { intervalMs?: number; stopWhen?: (now: number) => boolean } = {}
): Accessor<number> {
  const [now, setNow] = createSignal(Date.now());
  // Memoized so unrelated changes behind `run` keep the current interval.
  const runKey = createMemo(run);
  createEffect(
    on(runKey, (key) => {
      setNow(Date.now());
      if (key === undefined) return;
      const timer = setInterval(() => {
        const time = Date.now();
        setNow(time);
        if (options.stopWhen?.(time)) clearInterval(timer);
      }, options.intervalMs ?? 200);
      onCleanup(() => clearInterval(timer));
    })
  );
  return now;
}
