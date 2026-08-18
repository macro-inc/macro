import { toast } from '@core/component/Toast/Toast';
import { ScrollIndicators } from '@core/component/VerticalScrollIndicators';
import { useUserId } from '@core/context/user';
import { isMobile } from '@core/mobile/isMobile';
import type {
  DateSelectArg,
  DatesSetArg,
  EventInput,
} from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import timeGridPlugin from '@fullcalendar/timegrid';
import SpinnerIcon from '@phosphor/spinner-gap.svg';
import { useVisibleCalendarsQuery } from '@queries/calendar/calendars';
import { useUpdateCalendarEventMutation } from '@queries/calendar/mutations';
import {
  type CalendarOccurrenceQueryRange,
  createCalendarOccurrenceQueryRange,
  useCalendarOccurrencesQuery,
} from '@queries/calendar/occurrences';
import { CalendarSyncStatus } from '@service-storage/generated/schemas/calendarSyncStatus';
import { Button } from '@ui';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import {
  type CalendarPageData,
  type CalendarPageId,
  useCalendarPager,
} from './CalendarPagerContext';
import { useCalendarView } from './CalendarViewContext';
import {
  calendarFocusTargetId,
  useCalendarFocus,
} from './calendar-focus-target';
import { isCalendarRangeSupported } from './calendar-supported-range';
import {
  DEFAULT_CALENDAR_SOURCE,
  mapCalendarOccurrence,
} from './events/calendar-occurrence-mapper';
import { CalendarEventContent } from './events/EventContent';
import { calendarSelectionToEditorInitialValues } from './events/EventEditorForm';
import {
  type CalendarEventTimeChange,
  calendarEventRenderId,
  calendarEventTimeFromFullCalendar,
  canEditCalendarEventTime,
} from './events/event-interaction';
import { mapCalendarEventToFullCalendar } from './events/event-mapper';
import {
  isMultiDaySelectionPreview,
  multiDaySelectionRenderingPlugin,
} from './events/multi-day-selection-rendering';
import type { CalendarTimeFormat } from './events/types';
import { useOpenEventComposer } from './events/useOpenEventComposer';
import { FullCalendar, useFullCalendar } from './fullcalendar-solid';
import {
  CALENDAR_TIME_FORMAT_OPTIONS,
  formatCalendarTime,
  formatCompactCalendarTime,
} from './time-format';
import { useCalendarTimeGridHoverIndicator } from './useCalendarTimeGridHoverIndicator';

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

const isSameLocalDate = (first: Date, second: Date) =>
  first.getFullYear() === second.getFullYear() &&
  first.getMonth() === second.getMonth() &&
  first.getDate() === second.getDate();

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

function getLocalScrollTime() {
  const now = new Date();
  const minutesSinceMidnight = now.getHours() * 60 + now.getMinutes();
  const scrollMinutes = Math.max(
    0,
    Math.floor((minutesSinceMidnight - 60) / 30) * 30
  );
  const hours = Math.floor(scrollMinutes / 60);
  const minutes = scrollMinutes % 60;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
}

interface CalendarScrollTarget {
  scrollElement: HTMLElement;
  fadeContainer: HTMLElement;
}

