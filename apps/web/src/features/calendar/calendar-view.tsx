import { SidePanel } from '@components/app/side-panel/SidePanel';
import { HeaderIsland } from '@components/app/split-layout/components/HeaderIsland';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { ScrollIndicators } from '@core/component/VerticalScrollIndicators';
import type { DatesSetArg } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import timeGridPlugin from '@fullcalendar/timegrid';
import CaretLeftIcon from '@phosphor/caret-left.svg';
import CaretRightIcon from '@phosphor/caret-right.svg';
import { Button, Layer } from '@ui';
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
import { CalendarDataStatus } from './CalendarDataStatus';
import { CalendarPeriodSelector } from './CalendarPeriodSelector';
import { CalendarRangeUnavailableBanner } from './CalendarRangeUnavailableBanner';
import { CalendarSettingsDropdown } from './CalendarSettingsDropdown';
import { CalendarSidePanelSections } from './CalendarSidePanelSections';
import {
  CalendarViewContextProvider,
  useCalendarView,
} from './CalendarViewContext';
import { CalendarEventContent } from './events/EventContent';
import { SelectedEventDetailsPopover } from './events/EventDetailsPopover';
import type { CalendarTimeFormat } from './events/types';
import { FullCalendar, useFullCalendar } from './fullcalendar-solid';
import {
  CALENDAR_TIME_FORMAT_OPTIONS,
  formatCalendarTime,
  formatCompactCalendarTime,
} from './time-format';
import { useCalendarTimeGridHoverIndicator } from './useCalendarTimeGridHoverIndicator';
import './calendar.css';

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

function ResponsiveCalendarHost() {
  const calendar = useFullCalendar();
  const calendarView = useCalendarView();
  const [element, setElement] = createSignal<HTMLDivElement>();

  useCalendarTimeGridHoverIndicator(element);

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
            calendarView.setUseNarrowDayHeaders(observedWidth < 520);
            calendarApi.updateSize();
          });
        });

        resizeObserver.observe(calendarElement);

        onCleanup(() => {
          resizeObserver.disconnect();

          if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
        });
      }
    )
  );

  return (
    <Layer depth={2}>
      <div class="flex min-w-0 min-h-0 flex-1 flex-col">
        <CalendarRangeUnavailableBanner />
        <div class="relative flex min-w-0 min-h-0 flex-1">
          <FullCalendar.Host
            tabIndex={-1}
            ref={(calendarElement) => {
              setElement(calendarElement);
              calendarView.setUseNarrowDayHeaders(
                calendarElement.clientWidth < 520
              );
            }}
            class="calendar-view-host min-w-0 min-h-0 flex-1 overflow-hidden rounded-xl"
          />
          <CalendarScrollIndicators calendarElement={element} />
          <CalendarDataStatus />
        </div>
      </div>
    </Layer>
  );
}

/** A calendar-focused workspace view backed by FullCalendar. */
export function CalendarView() {
  return (
    <CalendarViewContextProvider>
      <CalendarViewContent />
    </CalendarViewContextProvider>
  );
}

function CalendarViewContent() {
  const calendarView = useCalendarView();

  const handleDatesSet = ({ end, start }: DatesSetArg) => {
    calendarView.updateVisibleRange(start, end);
  };

  return (
    <FullCalendar.Root
      plugins={[dayGridPlugin, interactionPlugin, timeGridPlugin]}
      initialView="timeGridWeek"
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
      events={calendarView.fullCalendarEvents()}
      eventClick={({ el, event, jsEvent }) => {
        jsEvent.preventDefault();
        calendarView.selectEvent(event.id, el);
      }}
      datesSet={handleDatesSet}
      dayHeaderFormat={{
        weekday: calendarView.useNarrowDayHeaders() ? 'narrow' : 'short',
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
                    calendarView.useNarrowDayHeaders() ? 'narrow' : 'short'
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
          const event = calendarView.eventsById().get(renderProps.event.id);
          if (!event) return null;

          return (
            <CalendarEventContent
              event={event}
              renderProps={renderProps}
              isSelected={calendarView.eventState.selectedEventId === event.id}
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

      <SidePanel.Layout>
        <CalendarWorkspace />
      </SidePanel.Layout>
    </FullCalendar.Root>
  );
}

function createLocalToday() {
  const [today, setToday] = createSignal(new Date());
  let refreshTimer: number | undefined;

  const scheduleRefresh = () => {
    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setDate(nextMidnight.getDate() + 1);
    nextMidnight.setHours(0, 0, 0, 0);

    refreshTimer = window.setTimeout(
      () => {
        setToday(new Date());
        scheduleRefresh();
      },
      nextMidnight.getTime() - now.getTime() + 100
    );
  };

  scheduleRefresh();

  onCleanup(() => {
    if (refreshTimer !== undefined) clearTimeout(refreshTimer);
  });

  return today;
}

function CalendarWorkspace() {
  const panel = useSplitPanelOrThrow();
  const calendar = useFullCalendar();
  const calendarView = useCalendarView();
  const initialDate = new Date();
  const today = createLocalToday();

  const currentDate = createMemo(
    () => calendar.dateInfo()?.view.calendar.getDate() ?? initialDate
  );
  const dateTitle = createMemo(() => formatMonthTitle(currentDate()));
  const visibleRange = createMemo(() => {
    const dateInfo = calendar.dateInfo();
    return dateInfo ? { end: dateInfo.end, start: dateInfo.start } : undefined;
  });
  const isTodayVisible = createMemo(() => {
    const range = visibleRange();
    if (!range) return true;

    const currentDay = today();
    return currentDay >= range.start && currentDay < range.end;
  });

  onMount(() => panel.handle.setDisplayName('Calendar'));

  return (
    <>
      <SplitHeaderLeft>
        <HeaderIsland class="shrink">
          <div class="flex min-w-0 items-center gap-2">
            <span class="min-w-0 truncate text-base font-semibold text-ink">
              {dateTitle()}
            </span>
            <Show when={!isTodayVisible()}>
              <Button
                variant="active"
                size="sm"
                class="rounded-lg px-3"
                depth={2}
                label="Go to today"
                onClick={() => calendar.api()?.today()}
              >
                Today
              </Button>
            </Show>
          </div>
        </HeaderIsland>
      </SplitHeaderLeft>

      <SplitHeaderRight>
        <HeaderIsland class="px-1">
          <div class="flex items-center gap-1">
            <CalendarPeriodSelector />
            <div class="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                class="rounded-lg"
                label="Previous period"
                onClick={() => calendar.api()?.prev()}
              >
                <CaretLeftIcon class="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                class="rounded-lg"
                label="Next period"
                onClick={() => calendar.api()?.next()}
              >
                <CaretRightIcon class="size-4" />
              </Button>
            </div>
            <CalendarSettingsDropdown />
          </div>
        </HeaderIsland>
      </SplitHeaderRight>

      <CalendarSidePanelSections />

      <SelectedEventDetailsPopover
        anchor={calendarView.selectedEventAnchor}
        event={calendarView.selectedEvent}
        timeFormat={() => calendarView.displaySettings.timeFormat}
        onClose={calendarView.closeEventDetails}
      />

      <main class="calendar-view flex size-full min-h-0">
        <div class="calendar-view-content flex min-w-0 min-h-0 flex-1 flex-col">
          <ResponsiveCalendarHost />
        </div>
      </main>
    </>
  );
}
