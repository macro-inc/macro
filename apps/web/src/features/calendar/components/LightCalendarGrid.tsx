import { formatLocale, t } from '@app/lib/i18n';
import { formatLocalDate } from '@core/util/local-date';
import { Telemetry } from '@macro-inc/observability';
import { createElementSize } from '@solid-primitives/resize-observer';
import { isSameDay } from 'date-fns';
import {
  createMemo,
  createSignal,
  For,
  Index,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import {
  ALL_DAY_ROW_MAX_HEIGHT,
  ALL_DAY_ROW_MIN_HEIGHT,
} from '../core/all-day-row';
import type { DayDraftRange } from '../core/day-draft';
import {
  clipLightDayBars,
  type LightCalendarEvent,
  lightCalendarEvents,
  lightDayBars,
  lightGridDays,
  lightMonthRows,
  lightTimeBlocks,
} from '../core/light-grid';
import type { CalendarPageDateInfo } from '../core/page-range';
import type { CalendarEvent } from '../types';
import {
  formatCompactCalendarTime,
  formatCompactCalendarTimeRange,
} from '../utils/time-format';
import { mergeWorkingLocationEvents } from '../utils/working-location-events';
import type { CalendarGridSettings } from './CalendarGrid';
import { DayDraftContent } from './DayDraftContent';
import { EventContent } from './EventContent';
import '../calendar.css';
import '../calendar-light-grid.css';

interface LightCalendarGridProps {
  date: Date;
  now: Date;
  dateInfo: CalendarPageDateInfo;
  events: CalendarEvent[];
  settings: CalendarGridSettings;
  initialScrollTop?: number;
  selectedEventId?: string;
  draftRange?: DayDraftRange;
  selectionColor?: string;
  onElement?: (element: HTMLDivElement | undefined) => void;
}

type LightRenderedEvent = CalendarEvent | { draft: true; title: string };
/** Static projection of one supplied range. No queries, timers, or editing API. */
export function LightCalendarGrid(props: LightCalendarGridProps) {
  const [root, setRoot] = createSignal<HTMLDivElement>();
  const [axisWidth, setAxisWidth] = createSignal(50);
  const size = createElementSize(root);
  onCleanup(() => props.onElement?.(undefined));
  const groupedEvents = createMemo(() =>
    mergeWorkingLocationEvents(props.events)
  );
  const selectedId = createMemo(() => {
    const id = props.selectedEventId;
    if (id === undefined) return undefined;
    return (
      groupedEvents().find(({ occurrenceIds }) => occurrenceIds.includes(id))
        ?.event.id ?? id
    );
  });
  const events = createMemo(() => {
    const span = Telemetry.span('calendar.page.project', { sampling: 'perf' });
    span.setAttr('calendar.view', props.settings.initialView);
    span.setAttr('calendar.event_count', groupedEvents().length);
    try {
      return span.run(() =>
        lightCalendarEvents(groupedEvents().map(({ event }) => event))
      );
    } finally {
      span.end();
    }
  });
  const days = createMemo(() =>
    lightGridDays(
      props.dateInfo.start,
      props.dateInfo.end,
      props.settings.showWeekends
    )
  );
  const timedEvents = createMemo<LightCalendarEvent<LightRenderedEvent>[]>(
    () => {
      const range = props.draftRange;
      if (!range) return events();
      return [
        ...events(),
        {
          event: { draft: true as const, title: t('calendar.newEvent') },
          ...range,
          allDay: false,
        },
      ].sort(
        (a, b) =>
          +a.start - +b.start ||
          +b.end - +b.start - (+a.end - +a.start) ||
          a.event.title.localeCompare(b.event.title)
      );
    }
  );
  const month = () => props.settings.initialView === 'dayGridMonth';
  const today = () => props.now;
  const hourHeight = () =>
    props.settings.initialView === 'timeGridThreeDay' &&
    !props.settings.compactAllDaySlot
      ? 36
      : 64;
  const columnStyle = () => ({
    'grid-template-columns': `repeat(${Math.max(1, days().length)}, minmax(0, 1fr))`,
  });
  const allDay = createMemo(() => lightDayBars(events(), days()));
  const allDayRows = createMemo(() =>
    clipLightDayBars(allDay(), days().length, 2)
  );
  const weeks = createMemo(() => {
    const count = props.settings.showWeekends ? 7 : 5;
    return Array.from(
      { length: Math.ceil(days().length / count) },
      (_, index) => {
        const dates = days().slice(index * count, (index + 1) * count);
        return { dates, bars: lightDayBars(events(), dates, true) };
      }
    );
  });
  const visibleWeeks = createMemo(() => {
    const available = Math.max(
      0,
      ((size.height ?? 0) - 36) / Math.max(1, weeks().length) - 38
    );
    return weeks().map((week) => ({
      ...week,
      ...lightMonthRows(week.bars, week.dates.length, available),
    }));
  });
  const content = (event: () => CalendarEvent, allDay: () => boolean) => (
    <EventContent
      event={event()}
      renderProps={{
        event: {
          get allDay() {
            return allDay();
          },
        },
        view: { type: props.settings.initialView },
        timeText: '',
      }}
      isSelected={event().id === selectedId()}
      timeFormat={props.settings.timeFormat}
      isNarrow={props.settings.useNarrowEventContent}
    />
  );
  const eventStyle = (event: CalendarEvent) => ({
    '--event-calendar-color': event.calendar.color,
  });
  const eventClasses = (event: CalendarEvent) => ({
    'calendar-event-out-of-office': event.eventType === 'out_of_office',
  });
  const weekday = (date: Date) =>
    date.toLocaleDateString(formatLocale(), {
      weekday: props.settings.useNarrowDayHeaders ? 'narrow' : 'short',
    });
  const dayClass = (date: Date) => ({
    'fc-day-today': isSameDay(date, today()),
    'calendar-day-selected': isSameDay(date, props.date),
  });
  const hours = Array.from({ length: 48 }, (_, index) => index);
  let scroller: HTMLDivElement | undefined;
  onMount(() => {
    if (!props.settings.compactAllDaySlot) {
      const label = root()?.querySelector<HTMLElement>(
        '.fc-timegrid-axis-cushion'
      );
      if (label) setAxisWidth(Math.ceil(label.getBoundingClientRect().width));
    }
    if (scroller)
      scroller.scrollTop = props.initialScrollTop ?? 7 * hourHeight() - 31;
  });
  return (
    <div
      class="calendar-view size-full min-w-0 min-h-0 overflow-hidden"
      aria-hidden="true"
    >
      <div
        ref={(element) => {
          setRoot(element);
          props.onElement?.(element);
        }}
        class="calendar-view-host calendar-light-grid fc-media-screen fc-direction-ltr size-full min-h-0"
        style={{
          '--calendar-light-hour': `${hourHeight()}px`,
          '--calendar-selection-color': props.selectionColor,
          '--calendar-all-day-event-height': '20px',
          '--calendar-all-day-min-height': '24px',
          '--calendar-all-day-max-height': '48px',
          '--calendar-light-axis': props.settings.compactAllDaySlot
            ? '46px'
            : `${axisWidth()}px`,
        }}
      >
        <Show
          when={!month()}
          fallback={
            <div class="fc-dayGridMonth-view calendar-light-month fc-view">
              <table
                class="calendar-light-month-table"
                style={{
                  width:
                    size.width === null
                      ? '100%'
                      : `${Math.floor(size.width)}px`,
                }}
              >
                <thead>
                  <tr>
                    <Index each={weeks()[0]?.dates}>
                      {(date) => (
                        <th class="fc-col-header-cell">
                          <span class="fc-col-header-cell-cushion">
                            {weekday(date())}
                          </span>
                        </th>
                      )}
                    </Index>
                  </tr>
                </thead>
                <tbody>
                  <Index each={visibleWeeks()}>
                    {(week) => (
                      <tr>
                        <Index each={week().dates}>
                          {(date, column) => (
                            <td
                              class="fc-daygrid-day"
                              data-date={formatLocalDate(date())}
                              classList={{
                                ...dayClass(date()),
                                'fc-day-other':
                                  date().getMonth() !== props.date.getMonth(),
                              }}
                            >
                              <div class="fc-daygrid-day-frame">
                                <div class="fc-daygrid-day-top">
                                  <span class="fc-daygrid-day-number">
                                    {date().getDate()}
                                  </span>
                                </div>
                                <div class="fc-daygrid-day-events">
                                  <Index
                                    each={week().bars.filter(
                                      (bar) => bar.start === column
                                    )}
                                  >
                                    {(bar) => (
                                      <div
                                        class="fc-daygrid-event-harness calendar-light-month-event"
                                        style={{
                                          top: `${week().offsets[bar().lane]}px`,
                                          width: `calc(${(bar().end - bar().start) * 100}% + ${bar().end - bar().start - 1}px)`,
                                        }}
                                      >
                                        <div
                                          class="fc-event fc-h-event fc-daygrid-event calendar-month-event"
                                          classList={eventClasses(
                                            bar().item.event
                                          )}
                                          style={eventStyle(bar().item.event)}
                                        >
                                          <div class="fc-event-main">
                                            {content(
                                              () => bar().item.event,
                                              () => bar().item.allDay
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                  </Index>
                                  <Show when={week().hidden[column]}>
                                    {(count) => (
                                      <span
                                        class="fc-daygrid-more-link calendar-light-more"
                                        style={{
                                          top: `${week().overflowTop}px`,
                                        }}
                                      >
                                        {t('calendar.moreEvents', {
                                          count: count(),
                                        })}
                                      </span>
                                    )}
                                  </Show>
                                </div>
                              </div>
                            </td>
                          )}
                        </Index>
                      </tr>
                    )}
                  </Index>
                </tbody>
              </table>
            </div>
          }
        >
          <div
            class={`fc-timegrid fc-${props.settings.initialView}-view calendar-light-timegrid fc-view`}
          >
            <div class="calendar-light-header">
              <div />
              <div class="calendar-light-header-days" style={columnStyle()}>
                <Index each={days()}>
                  {(date) => (
                    <div
                      class="fc-col-header-cell"
                      classList={dayClass(date())}
                    >
                      <span class="fc-col-header-cell-cushion">
                        <span class="calendar-day-header-weekday">
                          {weekday(date())}
                        </span>
                        <span
                          class="calendar-day-header-date"
                          classList={{
                            'calendar-day-header-date-selected': isSameDay(
                              date(),
                              props.date
                            ),
                          }}
                        >
                          {date().getDate()}
                        </span>
                      </span>
                    </div>
                  )}
                </Index>
              </div>
            </div>
            <div
              class="calendar-light-all-day"
              style={{
                'min-height':
                  props.settings.compactAllDaySlot &&
                  props.settings.initialView === 'timeGridWeek'
                    ? `${ALL_DAY_ROW_MAX_HEIGHT}px`
                    : `${ALL_DAY_ROW_MIN_HEIGHT}px`,
              }}
            >
              <div class="fc-timegrid-axis">
                <span class="fc-timegrid-axis-cushion">
                  {props.settings.compactAllDaySlot ? '' : t('calendar.allDay')}
                </span>
              </div>
              <div class="calendar-light-all-day-events" style={columnStyle()}>
                <Index each={allDayRows().bars}>
                  {(bar) => (
                    <div
                      class="fc-daygrid-event-harness calendar-light-all-day-event"
                      style={{
                        'grid-column': `${bar().start + 1} / ${bar().end + 1}`,
                        'grid-row': bar().lane + 1,
                      }}
                    >
                      <div
                        class="fc-event fc-h-event fc-daygrid-event"
                        classList={eventClasses(bar().item.event)}
                        style={eventStyle(bar().item.event)}
                      >
                        <div class="fc-event-main">
                          {content(
                            () => bar().item.event,
                            () => true
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </Index>
                <Index each={allDayRows().hidden}>
                  {(count, column) => (
                    <Show when={count() > 0}>
                      <span
                        class="fc-daygrid-more-link calendar-light-all-day-event"
                        style={{ 'grid-column': column + 1, 'grid-row': 2 }}
                      >
                        {t('calendar.moreEvents', { count: count() })}
                      </span>
                    </Show>
                  )}
                </Index>
              </div>
            </div>
            <div class="fc-scroller-harness-liquid calendar-light-scroller-harness">
              <div ref={scroller} class="fc-scroller calendar-light-scroller">
                <div class="fc-timegrid-body calendar-light-body">
                  <div class="fc-timegrid-slots calendar-light-slots">
                    <For each={hours}>
                      {(index) => {
                        const date = new Date(
                          2000,
                          0,
                          1,
                          Math.floor(index / 2),
                          (index % 2) * 30
                        );
                        const time = `${String(Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}:00`;
                        return (
                          <div
                            class="fc-timegrid-slot-lane fc-timegrid-slot calendar-light-slot"
                            classList={{
                              'fc-timegrid-slot-minor': index % 2 === 1,
                            }}
                            data-time={time}
                          >
                            <Show when={index % 2 === 0}>
                              <span class="fc-timegrid-slot-label">
                                <span class="fc-timegrid-slot-label-cushion">
                                  {formatCompactCalendarTime(
                                    date,
                                    props.settings.timeFormat
                                  )}
                                </span>
                              </span>
                            </Show>
                          </div>
                        );
                      }}
                    </For>
                  </div>
                  <table
                    class="calendar-light-columns fc-scrollgrid-sync-table"
                    style={{
                      width:
                        size.width === null
                          ? '100%'
                          : `${Math.floor(size.width)}px`,
                    }}
                  >
                    <colgroup>
                      <col
                        style={{
                          width: props.settings.compactAllDaySlot
                            ? '46px'
                            : `${axisWidth()}px`,
                        }}
                      />
                      <col span={days().length} />
                    </colgroup>
                    <tbody>
                      <tr>
                        <td class="fc-timegrid-axis" />
                        <Index each={days()}>
                          {(date) => (
                            <td
                              class="fc-timegrid-col"
                              data-date={formatLocalDate(date())}
                            >
                              <div class="fc-timegrid-col-frame">
                                <div class="fc-timegrid-col-events">
                                  <Index
                                    each={lightTimeBlocks(
                                      timedEvents(),
                                      date(),
                                      hourHeight()
                                    )}
                                  >
                                    {(block) => {
                                      const persisted = () => {
                                        const event = block().event;
                                        return 'draft' in event
                                          ? undefined
                                          : event;
                                      };
                                      return (
                                        <div
                                          class="fc-timegrid-event-harness"
                                          style={{
                                            position: 'absolute',
                                            top: `${block().top}px`,
                                            height: `${block().bottom - block().top}px`,
                                            left: `${block().near * 100}%`,
                                            right: `${(1 - block().far) * 100}%`,
                                            'z-index': block().depth + 1,
                                          }}
                                        >
                                          <Show
                                            when={persisted()}
                                            fallback={
                                              <div class="fc-event fc-v-event fc-timegrid-event calendar-day-draft">
                                                <div class="fc-event-main">
                                                  <DayDraftContent
                                                    renderProps={{
                                                      timeText: props.draftRange
                                                        ? formatCompactCalendarTimeRange(
                                                            props.draftRange
                                                              .start,
                                                            props.draftRange
                                                              .end,
                                                            props.settings
                                                              .timeFormat
                                                          )
                                                        : '',
                                                    }}
                                                  />
                                                </div>
                                              </div>
                                            }
                                          >
                                            {(event) => (
                                              <div
                                                class="fc-event fc-v-event fc-timegrid-event"
                                                classList={eventClasses(
                                                  event()
                                                )}
                                                style={eventStyle(event())}
                                              >
                                                <div class="fc-event-main">
                                                  {content(event, () => false)}
                                                </div>
                                              </div>
                                            )}
                                          </Show>
                                        </div>
                                      );
                                    }}
                                  </Index>
                                </div>
                              </div>
                            </td>
                          )}
                        </Index>
                      </tr>
                    </tbody>
                  </table>
                  <Show when={days().some((date) => isSameDay(date, today()))}>
                    <div
                      class="fc-timegrid-now-indicator-line calendar-light-now"
                      style={{
                        top: `${(today().getHours() + today().getMinutes() / 60) * hourHeight()}px`,
                      }}
                    >
                      <span
                        class="calendar-now-time"
                        data-axis-label={formatCompactCalendarTime(
                          today(),
                          props.settings.timeFormat,
                          false
                        )}
                      />
                    </div>
                  </Show>
                </div>
              </div>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}