function CalendarScrollIndicators(props: {
  calendarElement: Accessor<HTMLElement | undefined>;
}) {
  const [target, setTarget] = createSignal<CalendarScrollTarget>();

  createEffect(
    on(props.calendarElement, (element) => {
      if (!element) {
        setTarget(undefined);
        return;
      }

      let updateFrame: number | undefined;
      const updateScrollElements = () => {
        const scrollElement = element.querySelector<HTMLElement>(
          '.fc-timegrid .fc-scroller-harness-liquid > .fc-scroller'
        );
        const fadeContainer = scrollElement?.parentElement;
        setTarget((current) => {
          if (!scrollElement || !fadeContainer) return undefined;
          return current?.scrollElement === scrollElement &&
            current.fadeContainer === fadeContainer
            ? current
            : { scrollElement, fadeContainer };
        });
      };
      const scheduleScrollElementUpdate = () => {
        if (updateFrame !== undefined) cancelAnimationFrame(updateFrame);
        updateFrame = requestAnimationFrame(() => {
          updateFrame = undefined;
          updateScrollElements();
        });
      };

      const mutationObserver = new MutationObserver(
        scheduleScrollElementUpdate
      );
      mutationObserver.observe(element, { childList: true, subtree: true });
      scheduleScrollElementUpdate();

      onCleanup(() => {
        mutationObserver.disconnect();
        if (updateFrame !== undefined) cancelAnimationFrame(updateFrame);
      });
    })
  );

  return (
    <Show keyed when={target()}>
      {(scrollTarget) => (
        <Portal
          mount={scrollTarget.fadeContainer}
          ref={(container) => {
            container.style.display = 'contents';
          }}
        >
          <ScrollIndicators
            scrollRef={() => scrollTarget.scrollElement}
            appearance="gradient"
            class="h-6"
          />
        </Portal>
      )}
    </Show>
  );
}

function CalendarPageDataStatus(props: { data: CalendarPageData }) {
  const isRangeUnavailable = createMemo(() => {
    const range = props.data.range();
    return range !== undefined && !isCalendarRangeSupported(range);
  });

  const showLoading = () =>
    !isRangeUnavailable() &&
    !props.data.occurrencesQuery.isError &&
    props.data.isLoading();

  const showBlockingState = () => {
    if (isRangeUnavailable()) return false;
    if (props.data.occurrencesQuery.isError) return true;
    if (showLoading()) return false;

    return props.data.isSyncing() && props.data.events().length === 0;
  };

  return (
    <>
      <Show when={showBlockingState()}>
        <div
          class="absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-surface/90 p-6 text-center"
          aria-live="polite"
        >
          <Show
            when={!props.data.occurrencesQuery.isError}
            fallback={
              <div class="flex max-w-sm flex-col items-center gap-3">
                <div class="text-sm font-semibold text-ink">
                  Calendar unavailable
                </div>
                <p class="text-xs text-ink-muted">
                  We couldn’t load your calendar events. Try again.
                </p>
                <Button
                  variant="active"
                  size="sm"
                  label="Retry loading calendar"
                  onClick={() => void props.data.occurrencesQuery.refetch()}
                >
                  Retry
                </Button>
              </div>
            }
          >
            <div class="flex items-center gap-2 text-xs text-ink-muted">
              <SpinnerIcon class="size-4 animate-spin" />
              <span>Syncing calendar…</span>
            </div>
          </Show>
        </div>
      </Show>

      <Show when={showLoading()}>
        <div class="absolute top-2 left-2 z-10 flex items-center gap-1.5 rounded-full border border-edge-muted bg-surface px-2.5 py-1 text-xs text-ink-muted shadow-menu">
          <SpinnerIcon class="size-3 animate-spin" />
          Loading
        </div>
      </Show>

      <Show
        when={
          !isRangeUnavailable() &&
          !showLoading() &&
          !showBlockingState() &&
          props.data.isSyncing() &&
          props.data.events().length > 0
        }
      >
        <div class="absolute right-2 bottom-2 z-10 flex items-center gap-1.5 rounded-full border border-edge-muted bg-surface px-2.5 py-1 text-xs text-ink-muted shadow-menu">
          <SpinnerIcon class="size-3 animate-spin" />
          Syncing
        </div>
      </Show>
    </>
  );
}

