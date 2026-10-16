import { createSignal, onCleanup, onMount } from 'solid-js';
import { toGanttDay } from './gantt-date';

/** One local-day clock per chart, including tabs that resume after midnight. */
export function createGanttToday() {
  const [today, setToday] = createSignal(toGanttDay(new Date())!);
  onMount(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      const now = new Date();
      setToday(toGanttDay(now)!);
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
