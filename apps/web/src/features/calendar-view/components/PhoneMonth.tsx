import type {
  CalendarEvent,
  CalendarTimeFormat,
} from '@app/features/calendar/types';
import { isSameLocalDate } from '@app/features/calendar/utils/calendar-date';
import { getCalendarSupportedRange } from '@app/features/calendar/utils/calendar-supported-range';
import { formatLocale, t } from '@app/lib/i18n';
import type { DatesSetArg } from '@fullcalendar/core';
import { Layer } from '@ui';
import { createEffect, createSignal, For } from 'solid-js';
import type { CalendarFocusTarget } from '../calendar-focus-target';
import { calendarFocusTargetId } from '../calendar-focus-target';
import { createPhoneMonth } from '../primitives/create-phone-month';
import { PhoneMonthEvent } from './PhoneMonthEvent';

/** A phone-only month face over the same bounded FullCalendar page and occurrences. */
export function PhoneMonth(props: {
  range: DatesSetArg | undefined;
  initialDate: Date;
  events: CalendarEvent[];
  showWeekends: boolean;
  timeFormat: CalendarTimeFormat;
  focusTarget?: CalendarFocusTarget;
  onFocusHandled: (requestId: number) => void;
  onSelect: (event: CalendarEvent, element: HTMLElement) => void;
}) {
  const [element, setElement] = createSignal<HTMLDivElement>();
  const supported = getCalendarSupportedRange();
  const isSupported = (date: Date) =>
    date >= supported.start && date < supported.end;
  const month = createPhoneMonth({
    start: () => props.range?.start,
    month: () => props.range?.view.currentStart,
    initialDate: props.initialDate,
    events: () => props.events,
    showWeekends: () => props.showWeekends,
    focusDate: () => props.focusTarget?.date,
  });
  createEffect(() => {
    const target = props.focusTarget;
    const root = element();
    const events = month.events();
    if (!target || !root) return;
    const id = calendarFocusTargetId(target);
    const event = events.find((event) => event.id === id);
    const row = Array.from(
      root.querySelectorAll<HTMLElement>('[data-calendar-month-event]')
    ).find((row) => row.dataset.calendarMonthEvent === id);
    if (!event || !row) return;
    month.pick(target.date);
    row.scrollIntoView({ block: 'nearest' });
    props.onSelect(event, row);
    props.onFocusHandled(target.requestId);
  });
  return (
    <div
      ref={setElement}
      class="phone-month absolute inset-0 z-10 overflow-y-auto px-1 pt-3 pb-[calc(var(--mobile-content-inset-bottom,0px)+6rem)]"
    >
      <div
        class="grid text-center text-xs text-ink-muted"
        style={{
          'grid-template-columns': `repeat(${props.showWeekends ? 7 : 5}, minmax(0, 1fr))`,
        }}
      >
        <For each={month.weekdays()}>
          {(day) => (
            <span class="py-1">
              {day.date.toLocaleDateString(formatLocale(), {
                weekday: 'short',
              })}
            </span>
          )}
        </For>
      </div>
      <Layer offset={1}>
        <div class="rounded-3xl bg-surface p-2">
          <div
            class="grid"
            style={{
              'grid-template-columns': `repeat(${props.showWeekends ? 7 : 5}, minmax(0, 1fr))`,
            }}
          >
            <For each={month.days()}>
              {(day) => (
                <button
                  type="button"
                  class="flex min-h-14 flex-col items-center gap-1 rounded-xl py-1 text-base text-ink"
                  classList={{
                    'bg-active': isSameLocalDate(day.date, month.selected()),
                    'text-ink-extra-muted':
                      day.date.getMonth() !==
                      props.range?.view.currentStart.getMonth(),
                  }}
                  aria-label={day.date.toLocaleDateString(formatLocale(), {
                    dateStyle: 'full',
                  })}
                  aria-pressed={isSameLocalDate(day.date, month.selected())}
                  disabled={!isSupported(day.date)}
                  onClick={() => month.pick(day.date)}
                >
                  <span
                    class="flex size-8 items-center justify-center rounded-full"
                    classList={{
                      'bg-accent text-button-accent-ink': isSameLocalDate(
                        day.date,
                        new Date()
                      ),
                    }}
                  >
                    {day.date.getDate()}
                  </span>
                  <span
                    class="flex h-1.5 items-center gap-0.5"
                    aria-hidden="true"
                  >
                    <For each={day.events.slice(0, 3)}>
                      {(event) => (
                        <span
                          class="size-1 rounded-full"
                          style={{ background: event.calendar.color }}
                        />
                      )}
                    </For>
                  </span>
                </button>
              )}
            </For>
          </div>
        </div>
      </Layer>
      <div class="px-1 pt-5">
        <p class="text-sm text-ink-muted">
          {month
            .selected()
            .toLocaleDateString(formatLocale(), { weekday: 'short' })}
        </p>
        <h2 class="mb-4 text-xl font-semibold text-ink">
          {month.selected().toLocaleDateString(formatLocale(), {
            month: 'short',
            day: 'numeric',
          })}
        </h2>
        <div class="flex flex-col gap-2">
          <For
            each={month.events()}
            fallback={
              <p class="py-3 text-sm text-ink-extra-muted">
                {t(
                  isSupported(month.selected())
                    ? 'calendar.agendaNoEvents'
                    : 'calendar.agendaOutOfRange'
                )}
              </p>
            }
          >
            {(event) => (
              <PhoneMonthEvent
                event={event}
                timeFormat={props.timeFormat}
                onSelect={props.onSelect}
              />
            )}
          </For>
        </div>
      </div>
    </div>
  );
}