function createCalendarPageData(
  range: Accessor<CalendarOccurrenceQueryRange | undefined>,
  isActive: Accessor<boolean>
): CalendarPageData {
  const userId = useUserId();
  const calendarView = useCalendarView();
  const isRangeSupported = createMemo(() => {
    const currentRange = range();
    return currentRange !== undefined && isCalendarRangeSupported(currentRange);
  });
  const occurrencesQuery = useCalendarOccurrencesQuery(
    () => ({ userId: userId(), range: range() }),
    () => ({
      enabled: isRangeSupported(),
      pollWhileSyncing: isActive(),
      refetchOnWindowFocus: isActive(),
    })
  );
  const events = createMemo(() => {
    if (!isRangeSupported()) return [];
    const sourceById = calendarView.sourceById();
    return (occurrencesQuery.data?.items ?? []).map((item) =>
      mapCalendarOccurrence(
        item,
        item.event.calendarId != null
          ? sourceById.get(item.event.calendarId)
          : undefined
      )
    );
  });
  const visibleEvents = createMemo(() =>
    events().filter((event) => calendarView.isSourceVisible(event.calendar.id))
  );
  const eventsById = createMemo(
    () => new Map(events().map((event) => [event.id, event]))
  );
  const fullCalendarEvents = createMemo(() =>
    visibleEvents().map(mapCalendarEventToFullCalendar)
  );
  const isLoading = () =>
    range() === undefined ||
    (isRangeSupported() &&
      (occurrencesQuery.isPending || occurrencesQuery.isPlaceholderData));
  const isSyncing = () =>
    occurrencesQuery.data?.syncStatus === CalendarSyncStatus.syncing;

  return {
    range,
    occurrencesQuery,
    events,
    eventsById,
    fullCalendarEvents,
    isLoading,
    isSyncing,
  };
}

