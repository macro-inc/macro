import { usePageVisibility } from '@solid-primitives/page-visibility';
import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js';

/** Refresh date buckets only at their boundary, while their view is visible. */
export function createDateClock(enabled: Accessor<boolean>, period: number) {
  const read = () => Math.floor(Date.now() / period) * period;
  const [now, setNow] = createSignal(read());
  const visible = usePageVisibility();
  createEffect(() => {
    if (!enabled() || !visible()) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(read());
      timer = setTimeout(tick, period - (Date.now() % period));
    };
    tick();
    onCleanup(() => clearTimeout(timer));
  });
  return now;
}
