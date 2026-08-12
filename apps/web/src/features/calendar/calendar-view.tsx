import { SidePanel } from '@components/app/side-panel/SidePanel';
import { HeaderIsland } from '@components/app/split-layout/components/HeaderIsland';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { TOKENS } from '@core/hotkey/tokens';
import { isMobile } from '@core/mobile/isMobile';
import CalendarBlankIcon from '@phosphor/calendar-blank.svg';
import CaretLeftIcon from '@phosphor/caret-left.svg';
import CaretRightIcon from '@phosphor/caret-right.svg';
import PlusIcon from '@phosphor/plus.svg';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import { Button, Layer } from '@ui';
import { Pager, PagerSwipeGestures, usePager } from '@ui/components/Pager';
import {
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  Suspense,
} from 'solid-js';
import { CalendarMonthDrawer } from './CalendarMonthDrawer';
import { CalendarPage } from './CalendarPage';
import {
  CALENDAR_PAGE_IDS,
  type CalendarPageId,
  CalendarPagerContextProvider,
  useCalendarPager,
} from './CalendarPagerContext';
import { CalendarPeriodSelector } from './CalendarPeriodSelector';
import { CalendarRangeUnavailableBanner } from './CalendarRangeUnavailableBanner';
import { CalendarSettingsDropdown } from './CalendarSettingsDropdown';
import { CalendarSetupStatus } from './CalendarSetupStatus';
import { CalendarSidePanelSections } from './CalendarSidePanelSections';
import {
  CalendarViewContextProvider,
  useCalendarView,
} from './CalendarViewContext';
import { SelectedEventDetails } from './events/EventDetailsPopover';
import { EventEditorDialog } from './events/EventEditorDialog';
import { useCalendarHotkeys } from './use-calendar-hotkeys';
import './calendar.css';

const CALENDAR_SWIPE_EDGE_INSET = 40;

const formatMonthTitle = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  year: 'numeric',
}).format;

/** A calendar-focused workspace view backed by buffered FullCalendar pages. */
export function CalendarView() {
  return (
    <CalendarViewContextProvider>
      <CalendarPagerContextProvider>
        <CalendarPagerRoot />
      </CalendarPagerContextProvider>
    </CalendarViewContextProvider>
  );
}

function CalendarPagerRoot() {
  const calendarPager = useCalendarPager();

  return (
    <Pager.Root controller={calendarPager.pager}>
      <SidePanel.Layout>
        <CalendarWorkspace />
      </SidePanel.Layout>
    </Pager.Root>
  );
}