/** One independently rendered and queried FullCalendar page. */
export function CalendarPage(props: { id: CalendarPageId; initialDate: Date }) {
  const pager = useCalendarPager();
  const calendarView = useCalendarView();
  const openEventComposer = useOpenEventComposer();
  const calendarsQuery = useVisibleCalendarsQuery();
  const firstWritableCalendar = createMemo(() =>
    calendarsQuery.data?.find((calendar) => calendar.isWritable)
  );
  const [range, setRange] = createSignal<CalendarOccurrenceQueryRange>();
  const [selectionColor, setSelectionColor] = createSignal<string>();
  const effectiveSelectionColor = () =>
    selectionColor() ??
    firstWritableCalendar()?.color ??
    DEFAULT_CALENDAR_SOURCE.color;
  const isActive = () => pager.isActive(props.id);
  const useNarrowWeekdayHeaders = () =>
    calendarView.useNarrowDayHeaders() && !isMobile();
  const data = createCalendarPageData(range, isActive);
  const updateEventTime = useUpdateCalendarEventMutation();
  // FullCalendar owns temporary drag/resize state imperatively. Replacing its
  // event inputs mid-interaction clears that state and turns the pointer drag
  // into a date-selection mirror, so hold a stable query snapshot until stop.
  const [eventInteractionActive, setEventInteractionActive] =
    createSignal(false);
  const renderedFullCalendarEvents = createMemo<EventInput[]>(
    (current) =>
      eventInteractionActive() ? current : data.fullCalendarEvents(),
    data.fullCalendarEvents()
  );
  let interactionEventsById: ReturnType<typeof data.eventsById> | undefined;

  const eventByRenderId = (id: string) =>
    interactionEventsById?.get(id) ?? data.eventsById().get(id);
  const handleEventInteractionStart = () => {
    interactionEventsById = data.eventsById();
    setEventInteractionActive(true);
  };
  const handleEventInteractionStop = () => {
    // FullCalendar emits drop/resize immediately after stop, so defer clearing
    // the snapshot until those callbacks have consumed it.
    queueMicrotask(() => {
      interactionEventsById = undefined;
      setEventInteractionActive(false);
    });
  };

  // Rendered chip elements by view-model id, so a deep link can anchor the
  // details popover to the real chip. The signal bumps on every mount
  // because FullCalendar renders chips outside Solid's reactive graph.
  const eventElements = new Map<string, HTMLElement>();
  const [chipMounts, notifyChipMount] = createSignal(undefined, {
    equals: false,
  });

  const handleSelect = (selection: DateSelectArg) => {
    if (!isActive()) return;
    const calendar = firstWritableCalendar();
    setSelectionColor(calendar?.color ?? DEFAULT_CALENDAR_SOURCE.color);
    openEventComposer({
      initialValues: {
        ...calendarSelectionToEditorInitialValues(selection),
        ...(calendar ? { calendarId: calendar.id } : {}),
      },
      onCalendarChange: (_calendarId: string, color: string) =>
        setSelectionColor(color),
      onClose: () => {
        selection.view.calendar.unselect();
        setSelectionColor(undefined);
      },
    });
  };

  const handleDatesSet = ({ end, start }: DatesSetArg) => {
    const nextRange = createCalendarOccurrenceQueryRange(start, end);
    const currentRange = range();
    if (
      currentRange?.start === nextRange.start &&
      currentRange.end === nextRange.end &&
      currentRange.startDate === nextRange.startDate &&
      currentRange.endDate === nextRange.endDate
    ) {
      return;
    }
    setRange(nextRange);
  };

  const handleEventTimeChange = (change: CalendarEventTimeChange) => {
    const event = eventByRenderId(calendarEventRenderId(change.event));
    if (
      !isActive() ||
      updateEventTime.isPending ||
      !event ||
      !canEditCalendarEventTime(event)
    ) {
      change.revert();
      return;
    }

    const time = calendarEventTimeFromFullCalendar(change.event, event);
    if (!time) {
      change.revert();
      return;
    }

    updateEventTime.mutate(
      { eventId: event.eventId, patch: { time } },
      {
        onError: (error) => {
          change.revert();
          toast.failure('Failed to update event', {
            subtext: error.message,
          });
        },
      }
    );
  };

  return (
    <FullCalendar.Root
      plugins={[
        dayGridPlugin,
        interactionPlugin,
        timeGridPlugin,
        multiDaySelectionRenderingPlugin,
      ]}
      initialView={calendarView.displaySettings.periodView}
      initialDate={props.initialDate}
      height="100%"
      expandRows
      fixedWeekCount={false}
      handleWindowResize={false}
      allDayText="All day"
      nowIndicator
      headerToolbar={false}
      scrollTime={getLocalScrollTime()}
      scrollTimeReset={false}
      weekends={calendarView.displaySettings.showWeekends}
      firstDay={calendarView.displaySettings.weekStartsOn}
      slotLabelFormat={
        CALENDAR_TIME_FORMAT_OPTIONS[calendarView.displaySettings.timeFormat]
      }
      eventTimeFormat={
        CALENDAR_TIME_FORMAT_OPTIONS[calendarView.displaySettings.timeFormat]
      }
      events={renderedFullCalendarEvents()}
      eventAllow={() => !updateEventTime.isPending}
      eventResizableFromStart
      eventDragStart={handleEventInteractionStart}
      eventDragStop={handleEventInteractionStop}
      eventDrop={handleEventTimeChange}
      eventResizeStart={handleEventInteractionStart}
      eventResizeStop={handleEventInteractionStop}
      eventResize={handleEventTimeChange}
      selectable={!isMobile()}
      unselectAuto={false}
      selectMirror
      selectMinDistance={5}
      select={handleSelect}
      eventClick={({ el, event, jsEvent }) => {
        jsEvent.preventDefault();
        if (!isActive()) return;
        const selectedEvent = eventByRenderId(calendarEventRenderId(event));
        if (selectedEvent) calendarView.selectEvent(selectedEvent, el);
      }}
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

        eventElements.set(eventId, el);
        // A re-render (query settling, live refresh) replaces chip elements.
        // Re-anchor an open details popover to the remounted chip — its old
        // anchor is a disconnected node the popover can't position against.
        if (isActive() && calendarView.eventState.selectedEventId === eventId) {
          const selected = eventByRenderId(eventId);
          if (selected) calendarView.selectEvent(selected, el);
        }
        notifyChipMount();
      }}
      eventWillUnmount={({ el, event, isMirror }) => {
        if (isMirror || isMultiDaySelectionPreview(event)) return;

        const eventId = calendarEventRenderId(event);
        if (eventElements.get(eventId) === el) {
          eventElements.delete(eventId);
        }
      }}
      datesSet={handleDatesSet}
      dayHeaderFormat={{
        weekday: useNarrowWeekdayHeaders() ? 'narrow' : 'short',
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
            const weekday =
              view.type === 'timeGridDay'
                ? formatWeekdayHeader.short(date)
                : formatWeekdayHeader[
                    useNarrowWeekdayHeaders() ? 'narrow' : 'short'
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
          formatCompactCalendarTime(
            date,
            calendarView.displaySettings.timeFormat
          )
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

          return (
            <CalendarEventContent
              event={event}
              renderProps={renderProps}
              isSelected={
                isActive() &&
                calendarView.eventState.selectedEventId === event.id
              }
              timeFormat={calendarView.displaySettings.timeFormat}
              isNarrow={calendarView.useNarrowDayHeaders()}
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
              timeFormat={calendarView.displaySettings.timeFormat}
            />
          );
        }}
      </FullCalendar.NowIndicatorContent>

      <CalendarPageHost
        id={props.id}
        data={data}
        eventElements={eventElements}
        chipMounts={chipMounts}
        selectionColor={effectiveSelectionColor()}
      />
    </FullCalendar.Root>
  );
}

