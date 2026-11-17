import { formatLocale } from '@app/lib/i18n';
import CorvuCalendar, { type RootRangeProps } from '@corvu/calendar';
import { addDays } from 'date-fns';
import { splitProps } from 'solid-js';
import { cn } from '../../utils/classname';
import { CalendarTable } from '../calendar/CalendarTable';
import { CalendarRangeHeader } from './CalendarRangeHeader';

export type CalendarRangeProps = Omit<RootRangeProps, 'mode' | 'children'> & {
  class?: string;
};

/**
 * An inclusive date-range picker, sharing the single-date calendar's grid.
 * @do Keep partial selections local until both endpoints are chosen.
 * @dont Pass provider-exclusive event ends without converting to inclusive dates.
 */
export function CalendarRange(props: CalendarRangeProps) {
  const [local, root] = splitProps(props, ['class']);
  const initial = props.value?.from ?? props.initialValue?.from ?? new Date();
  return (
    <CorvuCalendar
      mode="range"
      {...root}
      initialMonth={props.initialMonth ?? initial}
      initialFocusedDay={props.initialFocusedDay ?? initial}
    >
      {(calendar) => (
        <div class={cn('w-full min-w-0 text-ink', local.class)}>
          <CalendarRangeHeader />
          <CalendarTable
            locale={formatLocale()}
            highlightedRange={
              calendar.value.from
                ? {
                    start: calendar.value.from,
                    end: addDays(calendar.value.to ?? calendar.value.from, 1),
                  }
                : undefined
            }
          />
        </div>
      )}
    </CorvuCalendar>
  );
}
