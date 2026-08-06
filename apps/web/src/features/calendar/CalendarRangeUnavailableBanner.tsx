import InfoIcon from '@phosphor/info.svg';
import { cn } from '@ui';
import { createMemo, Show } from 'solid-js';
import { Transition } from 'solid-transition-group';
import { useCalendarPager } from './CalendarPagerContext';
import { isCalendarRangeSupported } from './calendar-supported-range';

/** Announces when the visible viewport is outside backend occurrence coverage. */
export function CalendarRangeUnavailableBanner(props: {
  class?: string;
  fullWidth?: boolean;
}) {
  const calendarPager = useCalendarPager();
  const isUnavailable = createMemo(() => {
    const range = calendarPager.visibleRange();
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
        <div class={cn('grid shrink-0', props.class)}>
          <div class="min-h-0 overflow-hidden">
            <div
              role="status"
              class={cn(
                'mb-2 flex items-center gap-2 border border-accent/30 bg-accent-bg px-3 py-2 text-xs text-ink-muted',
                props.fullWidth ? 'rounded-none' : 'mx-2 rounded-lg'
              )}
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
