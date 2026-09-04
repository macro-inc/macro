import {
  FullCalendar,
  type FullCalendarContextValue,
  useFullCalendar,
} from '@app/lib/fullcalendar-solid';
import type {
  DateSelectArg,
  DatesSetArg,
  EventInput,
} from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import timeGridPlugin from '@fullcalendar/timegrid';
import {
  type Accessor,
  createMemo,
  createSignal,
  type JSX,
  Show,
} from 'solid-js';
import { useTimeGridOpeningScroll } from '../hooks/use-time-grid-opening-scroll';
import {
  type CalendarEvent,
  type CalendarPeriodView,
  type CalendarTimeFormat,
  type CalendarWeekStart,
  mapCalendarEventToFullCalendar,
} from '../types';
import { isSameLocalDate } from '../utils/calendar-date';
import {
  type CalendarEventTimeChange,
  calendarEventRenderId,
  calendarEventRenderIds,
} from '../utils/event-interaction';
import {
  isMultiDaySelectionPreview,
  multiDaySelectionRenderingPlugin,
} from '../utils/fullcalendar-multi-day-selection';
import {
  CALENDAR_TIME_FORMAT_OPTIONS,
  formatCalendarTime,
  formatCompactCalendarTime,
} from '../utils/time-format';
import { TIME_GRID_OPENING_SCROLL_TIME } from '../utils/time-grid-scroller';
import { mergeWorkingLocationEvents } from '../utils/working-location-events';
import { EventContent } from './EventContent';
import '../calendar.css';

const formatWeekdayHeader = {
  narrow: new Intl.DateTimeFormat(undefined, {
    weekday: 'narrow',
  }).format,
  short: new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
  }).format,
};

const formatDayNumber = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
}).format;

function CurrentTimeAxisIndicator(props: {
  date: Date;
  timeFormat: CalendarTimeFormat;
}) {
  return (
    <span class="calendar-now-axis-indicator">
      <span class="calendar-now-time">
        {formatCalendarTime(props.date, props.timeFormat)}
      </span>
    </span>
  );
}

export interface CalendarGridHandle extends FullCalendarContextValue {
  element: Accessor<HTMLDivElement | undefined>;
  eventElements: Map<string, HTMLElement>;
  chipMounts: Accessor<undefined>;
}

export interface CalendarGridSettings {
  initialView: CalendarPeriodView;
  /** Consecutive visible days for time-grid embeds. */
  dayCount?: number;
  showDayHeaders?: boolean;
  showAllDaySlot?: boolean;
  showWeekends: boolean;
  weekStartsOn: CalendarWeekStart;
  timeFormat: CalendarTimeFormat;
  useNarrowDayHeaders: boolean;
  useNarrowEventContent: boolean;
}

export interface CalendarGridSelection {
  color: string;
  eventId?: string;
  onDateSelect?: (selection: DateSelectArg) => void;
  onEventSelect?: (event: CalendarEvent, element: HTMLElement) => void;
}

export interface CalendarGridProps {
  initialDate: Date;
  events: CalendarEvent[];
  eventsById: Map<string, CalendarEvent>;
  settings: CalendarGridSettings;
  selection: CalendarGridSelection;
  /** Rendered occurrence ids that should visually stand out from nearby events. */
  emphasizedEventIds?: ReadonlySet<string>;
  eventTimeChangePending?: boolean;
  onDatesSet?: (info: DatesSetArg) => void;
  onEventTimeChange?: (
    change: CalendarEventTimeChange,
    event: CalendarEvent | undefined
  ) => void;
  children?: (handle: CalendarGridHandle) => JSX.Element;
}

function CalendarGridHost(props: {
  selectionColor: string;
  eventElements: Map<string, HTMLElement>;
  chipMounts: Accessor<undefined>;
  children?: CalendarGridProps['children'];
}) {
  const calendar = useFullCalendar();
  const [element, setElement] = createSignal<HTMLDivElement>();

  useTimeGridOpeningScroll(element, calendar.api);

  const handle: CalendarGridHandle = {
    api: calendar.api,
    dateInfo: calendar.dateInfo,
    element,
    eventElements: props.eventElements,
    chipMounts: props.chipMounts,
  };

  return (
    <>
      <div class="calendar-view size-full min-w-0 min-h-0 overflow-hidden">
        <FullCalendar.Host
          tabIndex={-1}
          ref={setElement}
          style={{ '--calendar-selection-color': props.selectionColor }}
          class="calendar-view-host size-full min-w-0 min-h-0 overflow-hidden"
        />
      </div>
      {props.children?.(handle)}
    </>
  );
}

