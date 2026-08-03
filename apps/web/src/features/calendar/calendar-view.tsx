import { SidePanel, useSidePanel } from '@components/app/side-panel/SidePanel';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type {
  DateSelectArg,
  DateSpanApi,
  DatesSetArg,
  EventDropArg,
} from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin, {
  type EventResizeDoneArg,
} from '@fullcalendar/interaction';
import timeGridPlugin from '@fullcalendar/timegrid';
import CalendarIcon from '@phosphor/calendar-blank.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CaretLeftIcon from '@phosphor/caret-left.svg';
import CaretRightIcon from '@phosphor/caret-right.svg';
import CheckIcon from '@phosphor/check.svg';
import { Button, Dropdown, Layer, Calendar as MiniCalendar } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { CalendarSettingsDropdown } from './CalendarSettingsDropdown';
import { CalendarSidePanelSections } from './CalendarSidePanelSections';
import { CalendarEventContent } from './events/EventContent';
import { EventDetailsPopover } from './events/EventDetailsPopover';
import { EventEditorPopover } from './events/EventEditorPopover';
import { mapCalendarEventToFullCalendar } from './events/event-mapper';
import { createCalendarEventFixtures } from './events/fixtures';
import type {
  CalendarEvent,
  CalendarSource,
  CalendarTimeFormat,
  CalendarWeekStart,
} from './events/types';
import { FullCalendar, useFullCalendar } from './fullcalendar-solid';
import {
  CALENDAR_TIME_FORMAT_OPTIONS,
  formatCalendarTime,
  getDefaultCalendarTimeFormat,
} from './time-format';
import './calendar.css';

const CALENDAR_VIEW_TABS = [
  { value: 'dayGridMonth', label: 'Month' },
  { value: 'timeGridWeek', label: 'Week' },
  { value: 'timeGridDay', label: 'Day' },
];

const formatMonthTitle = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  year: 'numeric',
}).format;

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

const parseCalendarEventDate = (value: string, allDay: boolean) => {
  if (!allDay) return new Date(value);
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
};

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

interface ResponsiveCalendarHostProps {
  onNarrowDayHeadersChange: (useNarrowDayHeaders: boolean) => void;
}

interface CalendarWorkspaceProps extends ResponsiveCalendarHostProps {
  selectedEvent: CalendarEvent | undefined;
  selectedEventAnchor: HTMLElement | undefined;
  draftEventId: string | undefined;
  sources: CalendarSource[];
  showWeekends: boolean;
  timeFormat: CalendarTimeFormat;
  weekStartsOn: CalendarWeekStart;
  isSourceVisible: (sourceId: string) => boolean;
  onCloseEvent: () => void;
  onSaveDraftEvent: (event: CalendarEvent) => void;
  onShowWeekendsChange: (showWeekends: boolean) => void;
  onSourceVisibilityChange: (sourceId: string, visible: boolean) => void;
  onTimeFormatChange: (timeFormat: CalendarTimeFormat) => void;
  onWeekStartsOnChange: (weekStartsOn: CalendarWeekStart) => void;
}

