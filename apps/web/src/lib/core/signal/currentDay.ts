import { createSingletonRoot } from '@solid-primitives/rootless';
import { startOfToday, startOfTomorrow } from 'date-fns';
import { createSignal, onCleanup } from 'solid-js';

const CHECK_INTERVAL_MS = 30_000;

/**
 * The start of the local day, which moves on while the app stays open, so that
 * "today" and "yesterday" labels follow it.
 */
export const useCurrentDay = createSingletonRoot(() => {
  const [day, setDay] = createSignal(startOfToday(), {
    equals: (previous, next) => previous.getTime() === next.getTime(),
  });
  const update = () => setDay(startOfToday());

  let timer: ReturnType<typeof setTimeout>;
  const schedule = () => {
    const untilTomorrow = startOfTomorrow().getTime() - Date.now();
    // A sleeping machine holds its timers, so one set for midnight alone would
    // fire that much late.
    timer = setTimeout(
      () => {
        update();
        schedule();
      },
      Math.min(untilTomorrow, CHECK_INTERVAL_MS)
    );
  };
  schedule();

  // A hidden tab's timers are throttled: catch up as soon as it shows again.
  document.addEventListener('visibilitychange', update);
  onCleanup(() => {
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', update);
  });

  return day;
});