function CalendarPages() {
  const calendarPager = useCalendarPager();
  const calendarView = useCalendarView();
  const [viewport, setViewport] = createSignal<HTMLDivElement>();
  let resizeFrame: number | undefined;

  createResizeObserver(viewport, ({ width }) => {
    if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);

    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = undefined;
      calendarView.setUseNarrowDayHeaders(width < 520);
      calendarPager.updateSize();
    });
  });

  onCleanup(() => {
    if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
  });

  return (
    <Layer depth={2}>
      <div class="flex min-w-0 min-h-0 flex-1 flex-col">
        <CalendarRangeUnavailableBanner
          class={isMobile() ? 'order-last' : undefined}
          fullWidth={isMobile()}
        />
        <div
          ref={setViewport}
          class="relative flex min-w-0 min-h-0 flex-1"
          role="region"
          aria-label="Calendar periods"
        >
          <Pager.Viewport class="size-full min-w-0 min-h-0">
            <For each={CALENDAR_PAGE_IDS}>
              {(pageId) => (
                <Pager.Page id={pageId}>
                  <Suspense>
                    <CalendarPage
                      id={pageId}
                      initialDate={calendarPager.initialDateFor(pageId)}
                    />
                  </Suspense>
                </Pager.Page>
              )}
            </For>
          </Pager.Viewport>
          <Show when={isMobile()}>
            <PagerSwipeGestures
              edgeInset={CALENDAR_SWIPE_EDGE_INSET}
              canStart={(event) =>
                !(
                  event.target instanceof Element &&
                  event.target.closest(
                    'button, input, select, textarea, [role="button"]'
                  )
                )
              }
            />
          </Show>
          <CalendarSetupStatus />
        </div>
      </div>
    </Layer>
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
  const calendarPager = useCalendarPager();
  const pager = usePager<CalendarPageId>();
  const calendarView = useCalendarView();
  const initialDate = new Date();
  const today = createLocalToday();
  const [createEventOpen, setCreateEventOpen] = createSignal(false);

  useCalendarHotkeys({
    scopeId: panel.splitHotkeyScope,
    changeView: calendarPager.changeView,
    previousPeriod: pager.previous,
    nextPeriod: pager.next,
    navigateToToday: calendarPager.navigateToToday,
  });

  const currentDate = createMemo(
    () => calendarPager.activeDateInfo()?.view.calendar.getDate() ?? initialDate
  );
  const dateTitle = createMemo(() => formatMonthTitle(currentDate()));
  const visibleRange = createMemo(() => {
    const dateInfo = calendarPager.activeDateInfo();
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
          <Show
            when={isMobile()}
            fallback={
              <span class="min-w-0 truncate text-base font-semibold text-ink">
                {dateTitle()}
              </span>
            }
          >
            <CalendarMonthDrawer month={currentDate()} />
          </Show>
        </HeaderIsland>
      </SplitHeaderLeft>

      <SplitHeaderRight>
        <HeaderIsland class="px-1">
          <div class="flex items-center gap-1">
            <Show
              when={isMobile()}
              fallback={
                <Show when={!isTodayVisible()}>
                  <Button
                    variant="active"
                    size="sm"
                    class="rounded-lg px-3"
                    depth={2}
                    label="Go to today"
                    hotkey={TOKENS.calendar.period.today}
                    onClick={calendarPager.navigateToToday}
                  >
                    Today
                  </Button>
                </Show>
              }
            >
              <Button
                variant="ghost"
                size="icon-sm"
                class="rounded-full"
                label="Go to today"
                hotkey={TOKENS.calendar.period.today}
                onClick={calendarPager.navigateToToday}
              >
                <CalendarBlankIcon aria-hidden="true" />
                <span
                  aria-hidden="true"
                  class="pointer-events-none absolute inset-0 flex items-center justify-center pt-1 text-[8px] font-bold leading-none"
                >
                  {today().getDate()}
                </span>
              </Button>
            </Show>
            <Show when={!isMobile()}>
              <Button
                variant="ghost"
                size="sm"
                class="rounded-lg px-2"
                label="New event"
                onClick={() => setCreateEventOpen(true)}
              >
                <PlusIcon class="size-3.5" />
                New event
              </Button>
              <CalendarPeriodSelector />
              <div class="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  class="rounded-lg"
                  label="Previous period"
                  hotkey={TOKENS.calendar.period.previous}
                  onClick={() => void pager.previous()}
                >
                  <CaretLeftIcon class="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  class="rounded-lg"
                  label="Next period"
                  hotkey={TOKENS.calendar.period.next}
                  onClick={() => void pager.next()}
                >
                  <CaretRightIcon class="size-4" />
                </Button>
              </div>
            </Show>
            <CalendarSettingsDropdown />
          </div>
        </HeaderIsland>
      </SplitHeaderRight>

      <CalendarSidePanelSections />

      <SelectedEventDetails
        anchor={calendarView.selectedEventAnchor}
        event={calendarView.selectedEvent}
        timeFormat={() => calendarView.displaySettings.timeFormat}
        onClose={calendarView.closeEventDetails}
      />

      <Show when={createEventOpen()}>
        <EventEditorDialog open onClose={() => setCreateEventOpen(false)} />
      </Show>

      <main class="calendar-view flex size-full min-h-0">
        <div class="calendar-view-content flex min-w-0 min-h-0 flex-1 flex-col">
          <CalendarPages />
        </div>
      </main>
    </>
  );
}