function ResponsiveCalendarHost(props: ResponsiveCalendarHostProps) {
  const calendar = useFullCalendar();
  const [element, setElement] = createSignal<HTMLDivElement>();

  createEffect(
    on(
      () => [element(), calendar.api()] as const,
      ([calendarElement, calendarApi]) => {
        if (!calendarElement || !calendarApi) return;

        let observedWidth = calendarElement.clientWidth;
        let resizeFrame: number | undefined;
        const resizeObserver = new ResizeObserver(([entry]) => {
          observedWidth =
            entry?.contentRect.width ?? calendarElement.clientWidth;
          if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
          resizeFrame = requestAnimationFrame(() => {
            resizeFrame = undefined;
            props.onNarrowDayHeadersChange(observedWidth < 520);
            calendarApi.updateSize();
          });
        });
        resizeObserver.observe(calendarElement);

        const resetPointerTimeIndicator = () => {
          for (const frame of calendarElement.querySelectorAll<HTMLElement>(
            '.fc-timegrid-col-frame'
          )) {
            frame.style.removeProperty('--calendar-pointer-time-top');
            frame.removeAttribute('data-pointer-time');
          }
        };

        const handlePointerMove = (event: PointerEvent) => {
          const frames = calendarElement.querySelectorAll<HTMLElement>(
            '.fc-timegrid-col-frame'
          );
          let targetFrame: HTMLElement | undefined;

          if (event.pointerType === 'mouse') {
            for (const frame of frames) {
              const frameBounds = frame.getBoundingClientRect();
              const scrollerBounds = frame
                .closest<HTMLElement>('.fc-scroller')
                ?.getBoundingClientRect();
              if (
                scrollerBounds &&
                event.clientX >= frameBounds.left &&
                event.clientX <= frameBounds.right &&
                event.clientY >= scrollerBounds.top &&
                event.clientY <= scrollerBounds.bottom
              ) {
                targetFrame = frame;
                break;
              }
            }
          }

          for (const frame of frames) {
            frame.style.removeProperty('--calendar-pointer-time-top');
            frame.removeAttribute('data-pointer-time');
          }

          if (targetFrame) {
            const frameBounds = targetFrame.getBoundingClientRect();
            targetFrame.style.setProperty(
              '--calendar-pointer-time-top',
              `${event.clientY - frameBounds.top}px`
            );
            targetFrame.setAttribute('data-pointer-time', '');
          }
        };

        const handleCalendarScroll = (event: Event) => {
          const scroller = event.target;
          if (!(scroller instanceof HTMLElement)) return;

          const harness = scroller.closest(
            '.fc-scroller-harness-liquid'
          ) as HTMLElement | null;
          if (!harness || scroller.parentElement !== harness) return;

          harness.toggleAttribute(
            'data-scrolled-from-top',
            scroller.scrollTop > 1
          );
          resetPointerTimeIndicator();
        };
        calendarElement.addEventListener('scroll', handleCalendarScroll, true);
        calendarElement.addEventListener('pointermove', handlePointerMove);
        calendarElement.addEventListener(
          'pointerleave',
          resetPointerTimeIndicator
        );

        onCleanup(() => {
          resizeObserver.disconnect();
          calendarElement.removeEventListener(
            'scroll',
            handleCalendarScroll,
            true
          );
          calendarElement.removeEventListener('pointermove', handlePointerMove);
          calendarElement.removeEventListener(
            'pointerleave',
            resetPointerTimeIndicator
          );
          if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
        });
      }
    )
  );

  return (
    <Layer depth={2}>
      <FullCalendar.Host
        tabIndex={-1}
        ref={(calendarElement) => {
          setElement(calendarElement);
          props.onNarrowDayHeadersChange(calendarElement.clientWidth < 520);
        }}
        class="calendar-view-host min-w-0 min-h-0 flex-1 overflow-hidden rounded-xl bg-surface"
      />
    </Layer>
  );
}

