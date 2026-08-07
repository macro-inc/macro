import { ScrollIndicators } from '@core/component/VerticalScrollIndicators';
import { useUserId } from '@core/context/user';
import { isMobile } from '@core/mobile/isMobile';
import type { DatesSetArg } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import timeGridPlugin from '@fullcalendar/timegrid';
import SpinnerIcon from '@phosphor/spinner-gap.svg';
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
import { isCalendarRangeSupported } from './calendar-supported-range';
import { mapCalendarOccurrence } from './events/calendar-occurrence-mapper';
import { CalendarEventContent } from './events/EventContent';
import { mapCalendarEventToFullCalendar } from './events/event-mapper';
import type { CalendarTimeFormat } from './events/types';
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
  const events = createMemo(() =>
    isRangeSupported()
      ? (occurrencesQuery.data?.items ?? []).map(mapCalendarOccurrence)
      : []
  );
  const visibleEvents = createMemo(() =>
    events().filter((event) =>
      calendarView.eventState.visibleSourceIds.includes(event.calendar.id)
    )
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
  const [range, setRange] = createSignal<CalendarOccurrenceQueryRange>();
  const isActive = () => pager.isActive(props.id);
  const useNarrowWeekdayHeaders = () =>
    calendarView.useNarrowDayHeaders() && !isMobile();
  const data = createCalendarPageData(range, isActive);

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

  return (
    <FullCalendar.Root
      plugins={[dayGridPlugin, interactionPlugin, timeGridPlugin]}
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
      events={data.fullCalendarEvents()}
      eventClick={({ el, event, jsEvent }) => {
        jsEvent.preventDefault();
        if (!isActive()) return;
        const selectedEvent = data.eventsById().get(event.id);
        if (selectedEvent) calendarView.selectEvent(selectedEvent, el);
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
        {({ date, text }) =>
          calendarView.useNarrowDayHeaders()
            ? formatCompactCalendarTime(
                date,
                calendarView.displaySettings.timeFormat
              )
            : text
        }
      </FullCalendar.SlotLabelContent>

      <FullCalendar.EventContent>
        {(renderProps) => {
          const event = data.eventsById().get(renderProps.event.id);
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
        {({ isAxis, view }) => {
          if (isAxis) {
            return view.type === 'timeGridWeek' ? (
              <span
                aria-hidden="true"
                class="calendar-now-axis-indicator calendar-now-axis-indicator-gutter"
              />
            ) : null;
          }

          return (
            <CurrentTimeAxisIndicator
              date={new Date()}
              timeFormat={calendarView.displaySettings.timeFormat}
            />
          );
        }}
      </FullCalendar.NowIndicatorContent>

      <CalendarPageHost id={props.id} data={data} />
    </FullCalendar.Root>
  );
}

function CalendarPageHost(props: {
  id: CalendarPageId;
  data: CalendarPageData;
}) {
  const calendar = useFullCalendar();
  const pager = useCalendarPager();
  const calendarView = useCalendarView();
  const [element, setElement] = createSignal<HTMLDivElement>();
  const isActive = () => pager.isActive(props.id);

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
        class="calendar-view-host size-full min-w-0 min-h-0 overflow-hidden"
      />
      <CalendarScrollIndicators calendarElement={element} />
      <CalendarPageDataStatus data={props.data} />
    </>
  );
}