function CalendarPageHost(props: {
  id: CalendarPageId;
  data: CalendarPageData;
  eventElements: Map<string, HTMLElement>;
  chipMounts: Accessor<undefined>;
  selectionColor: string;
}) {
  const calendar = useFullCalendar();
  const pager = useCalendarPager();
  const calendarView = useCalendarView();
  const calendarFocus = useCalendarFocus();
  const [element, setElement] = createSignal<HTMLDivElement>();
  const isActive = () => pager.isActive(props.id);

  // A block navigation request pages this calendar instance to one occurrence
  // and opens its details once FullCalendar has mounted the target chip.
  let navigatedFor: number | undefined;
  createEffect(() => {
    props.chipMounts();
    const target = calendarFocus.pendingTarget();
    if (!target || !isActive()) return;
    const dateInfo = calendar.dateInfo();
    if (!dateInfo) return;
    if (target.date < dateInfo.start || target.date >= dateInfo.end) {
      // Navigate once per request; the effect re-runs as the destination
      // page's chips mount, and by then the date is inside the view.
      if (navigatedFor !== target.requestId) {
        navigatedFor = target.requestId;
        pager.navigateToDate(target.date);
      }
      return;
    }
    const targetId = calendarFocusTargetId(target);
    const event = props.data.eventsById().get(targetId);
    const chip = props.eventElements.get(targetId);
    if (!event || !chip?.isConnected) return;
    calendarFocus.consume(target.requestId);
    calendarView.selectEvent(event, chip);
  });

  useCalendarTimeGridHoverIndicator(() => (isActive() ? element() : undefined));

  onMount(() => {
    const unregister = pager.registerPage({
      id: props.id,
      api: calendar.api,
      dateInfo: calendar.dateInfo,
      element,
      data: props.data,
    });
    onCleanup(unregister);
  });

  createEffect(
    on(isActive, (active, wasActive) => {
      if (
        active &&
        wasActive === false &&
        props.data.occurrencesQuery.isSuccess &&
        props.data.occurrencesQuery.isStale &&
        !props.data.occurrencesQuery.isFetching &&
        !props.data.occurrencesQuery.isPlaceholderData
      ) {
        void props.data.occurrencesQuery.refetch();
      }
    })
  );

  createEffect(
    on(
      () =>
        [
          isActive(),
          calendarView.eventState.selectedEventId,
          props.data.occurrencesQuery.dataUpdatedAt,
        ] as const,
      ([active, selectedEventId]) => {
        if (
          !active ||
          !selectedEventId ||
          !props.data.occurrencesQuery.isSuccess ||
          props.data.occurrencesQuery.isPlaceholderData
        ) {
          return;
        }

        const selectedEvent = props.data.eventsById().get(selectedEventId);
        if (selectedEvent) calendarView.refreshSelectedEvent(selectedEvent);
        else calendarView.closeEventDetails();
      }
    )
  );

  return (
    <>
      <FullCalendar.Host
        tabIndex={-1}
        ref={setElement}
        style={{ '--calendar-selection-color': props.selectionColor }}
        class="calendar-view-host size-full min-w-0 min-h-0 overflow-hidden"
      />
      <CalendarScrollIndicators calendarElement={element} />
      <CalendarPageDataStatus data={props.data} />
    </>
  );
}
