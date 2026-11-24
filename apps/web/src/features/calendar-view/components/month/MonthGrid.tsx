import type {
  CalendarEvent,
  CalendarTimeFormat,
} from '@app/features/calendar/types';
import { isSameLocalDate } from '@app/features/calendar/utils/calendar-date';
import { formatCompactCalendarTime } from '@app/features/calendar/utils/time-format';
import { formatLocale, t } from '@app/lib/i18n';
import { Layer } from '@ui';
import { createUniqueId, For, Show } from 'solid-js';
import {
  type MonthBar,
  type MonthDay,
  PHONE_MONTH_DATE_HEIGHT,
  PHONE_MONTH_EVENT_HEIGHT,
  PHONE_MONTH_ROW_PITCH,
} from '../../core/phone-month-layout';
import './month-grid.css';

export type MonthWeek = {
  days: readonly MonthDay<CalendarEvent>[];
  bars: MonthBar<CalendarEvent>[];
  hidden: number[];
};

export function MonthGrid(props: {
  weeks: MonthWeek[];
  month: Date;
  today: Date;
  selected: Date | undefined;
  timeFormat: CalendarTimeFormat;
  capacity: number;
  cardRef: (element: HTMLDivElement) => void;
  isSupported: (date: Date) => boolean;
  onPick: (date: Date, element: HTMLButtonElement) => void;
}) {
  const descriptionId = createUniqueId();
  const fullDate = (date: Date) =>
    date.toLocaleDateString(formatLocale(), { dateStyle: 'full' });
  return (
    <div
      class="phone-month-bars"
      aria-label={t('calendar.monthCalendar')}
      style={{ '--phone-month-event-height': `${PHONE_MONTH_EVENT_HEIGHT}px` }}
    >
      <div
        class="phone-month-weekdays"
        style={{
          'grid-template-columns': `repeat(${props.weeks[0]?.days.length ?? 7}, minmax(0, 1fr))`,
        }}
      >
        <For each={props.weeks[0]?.days}>
          {(day) => (
            <span
              classList={{
                'phone-month-weekday-today':
                  day.date.getDay() === props.today.getDay(),
              }}
            >
              {day.date.toLocaleDateString(formatLocale(), {
                weekday: 'short',
              })}
            </span>
          )}
        </For>
      </div>
      <Layer offset={1}>
        <div
          ref={props.cardRef}
          class="phone-month-card bg-surface"
          style={{
            'grid-template-rows': `repeat(${props.weeks.length}, minmax(0, 1fr))`,
          }}
        >
          <For each={props.weeks}>
            {(week) => (
              <div
                class="phone-month-week"
                style={{
                  'grid-template-columns': `repeat(${week.days.length}, minmax(0, 1fr))`,
                  '--phone-month-columns': week.days.length,
                }}
              >
                <For each={week.days}>
                  {(day, index) => (
                    <button
                      type="button"
                      class="phone-month-day outline-none focus-visible:inset-ring-2 focus-visible:inset-ring-accent aria-pressed:not-focus-visible:inset-ring-1 aria-pressed:inset-ring-accent"
                      style={{ 'grid-column': index() + 1 }}
                      classList={{
                        'phone-month-day-selected':
                          !!props.selected &&
                          isSameLocalDate(day.date, props.selected),
                        'phone-month-day-outside':
                          day.date.getMonth() !== props.month.getMonth(),
                      }}
                      aria-label={fullDate(day.date)}
                      aria-describedby={
                        day.events.length
                          ? `${descriptionId}-${day.date.getTime()}`
                          : undefined
                      }
                      aria-pressed={
                        !!props.selected &&
                        isSameLocalDate(day.date, props.selected)
                      }
                      disabled={!props.isSupported(day.date)}
                      onClick={(event) =>
                        props.onPick(day.date, event.currentTarget)
                      }
                    >
                      <span
                        class="sr-only"
                        id={`${descriptionId}-${day.date.getTime()}`}
                      >
                        {day.events
                          .map(
                            (event) =>
                              event.title || t('calendar.agendaUntitled')
                          )
                          .join('; ')}
                      </span>
                      <span
                        class="phone-month-date"
                        classList={{
                          'bg-accent text-button-accent-ink': isSameLocalDate(
                            day.date,
                            props.today
                          ),
                        }}
                      >
                        {day.date.getDate()}
                      </span>
                      {props.capacity > 0 && week.hidden[index()]! > 0 && (
                        <span
                          class="phone-month-overflow"
                          style={{
                            top: `${PHONE_MONTH_DATE_HEIGHT + (props.capacity - 1) * PHONE_MONTH_ROW_PITCH}px`,
                          }}
                        >
                          +{week.hidden[index()]}
                        </span>
                      )}
                    </button>
                  )}
                </For>
                <For each={week.bars}>
                  {(bar) => (
                    <div
                      aria-hidden="true"
                      class="phone-month-bar"
                      classList={{
                        'phone-month-bar-timed':
                          bar.kind === 'timed' &&
                          bar.event.eventType !== 'out_of_office',
                        'calendar-event-out-of-office':
                          bar.event.eventType === 'out_of_office',
                      }}
                      data-response-status={
                        bar.event.attendees.find((attendee) => attendee.isSelf)
                          ?.responseStatus
                      }
                      style={{
                        'grid-column': `${bar.startColumn + 1} / ${bar.endColumn + 1}`,
                        top: `${PHONE_MONTH_DATE_HEIGHT + bar.lane * PHONE_MONTH_ROW_PITCH}px`,
                        '--event-calendar-color': bar.event.calendar.color,
                      }}
                    >
                      <Show
                        when={
                          bar.kind === 'timed' &&
                          bar.event.eventType !== 'out_of_office'
                        }
                      >
                        <span class="calendar-event-response-dot" />
                      </Show>
                      <span class="calendar-event-title">
                        {bar.event.title || t('calendar.agendaUntitled')}
                      </span>
                      <Show when={!bar.event.allDay}>
                        <span class="calendar-event-time">
                          {formatCompactCalendarTime(
                            new Date(bar.event.start),
                            props.timeFormat
                          )}
                        </span>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
      </Layer>
    </div>
  );
}
