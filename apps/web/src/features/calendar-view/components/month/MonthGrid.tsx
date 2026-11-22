import type { CalendarEvent } from '@app/features/calendar/types';
import { isSameLocalDate } from '@app/features/calendar/utils/calendar-date';
import { formatLocale, t } from '@app/lib/i18n';
import { Layer } from '@ui';
import { For } from 'solid-js';
import type { MonthBar, MonthDay } from '../../core/phone-month-layout';
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
  capacity: number;
  cardRef: (element: HTMLDivElement) => void;
  isSupported: (date: Date) => boolean;
  onPick: (date: Date, element: HTMLButtonElement) => void;
}) {
  const fullDate = (date: Date) =>
    date.toLocaleDateString(formatLocale(), { dateStyle: 'full' });
  return (
    <div class="phone-month-bars" aria-label="Month calendar">
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
                weekday: 'narrow',
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
                }}
              >
                <For each={week.days}>
                  {(day, index) => (
                    <button
                      type="button"
                      class="phone-month-day"
                      classList={{
                        'phone-month-day-selected':
                          !!props.selected &&
                          isSameLocalDate(day.date, props.selected),
                        'phone-month-day-outside':
                          day.date.getMonth() !== props.month.getMonth(),
                      }}
                      aria-label={fullDate(day.date)}
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
                      {week.hidden[index()]! > 0 && (
                        <span
                          class="phone-month-overflow"
                          style={{
                            top: `${32 + (props.capacity - 1) * 16}px`,
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
                      style={{
                        'grid-column': `${bar.startColumn + 1} / ${bar.endColumn + 1}`,
                        top: `${32 + bar.lane * 16}px`,
                        '--event-calendar-color': bar.event.calendar.color,
                        'mask-image': `linear-gradient(to right, ${week.days
                          .slice(bar.startColumn, bar.endColumn)
                          .flatMap((day, index, days) => {
                            const color =
                              day.date.getMonth() === props.month.getMonth()
                                ? '#000'
                                : '#0008';
                            return [
                              `${color} ${(index / days.length) * 100}%`,
                              `${color} ${((index + 1) / days.length) * 100}%`,
                            ];
                          })
                          .join(', ')})`,
                      }}
                    >
                      <span>
                        {bar.event.title || t('calendar.agendaUntitled')}
                      </span>
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
