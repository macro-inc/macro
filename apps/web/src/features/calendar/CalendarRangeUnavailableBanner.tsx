import InfoIcon from '@phosphor/info.svg';
import { createMemo, Show } from 'solid-js';
import { Transition } from 'solid-transition-group';
import { useCalendarView } from './CalendarViewContext';
import { isCalendarRangeSupported } from './calendar-supported-range';

/** Announces when the visible viewport is outside backend occurrence coverage. */
export function CalendarRangeUnavailableBanner() {
  const calendarView = useCalendarView();
  const isUnavailable = createMemo(() => {
    const range = calendarView.visibleRange();
    return range !== undefined && !isCalendarRangeSupported(range);
  });

  return (
    <Transition
      appear
      enterActiveClass="transition-[grid-template-rows,opacity,transform] duration-200 ease-in-out motion-reduce:transition-none"
      enterClass="grid-rows-[0fr] -translate-y-2 opacity-0"
      enterToClass="grid-rows-[1fr] translate-y-0 opacity-100"
      exitActiveClass="transition-[grid-template-rows,opacity,transform] duration-200 ease-in-out motion-reduce:transition-none"
      exitClass="grid-rows-[1fr] translate-y-0 opacity-100"
      exitToClass="grid-rows-[0fr] -translate-y-2 opacity-0"
    >
      <Show when={isUnavailable()}>
        <div class="grid shrink-0">
          <div class="min-h-0 overflow-hidden">
            <div
              role="status"
              class="mx-2 mb-2 flex items-center gap-2 rounded-lg border border-accent/30 bg-accent-bg px-3 py-2 text-xs text-ink-muted"
            >
              <InfoIcon class="size-3.5 shrink-0 text-accent" />
              <span>Calendar events aren’t available for this date range.</span>
            </div>
          </div>
        </div>
      </Show>
    </Transition>
  );
}
