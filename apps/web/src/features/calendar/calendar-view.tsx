import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { TabsInset } from '@core/component/TabsInset';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
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
import { FullCalendar, useFullCalendar } from './fullcalendar-solid';
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
const formatCurrentTime = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
}).format;

const isSameLocalDate = (first: Date, second: Date) =>
  first.getFullYear() === second.getFullYear() &&
  first.getMonth() === second.getMonth() &&
  first.getDate() === second.getDate();

function CurrentTimeAxisIndicator(props: { date: Date }) {
  return (
    <span class="calendar-now-axis-indicator">
      <span class="calendar-now-time">{formatCurrentTime(props.date)}</span>
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

  return (
    <FullCalendar.Root
      plugins={[dayGridPlugin, timeGridPlugin]}
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

          return <CurrentTimeAxisIndicator date={new Date()} />;
        }}
      </FullCalendar.NowIndicatorContent>

      <CalendarWorkspace onNarrowDayHeadersChange={setUseNarrowDayHeaders} />
    </FullCalendar.Root>
  );
}

function CalendarWorkspace(props: ResponsiveCalendarHostProps) {
  const panel = useSplitPanelOrThrow();
  const calendar = useFullCalendar();
  const [isTodayVisible, setIsTodayVisible] = createSignal(true);
  const initialDate = new Date();
  const [miniCalendarFocusedDay, setMiniCalendarFocusedDay] =
    createSignal(initialDate);
  let todayRefreshTimer: number | undefined;
  const usePeriodDropdown = createMemo(
    () => (panel.panelSize.width ?? 0) < 600
  );
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

  createEffect(on(calendar.dateInfo, refreshTodayVisibility));
  createEffect(on(currentDate, setMiniCalendarFocusedDay));
  onMount(() => panel.handle.setDisplayName('Calendar'));
  onCleanup(() => {
    if (todayRefreshTimer !== undefined) clearTimeout(todayRefreshTimer);
  });

  return (
    <main class="calendar-view flex size-full min-h-0 bg-surface">
      <aside class="calendar-view-sidebar w-60 shrink-0 flex-col border-r border-edge-muted bg-panel p-3">
        <MiniCalendar
          required
          fixedWeeks
          startOfWeek={0}
          value={currentDate()}
          month={currentDate()}
          focusedDay={miniCalendarFocusedDay()}
          highlightedRange={miniCalendarHighlightedRange()}
          onMonthChange={navigateMiniCalendarMonth}
          onFocusedDayChange={setMiniCalendarFocusedDay}
          onValueChange={selectMiniCalendarDate}
        />
      </aside>
      <div class="calendar-view-content flex min-w-0 min-h-0 flex-1 flex-col">
        <div class="mb-3 flex min-w-0 items-center gap-3 border-b border-edge-muted pb-3">
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
          <div class="ml-auto shrink-0">
            <Show
              when={usePeriodDropdown()}
              fallback={
                <TabsInset
                  class="h-7 shrink-0"
                  list={CALENDAR_VIEW_TABS}
                  value={activeView()}
                  onChange={changeView}
                />
              }
            >
              <Dropdown placement="bottom-start">
                <Dropdown.Trigger
                  aria-label="Choose calendar view"
                  class="h-7 shrink-0 gap-1 rounded-lg border-edge-muted bg-surface px-2 text-xs font-medium text-ink"
                >
                  {CALENDAR_VIEW_TABS.find(
                    (view) => view.value === activeView()
                  )?.label ?? 'Month'}
                  <CaretDownIcon class="size-3 text-ink-muted" />
                </Dropdown.Trigger>
                <Dropdown.Content class="min-w-28 p-1">
                  <Dropdown.RadioGroup
                    value={activeView()}
                    onChange={changeView}
                  >
                    <For each={CALENDAR_VIEW_TABS}>
                      {(view) => (
                        <Dropdown.RadioItem closeOnSelect value={view.value}>
                          {view.label}
                          <Dropdown.ItemIndicator class="ml-auto">
                            <CheckIcon class="size-3.5 text-accent" />
                          </Dropdown.ItemIndicator>
                        </Dropdown.RadioItem>
                      )}
                    </For>
                  </Dropdown.RadioGroup>
                </Dropdown.Content>
              </Dropdown>
            </Show>
          </div>
        </div>
        <ResponsiveCalendarHost
          onNarrowDayHeadersChange={props.onNarrowDayHeadersChange}
        />
      </div>
    </main>
  );
}
