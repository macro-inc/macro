import { type Accessor, createSignal, onCleanup } from 'solid-js';
import { createTaskCalendar } from '../core/task-due-date';

/** Refresh relative dates after midnight, timezone changes, and app resume. */
export function createTaskCalendarSignal(
  options: { timeZone?: Accessor<string> } = {}
) {
  const current = () =>
    createTaskCalendar(
      new Date(),
      options.timeZone?.() ?? Intl.DateTimeFormat().resolvedOptions().timeZone
    );
  const [calendar, setCalendar] = createSignal(current());
  let midnight: ReturnType<typeof setTimeout>;
  const refresh = () => {
    const next = current();
    const previous = calendar();
    if (next.today !== previous.today || next.timeZone !== previous.timeZone)
      setCalendar(next);
    clearTimeout(midnight);
    midnight = setTimeout(
      refresh,
      Math.max(1, Date.parse(next.boundaries.tomorrow) - Date.now())
    );
  };
  refresh();
  // Browsers expose no timezone-change event; also check while the app stays open.
  const zoneCheck = setInterval(refresh, 60_000);
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('pageshow', refresh);
  onCleanup(() => {
    clearTimeout(midnight);
    clearInterval(zoneCheck);
    window.removeEventListener('focus', refresh);
    document.removeEventListener('visibilitychange', refresh);
    window.removeEventListener('pageshow', refresh);
  });
  return calendar;
}