/** A calendar-focused workspace view backed by FullCalendar. */
export function CalendarView() {
  const [useNarrowDayHeaders, setUseNarrowDayHeaders] = createSignal(false);
  const [selectedEventId, setSelectedEventId] = createSignal<string>();
  const [selectedEventAnchor, setSelectedEventAnchor] =
    createSignal<HTMLElement>();
  const [draftEventId, setDraftEventId] = createSignal<string>();
  const [showWeekends, setShowWeekends] = createSignal(true);
  const [weekStartsOn, setWeekStartsOn] = createSignal<CalendarWeekStart>(0);
  const [timeFormat, setTimeFormat] = createSignal<CalendarTimeFormat>(
    getDefaultCalendarTimeFormat()
  );
  const initialCalendarEvents = createCalendarEventFixtures();
  const [calendarEvents, setCalendarEvents] = createSignal(
    initialCalendarEvents
  );
  const eventsById = createMemo(
    () => new Map(calendarEvents().map((event) => [event.id, event]))
  );
  const calendarSources = Array.from(
    new Map(
      initialCalendarEvents.map((event) => [event.calendar.id, event.calendar])
    ).values()
  );
  const [visibleSourceIds, setVisibleSourceIds] = createSignal(
    new Set(calendarSources.map((source) => source.id))
  );
  const visibleEvents = createMemo(() =>
    calendarEvents().filter((event) =>
      visibleSourceIds().has(event.calendar.id)
    )
  );
  const fullCalendarEvents = createMemo(() =>
    visibleEvents().map((event) => ({
      ...mapCalendarEventToFullCalendar(event),
      editable: event.id !== draftEventId(),
    }))
  );
  const canDrawEvent = (selection: DateSpanApi) =>
    !visibleEvents().some((event) => {
      if (event.id === draftEventId() || event.allDay !== selection.allDay) {
        return false;
      }
      const eventStart = parseCalendarEventDate(event.start, event.allDay);
      const eventEnd = parseCalendarEventDate(event.end, event.allDay);
      return eventStart < selection.end && eventEnd > selection.start;
    });
  const selectedEvent = () => {
    const eventId = selectedEventId();
    return eventId ? eventsById().get(eventId) : undefined;
  };
  const clearEventSelection = () => {
    setSelectedEventId(undefined);
    setSelectedEventAnchor(undefined);
  };
  const discardDraftEvent = () => {
    const eventId = draftEventId();
    if (!eventId) return;
    setCalendarEvents((current) =>
      current.filter((event) => event.id !== eventId)
    );
    setDraftEventId(undefined);
  };
  const closeEventDetails = () => {
    if (selectedEventId() === draftEventId()) discardDraftEvent();
    clearEventSelection();
  };
  const saveDraftEvent = (event: CalendarEvent) => {
    if (event.id !== draftEventId()) return;
    setCalendarEvents((current) =>
      current.map((currentEvent) =>
        currentEvent.id === event.id ? event : currentEvent
      )
    );
    setVisibleSourceIds((current) => new Set(current).add(event.calendar.id));
    setDraftEventId(undefined);
    clearEventSelection();
  };
  const setSourceVisibility = (sourceId: string, visible: boolean) => {
    setVisibleSourceIds((current) => {
      const next = new Set(current);
      if (visible) next.add(sourceId);
      else next.delete(sourceId);
      return next;
    });
    if (!visible && selectedEvent()?.calendar.id === sourceId) {
      closeEventDetails();
    }
  };
  const createDraftEvent = (selection: DateSelectArg) => {
    discardDraftEvent();
    const defaultSource =
      calendarSources.find((source) => source.id === 'personal') ??
      calendarSources[0];
    if (!defaultSource) return;

    const eventId = `calendar-draft-${crypto.randomUUID()}`;
    const draftEvent: CalendarEvent = {
      id: eventId,
      title: 'New event',
      start: selection.startStr,
      end: selection.endStr,
      allDay: selection.allDay,
      calendar: defaultSource,
    };

    selection.view.calendar.unselect();
    setDraftEventId(eventId);
    setSelectedEventId(eventId);
    setSelectedEventAnchor(undefined);
    setVisibleSourceIds((current) => new Set(current).add(defaultSource.id));
    setCalendarEvents((current) => [...current, draftEvent]);
  };
  const updateEventDates = ({
    event,
    revert,
  }: EventDropArg | EventResizeDoneArg) => {
    if (!eventsById().has(event.id) || !event.startStr || !event.endStr) {
      revert();
      return;
    }

    closeEventDetails();
    setCalendarEvents((current) =>
      current.map((calendarEvent) =>
        calendarEvent.id === event.id
          ? {
              ...calendarEvent,
              start: event.startStr,
              end: event.endStr,
              allDay: event.allDay,
            }
          : calendarEvent
      )
    );
  };
  let visibleRangeKey: string | undefined;
  const handleDatesSet = ({ end, start, view }: DatesSetArg) => {
    const nextRangeKey = `${view.type}:${start.toISOString()}:${end.toISOString()}`;
    if (visibleRangeKey !== undefined && visibleRangeKey !== nextRangeKey) {
      closeEventDetails();
    }
    visibleRangeKey = nextRangeKey;
  };

  return (
    <FullCalendar.Root
      plugins={[dayGridPlugin, interactionPlugin, timeGridPlugin]}
      initialView="dayGridMonth"
      height="100%"
      expandRows
      fixedWeekCount={false}
      handleWindowResize={false}
      allDayText="All day"
      nowIndicator
      headerToolbar={false}
      scrollTime={getLocalScrollTime()}
      scrollTimeReset={false}
      weekends={showWeekends()}
      firstDay={weekStartsOn()}
      slotLabelFormat={CALENDAR_TIME_FORMAT_OPTIONS[timeFormat()]}
      eventTimeFormat={CALENDAR_TIME_FORMAT_OPTIONS[timeFormat()]}
      eventStartEditable
      eventDurationEditable
      eventResizableFromStart
      selectable={!isTouchDevice()}
      selectMirror
      selectAllow={canDrawEvent}
      selectMinDistance={5}
      snapDuration="00:15:00"
      select={createDraftEvent}
      events={fullCalendarEvents()}
      eventDidMount={({ el, event }) => {
        const currentAnchor = selectedEventAnchor();
        if (
          event.id === draftEventId() &&
          (!currentAnchor || !currentAnchor.isConnected)
        ) {
          setSelectedEventAnchor(el);
        }
      }}
      eventDragStart={closeEventDetails}
      eventDrop={updateEventDates}
      eventResizeStart={closeEventDetails}
      eventResize={updateEventDates}
      eventClick={({ el, event, jsEvent }) => {
        jsEvent.preventDefault();
        if (draftEventId() && event.id !== draftEventId()) {
          discardDraftEvent();
        }
        setSelectedEventId(event.id);
        setSelectedEventAnchor(el);
      }}
      datesSet={handleDatesSet}
      dayHeaderFormat={{
        weekday: useNarrowDayHeaders() ? 'narrow' : 'short',
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
                    useNarrowDayHeaders() ? 'narrow' : 'short'
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

      <FullCalendar.EventContent>
        {(renderProps) => {
          const event = eventsById().get(renderProps.event.id);
          if (!event) return null;

          return (
            <CalendarEventContent event={event} renderProps={renderProps} />
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
              timeFormat={timeFormat()}
            />
          );
        }}
      </FullCalendar.NowIndicatorContent>

      <SidePanel.Layout>
        <CalendarWorkspace
          onNarrowDayHeadersChange={setUseNarrowDayHeaders}
          selectedEvent={selectedEvent()}
          selectedEventAnchor={selectedEventAnchor()}
          draftEventId={draftEventId()}
          sources={calendarSources}
          showWeekends={showWeekends()}
          timeFormat={timeFormat()}
          weekStartsOn={weekStartsOn()}
          isSourceVisible={(sourceId) => visibleSourceIds().has(sourceId)}
          onCloseEvent={closeEventDetails}
          onSaveDraftEvent={saveDraftEvent}
          onShowWeekendsChange={setShowWeekends}
          onSourceVisibilityChange={setSourceVisibility}
          onTimeFormatChange={setTimeFormat}
          onWeekStartsOnChange={setWeekStartsOn}
        />
      </SidePanel.Layout>
    </FullCalendar.Root>
  );
}

function CalendarWorkspace(props: CalendarWorkspaceProps) {
  const panel = useSplitPanelOrThrow();
  const sidePanel = useSidePanel();
  const calendar = useFullCalendar();
  const [isTodayVisible, setIsTodayVisible] = createSignal(true);
  const initialDate = new Date();
  const [miniCalendarFocusedDay, setMiniCalendarFocusedDay] =
    createSignal(initialDate);
  const [customDateMonth, setCustomDateMonth] = createSignal(initialDate);
  const [customDateFocusedDay, setCustomDateFocusedDay] =
    createSignal(initialDate);
  const [viewDropdownOpen, setViewDropdownOpen] = createSignal(false);
  let todayRefreshTimer: number | undefined;
  const isNarrow = () => sidePanel?.isNarrow() ?? false;
  const currentDate = () =>
    calendar.dateInfo()?.view.calendar.getDate() ?? initialDate;
  const activeView = () => calendar.dateInfo()?.view.type ?? 'dayGridMonth';
  const dateTitle = () => formatMonthTitle(currentDate());
  const visibleRange = () => {
    const dateInfo = calendar.dateInfo();
    return dateInfo ? { end: dateInfo.end, start: dateInfo.start } : undefined;
  };
  const miniCalendarHighlightedRange = () =>
    activeView() === 'timeGridWeek' ? visibleRange() : undefined;

  const refreshTodayVisibility = () => {
    const range = visibleRange();
    if (!range) return;

    const now = new Date();
    setIsTodayVisible(now >= range.start && now < range.end);

    const nextMidnight = new Date(now);
    nextMidnight.setDate(nextMidnight.getDate() + 1);
    nextMidnight.setHours(0, 0, 0, 0);
    if (todayRefreshTimer !== undefined) clearTimeout(todayRefreshTimer);
    todayRefreshTimer = window.setTimeout(
      refreshTodayVisibility,
      nextMidnight.getTime() - now.getTime() + 100
    );
  };

  const changeView = (view: string) => {
    setViewDropdownOpen(false);
    const calendarApi = calendar.api();
    if (calendarApi?.view.type === view) return;
    calendarApi?.changeView(view);
  };

  const renderPeriodNavigation = () => (
    <div class="flex shrink-0 items-center gap-1">
      <Button
        variant="ghost"
        size="icon-md"
        class="rounded-lg [&_svg]:size-4!"
        label="Previous period"
        onClick={() => calendar.api()?.prev()}
      >
        <CaretLeftIcon class="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon-md"
        class="rounded-lg [&_svg]:size-4!"
        label="Next period"
        onClick={() => calendar.api()?.next()}
      >
        <CaretRightIcon class="size-4" />
      </Button>
    </div>
  );

  const selectMiniCalendarDate = (date: Date | null) => {
    if (!date) return;
    setMiniCalendarFocusedDay(date);
    calendar.api()?.gotoDate(date);
  };

  const navigateMiniCalendarMonth = (month: Date) => {
    const focusedDay = miniCalendarFocusedDay();
    const targetDate =
      focusedDay.getFullYear() === month.getFullYear() &&
      focusedDay.getMonth() === month.getMonth()
        ? focusedDay
        : month;
    setMiniCalendarFocusedDay(targetDate);
    calendar.api()?.gotoDate(targetDate);
  };

  const syncCustomDatePicker = () => {
    const date = currentDate();
    setCustomDateMonth(date);
    setCustomDateFocusedDay(date);
  };

  const navigateCustomDateMonth = (month: Date) => {
    const focusedDay = customDateFocusedDay();
    const targetDate =
      focusedDay.getFullYear() === month.getFullYear() &&
      focusedDay.getMonth() === month.getMonth()
        ? focusedDay
        : month;
    setCustomDateMonth(month);
    setCustomDateFocusedDay(targetDate);
  };

  const selectCustomDate = (date: Date | null) => {
    if (!date) return;
    setCustomDateMonth(date);
    setCustomDateFocusedDay(date);
    setMiniCalendarFocusedDay(date);
    calendar.api()?.gotoDate(date);
    setViewDropdownOpen(false);
  };

  const changeNarrowSourceVisibility = (sourceId: string, visible: boolean) => {
    props.onCloseEvent();
    props.onSourceVisibilityChange(sourceId, visible);
  };

  const changeShowWeekends = (showWeekends: boolean) => {
    props.onCloseEvent();
    props.onShowWeekendsChange(showWeekends);
  };

  const changeWeekStartsOn = (weekStartsOn: CalendarWeekStart) => {
    props.onCloseEvent();
    props.onWeekStartsOnChange(weekStartsOn);
  };

  const changeTimeFormat = (timeFormat: CalendarTimeFormat) => {
    props.onCloseEvent();
    props.onTimeFormatChange(timeFormat);
  };

  createEffect(on(calendar.dateInfo, refreshTodayVisibility));
  createEffect(on(currentDate, setMiniCalendarFocusedDay));
  onMount(() => panel.handle.setDisplayName('Calendar'));
  onCleanup(() => {
    if (todayRefreshTimer !== undefined) clearTimeout(todayRefreshTimer);
  });

  return (
    <>
      <CalendarSidePanelSections
        currentDate={currentDate()}
        focusedDay={miniCalendarFocusedDay()}
        highlightedRange={miniCalendarHighlightedRange()}
        selectedEvent={props.selectedEvent}
        draftEventId={props.draftEventId}
        sources={props.sources}
        timeFormat={props.timeFormat}
        weekStartsOn={props.weekStartsOn}
        isSourceVisible={props.isSourceVisible}
        onCloseEvent={props.onCloseEvent}
        onSaveDraftEvent={props.onSaveDraftEvent}
        onFocusedDayChange={setMiniCalendarFocusedDay}
        onMonthChange={navigateMiniCalendarMonth}
        onSelectDate={selectMiniCalendarDate}
        onSourceVisibilityChange={props.onSourceVisibilityChange}
      />
      <Show when={isNarrow() ? props.selectedEvent : undefined}>
        {(event) => (
          <Show
            when={props.draftEventId === event().id}
            fallback={
              <EventDetailsPopover
                anchor={props.selectedEventAnchor}
                event={event()}
                open={props.selectedEventAnchor !== undefined}
                timeFormat={props.timeFormat}
                onOpenChange={(open) => {
                  if (!open) props.onCloseEvent();
                }}
              />
            }
          >
            <EventEditorPopover
              anchor={props.selectedEventAnchor}
              event={event()}
              open={props.selectedEventAnchor !== undefined}
              sources={props.sources}
              onCancel={props.onCloseEvent}
              onSave={props.onSaveDraftEvent}
            />
          </Show>
        )}
      </Show>
      <main class="calendar-view flex size-full min-h-0 bg-surface">
        <div class="calendar-view-content flex min-w-0 min-h-0 flex-1 flex-col gap-3">
          <div class="flex min-w-0 items-center gap-3">
            <div class="flex shrink-0 items-center gap-1">
              <Button
                variant={isTodayVisible() ? 'base' : 'active'}
                size="md"
                class={
                  isTodayVisible()
                    ? 'rounded-lg bg-surface px-3'
                    : 'rounded-lg px-3'
                }
                depth={2}
                label="Go to today"
                onClick={() => calendar.api()?.today()}
              >
                Today
              </Button>
              {renderPeriodNavigation()}
            </div>
            <div class="min-w-0 flex-1 truncate text-xl font-bold leading-tight tracking-tight text-ink">
              {dateTitle()}
            </div>
            <div class="ml-auto flex shrink-0 items-center gap-1">
              <Dropdown
                open={viewDropdownOpen()}
                onOpenChange={setViewDropdownOpen}
                placement="bottom-end"
              >
                <Dropdown.Trigger
                  depth={2}
                  aria-label="Choose calendar view"
                  class="h-7 shrink-0 gap-1 rounded-lg border-edge-muted bg-panel px-2 text-xs font-medium text-ink"
                >
                  {CALENDAR_VIEW_TABS.find(
                    (view) => view.value === activeView()
                  )?.label ?? 'Month'}
                  <CaretDownIcon class="size-3 text-ink-muted" />
                </Dropdown.Trigger>
                <Dropdown.Content class="min-w-36">
                  <Dropdown.Group>
                    <Dropdown.RadioGroup
                      value={activeView()}
                      onChange={changeView}
                    >
                      <For each={CALENDAR_VIEW_TABS}>
                        {(view) => (
                          <Dropdown.RadioItem closeOnSelect value={view.value}>
                            <span class="flex-1">{view.label}</span>
                            <Dropdown.ItemIndicator>
                              <CheckIcon class="size-3.5 text-accent" />
                            </Dropdown.ItemIndicator>
                          </Dropdown.RadioItem>
                        )}
                      </For>
                    </Dropdown.RadioGroup>
                  </Dropdown.Group>
                  <Show when={isNarrow()}>
                    <Dropdown.Group>
                      <Dropdown.Sub
                        onOpenChange={(open) => {
                          if (open) syncCustomDatePicker();
                        }}
                      >
                        <Dropdown.SubTrigger>
                          <CalendarIcon class="size-3.5 text-ink-muted" />
                          <span class="flex-1">Custom date…</span>
                          <CaretRightIcon class="size-3 text-ink-muted" />
                        </Dropdown.SubTrigger>
                        <Dropdown.SubContent class="w-72 max-w-[calc(100vw-1rem)]">
                          <Dropdown.Group class="p-3">
                            <MiniCalendar
                              required
                              fixedWeeks
                              startOfWeek={props.weekStartsOn}
                              value={currentDate()}
                              month={customDateMonth()}
                              focusedDay={customDateFocusedDay()}
                              highlightedRange={miniCalendarHighlightedRange()}
                              onMonthChange={navigateCustomDateMonth}
                              onFocusedDayChange={setCustomDateFocusedDay}
                              onValueChange={selectCustomDate}
                            />
                          </Dropdown.Group>
                        </Dropdown.SubContent>
                      </Dropdown.Sub>
                    </Dropdown.Group>
                  </Show>
                </Dropdown.Content>
              </Dropdown>

              <CalendarSettingsDropdown
                sources={props.sources}
                showCalendarVisibility={isNarrow()}
                showWeekends={props.showWeekends}
                timeFormat={props.timeFormat}
                weekStartsOn={props.weekStartsOn}
                isSourceVisible={props.isSourceVisible}
                onShowWeekendsChange={changeShowWeekends}
                onSourceVisibilityChange={changeNarrowSourceVisibility}
                onTimeFormatChange={changeTimeFormat}
                onWeekStartsOnChange={changeWeekStartsOn}
              />
            </div>
          </div>
          <ResponsiveCalendarHost
            onNarrowDayHeadersChange={props.onNarrowDayHeadersChange}
          />
        </div>
      </main>
    </>
  );
}
