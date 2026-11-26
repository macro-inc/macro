import { type Accessor, createSignal, onCleanup, onMount } from 'solid-js';
import { localDay } from '../core/entry-days';

/**
 * This device's calendar day, `YYYY-MM-DD`, moving on at midnight and when a
 * tab left open overnight comes back.
 */
export function createLocalToday(): Accessor<string> {
  const [today, setToday] = createSignal(localDay(new Date()));
  onMount(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      const now = new Date();
      setToday(localDay(now));
      const midnight = new Date(now);
      midnight.setHours(24, 0, 0, 0);
      timer = setTimeout(refresh, midnight.getTime() - now.getTime());
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisibility);
    onCleanup(() => {
      clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisibility);
    });
  });
  return today;
}