/** Query-free, single-page calendar grid. */
export function CalendarGrid(props: CalendarGridProps) {
  const mappedEvents = createMemo<EventInput[]>(() =>
    mergeWorkingLocationEvents(props.events).map(({ event, occurrenceIds }) => {
      const mapped = mapCalendarEventToFullCalendar(event);
      const emphasized = occurrenceIds.some((id) =>
        props.emphasizedEventIds?.has(id)
      );
      return {
        ...mapped,
        classNames: emphasized ? ['calendar-event-emphasized'] : undefined,
        startEditable: props.onEventTimeChange ? mapped.startEditable : false,
        durationEditable: props.onEventTimeChange
          ? mapped.durationEditable
          : false,
        extendedProps:
          occurrenceIds.length > 1
            ? { ...mapped.extendedProps, mergedOccurrenceIds: occurrenceIds }
            : mapped.extendedProps,
      };
    })
  );
  const [eventInteractionActive, setEventInteractionActive] =
    createSignal(false);
  const renderedEvents = createMemo<EventInput[]>(
    (current) => (eventInteractionActive() ? current : mappedEvents()),
    mappedEvents()
  );
  let interactionEventsById: Map<string, CalendarEvent> | undefined;

  const eventByRenderId = (id: string) =>
    interactionEventsById?.get(id) ?? props.eventsById.get(id);
  const handleEventInteractionStart = () => {
    interactionEventsById = props.eventsById;
    setEventInteractionActive(true);
  };
  const handleEventInteractionStop = () => {
    queueMicrotask(() => {
      interactionEventsById = undefined;
      setEventInteractionActive(false);
    });
  };

  const eventElements = new Map<string, HTMLElement>();
  const [chipMounts, notifyChipMount] = createSignal(undefined, {
    equals: false,
  });

  return (
    <FullCalendar.Root
      plugins={[
        dayGridPlugin,
        interactionPlugin,
        timeGridPlugin,
        multiDaySelectionRenderingPlugin,
      ]}
      initialView={props.settings.initialView}
      initialDate={props.initialDate}
      dayCount={props.settings.dayCount}
      dateIncrement={
        props.settings.dayCount === undefined
          ? undefined
          : { days: props.settings.dayCount }
      }
      dateAlignment={props.settings.dayCount === undefined ? undefined : 'day'}
      dayHeaders={props.settings.showDayHeaders ?? true}
      allDaySlot={props.settings.showAllDaySlot ?? true}
      height="100%"
      expandRows
      fixedWeekCount={false}
      handleWindowResize={false}
      allDayText="All day"
      nowIndicator
      headerToolbar={false}
      scrollTime={TIME_GRID_OPENING_SCROLL_TIME}
      scrollTimeReset={false}
      weekends={props.settings.showWeekends}
      firstDay={props.settings.weekStartsOn}
      slotLabelFormat={CALENDAR_TIME_FORMAT_OPTIONS[props.settings.timeFormat]}
      eventTimeFormat={CALENDAR_TIME_FORMAT_OPTIONS[props.settings.timeFormat]}
      events={renderedEvents()}
      eventAllow={() =>
        props.onEventTimeChange !== undefined &&
        props.eventTimeChangePending !== true
      }
      eventResizableFromStart
      eventDragStart={handleEventInteractionStart}
      eventDragStop={handleEventInteractionStop}
      eventDrop={(change) =>
        props.onEventTimeChange?.(
          change,
          eventByRenderId(calendarEventRenderId(change.event))
        )
      }
      eventResizeStart={handleEventInteractionStart}
      eventResizeStop={handleEventInteractionStop}
      eventResize={(change) =>
        props.onEventTimeChange?.(
          change,
          eventByRenderId(calendarEventRenderId(change.event))
        )
      }
      selectable={props.selection.onDateSelect !== undefined}
      unselectAuto={false}
      selectMirror
      // A zero-distance selection lets a click create one snapped time slot,
      // while pointer movement still supports selecting a longer range.
      selectMinDistance={0}
      snapDuration="00:30:00"
      select={(selection) => props.selection.onDateSelect?.(selection)}
      eventClick={
        props.selection.onEventSelect
          ? ({ el, event, jsEvent }) => {
              jsEvent.preventDefault();
              const selectedEvent = eventByRenderId(
                calendarEventRenderId(event)
              );
              if (selectedEvent)
                props.selection.onEventSelect?.(selectedEvent, el);
            }
          : undefined
      }
      eventDidMount={({ el, event, isMirror }) => {
        const eventId = calendarEventRenderId(event);
        const calendarEvent = eventByRenderId(eventId);
        if (calendarEvent) {
          el.style.setProperty(
            '--event-calendar-color',
            calendarEvent.calendar.color
          );
        }
        if (isMirror || isMultiDaySelectionPreview(event)) return;

        const occurrenceIds = calendarEventRenderIds(event);
        for (const id of occurrenceIds) eventElements.set(id, el);
        const selectedId = props.selection.eventId;
        if (selectedId !== undefined && occurrenceIds.includes(selectedId)) {
          const selected = eventByRenderId(selectedId);
          if (selected) props.selection.onEventSelect?.(selected, el);
        }
        notifyChipMount();
      }}
      eventWillUnmount={({ el, event, isMirror }) => {
        if (isMirror || isMultiDaySelectionPreview(event)) return;

        for (const id of calendarEventRenderIds(event)) {
          if (eventElements.get(id) === el) {
            eventElements.delete(id);
          }
        }
      }}
      datesSet={(info) => props.onDatesSet?.(info)}
      dayHeaderFormat={{
        weekday: props.settings.useNarrowDayHeaders ? 'narrow' : 'short',
      }}
      dayCellClassNames={({ date, view }) =>
        isSameLocalDate(date, view.calendar.getDate())
          ? ['calendar-day-selected']
          : []
      }
    >
      <FullCalendar.DayHeaderContent>
        {({ date, text, view }) => {
          if (view.type === 'timeGridWeek' || view.type === 'timeGridDay') {
            const isSingleDayView =
              view.type === 'timeGridDay' &&
              (props.settings.dayCount ?? 1) === 1;
            const weekday = isSingleDayView
              ? formatWeekdayHeader.short(date)
              : formatWeekdayHeader[
                  props.settings.useNarrowDayHeaders ? 'narrow' : 'short'
                ](date);

            return (
              <>
                <span class="calendar-day-header-weekday">{weekday}</span>{' '}
                <span
                  class="calendar-day-header-date"
                  classList={{
                    'calendar-day-header-date-selected': isSameLocalDate(
                      date,
                      view.calendar.getDate()
                    ),
                  }}
                >
                  {formatDayNumber(date)}
                </span>
              </>
            );
          }
          return text;
        }}
      </FullCalendar.DayHeaderContent>

      <FullCalendar.SlotLabelContent>
        {({ date }) =>
          formatCompactCalendarTime(date, props.settings.timeFormat)
        }
      </FullCalendar.SlotLabelContent>

      <FullCalendar.EventContent>
        {(renderProps) => {
          const event = eventByRenderId(
            calendarEventRenderId(renderProps.event)
          );
          if (
            !event &&
            (isMultiDaySelectionPreview(renderProps.event) ||
              (renderProps.isMirror &&
                !renderProps.isDragging &&
                !renderProps.isResizing))
          ) {
            return (
              <div class="calendar-event-selection-preview flex h-full min-w-0 flex-col overflow-hidden px-1 py-0.5 text-xs leading-tight">
                <span class="truncate font-semibold">New event</span>
                <Show when={renderProps.timeText}>
                  <span class="truncate">{renderProps.timeText}</span>
                </Show>
              </div>
            );
          }
          if (!event) return null;

          const selectedId = props.selection.eventId;
          return (
            <EventContent
              event={event}
              renderProps={renderProps}
              isSelected={
                selectedId !== undefined &&
                calendarEventRenderIds(renderProps.event).includes(selectedId)
              }
              timeFormat={props.settings.timeFormat}
              isNarrow={props.settings.useNarrowEventContent}
            />
          );
        }}
      </FullCalendar.EventContent>

      <FullCalendar.NowIndicatorContent>
        {({ isAxis }) => {
          if (isAxis) return null;

          return (
            <CurrentTimeAxisIndicator
              date={new Date()}
              timeFormat={props.settings.timeFormat}
            />
          );
        }}
      </FullCalendar.NowIndicatorContent>

      <CalendarGridHost
        selectionColor={props.selection.color}
        eventElements={eventElements}
        chipMounts={chipMounts}
        children={props.children}
      />
    </FullCalendar.Root>
  );
}
