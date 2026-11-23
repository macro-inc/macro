import { formatLocalDate } from '@core/util/local-date';
import CorvuCalendar from '@corvu/calendar';
import { Index, Show } from 'solid-js';
import { cn } from '../../utils/classname';
import { CalendarDayMarkers } from '../calendar-day-markers/CalendarDayMarkers';

/** Decorative day highlights use an end-exclusive range, unlike selected range values. */
export interface CalendarHighlightedRange {
  start: Date;
  end: Date;
}
const isInRange = (date: Date, range: CalendarHighlightedRange | undefined) =>
  range !== undefined && date >= range.start && date < range.end;
const offsetDate = (date: Date, days: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

/** Shared grid presentation under a single-date or range Corvu root. */
export function CalendarTable(props: {
  locale?: string;
  highlightedRange?: CalendarHighlightedRange;
  markersByDay?: ReadonlyMap<string, readonly string[]>;
}) {
  const calendar = CorvuCalendar.useContext();
  const longWeekday = () =>
    new Intl.DateTimeFormat(props.locale, { weekday: 'long' });
  const narrowWeekday = () =>
    new Intl.DateTimeFormat(props.locale, { weekday: 'narrow' });
  return (
    <CorvuCalendar.Table class="mt-2 w-full table-fixed border-collapse">
      <thead>
        <tr>
          <Index each={calendar.weekdays()}>
            {(weekday) => (
              <CorvuCalendar.HeadCell
                abbr={longWeekday().format(weekday())}
                class="h-7 text-center text-xxs font-medium text-ink-extra-muted"
              >
                {narrowWeekday().format(weekday())}
              </CorvuCalendar.HeadCell>
            )}
          </Index>
        </tr>
      </thead>
      <tbody>
        <Index each={calendar.weeks()}>
          {(week) => (
            <tr>
              <Index each={week()}>
                {(day) => (
                  <CorvuCalendar.Cell
                    class="p-0 text-center data-highlighted-range:bg-selected data-highlighted-range-start:rounded-l-md data-highlighted-range-end:rounded-r-md"
                    data-highlighted-range={
                      isInRange(day(), props.highlightedRange) ? '' : undefined
                    }
                    data-highlighted-range-start={
                      isInRange(day(), props.highlightedRange) &&
                      !isInRange(offsetDate(day(), -1), props.highlightedRange)
                        ? ''
                        : undefined
                    }
                    data-highlighted-range-end={
                      isInRange(day(), props.highlightedRange) &&
                      !isInRange(offsetDate(day(), 1), props.highlightedRange)
                        ? ''
                        : undefined
                    }
                  >
                    <CorvuCalendar.CellTrigger
                      day={day()}
                      month={calendar.month()}
                      data-highlighted-range={
                        isInRange(day(), props.highlightedRange)
                          ? ''
                          : undefined
                      }
                      class={cn(
                        'relative mx-auto flex size-7 items-center justify-center rounded-md text-xs text-ink-muted outline-none hover:bg-hover hover:text-ink focus-visible:ring focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-30 data-today:border data-today:border-accent data-today:font-semibold data-highlighted-range:text-ink',
                        calendar.mode() === 'range'
                          ? 'data-range-start:bg-accent! data-range-start:text-surface! data-range-end:bg-accent! data-range-end:text-surface!'
                          : 'data-selected:bg-accent! data-selected:text-surface!'
                      )}
                    >
                      {day().getDate()}
                      <Show
                        when={props.markersByDay?.get(formatLocalDate(day()))}
                      >
                        {(colors) => <CalendarDayMarkers colors={colors()} />}
                      </Show>
                    </CorvuCalendar.CellTrigger>
                  </CorvuCalendar.Cell>
                )}
              </Index>
            </tr>
          )}
        </Index>
      </tbody>
    </CorvuCalendar.Table>
  );
}
