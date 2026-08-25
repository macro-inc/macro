import { activeAppLayout } from '@app/features/app-layout/layout-state';
import {
  CALENDAR_PAGE_IDS,
  CalendarPagerContextProvider,
  type CalendarPageId,
  useCalendarPager,
} from '@app/features/calendar/components/CalendarPagerContext';
import { CalendarSettingsDropdown } from '@app/features/calendar/components/CalendarSettingsDropdown';
import { useCalendarView } from '@app/features/calendar/components/CalendarViewContext';
import { PeriodSelector } from '@app/features/calendar/components/PeriodSelector';
import { RangeUnavailableBanner } from '@app/features/calendar/components/RangeUnavailableBanner';
import { SourceControls } from '@app/features/calendar/components/SourceControls';
import { useCalendarHotkeys } from '@app/features/calendar/hooks/use-calendar-hotkeys';
import { calendarPeriodLabel } from '@app/features/calendar/utils/calendar-label';
import { ExperimentalViewSidebar } from '@app/features/experimental-app-layout-v2/experimental-view-sidebar';
import { SidePanel } from '@components/app/side-panel/SidePanel';
import { ComposedSplitControls } from '@components/app/split-layout/composed/ComposedSplitControls';
import { ComposedSplitHeader } from '@components/app/split-layout/composed/ComposedSplitHeader';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { TOKENS } from '@core/hotkey/tokens';
import { isMobile } from '@core/mobile/isMobile';
import CaretLeftIcon from '@phosphor/caret-left.svg';
import CaretRightIcon from '@phosphor/caret-right.svg';
import PlusIcon from '@phosphor/plus.svg';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import { Button, cn, Layer } from '@ui';
import { Pager, PagerSwipeGestures, usePager } from '@ui/components/Pager';
import {
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  Suspense,
} from 'solid-js';
import { Header } from './Header';
import { Page } from './Page';
import { SelectedEventDetails } from './SelectedEventDetails';
import { SetupStatus } from './SetupStatus';
import { CalendarMiniCalendarControl, SidePanelSections } from './SidePanelSections';
import { useOpenEventComposer } from './use-open-event-composer';

const CALENDAR_SWIPE_EDGE_INSET = 40;

function CalendarPages(props: { experimental?: boolean }) {
  const calendarPager = useCalendarPager();
  const [viewport, setViewport] = createSignal<HTMLDivElement>();
  const [useNarrowDayHeaders, setUseNarrowDayHeaders] = createSignal(false);
  let resizeFrame: number | undefined;

  createResizeObserver(viewport, ({ width }) => {
    if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);

    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = undefined;
      setUseNarrowDayHeaders(width < 520);
      calendarPager.updateSize();
    });
  });

  onCleanup(() => {
    if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
  });

  return (
    <Layer depth={2}>
      <div
        class={cn(
          'flex min-w-0 min-h-0 flex-1 flex-col',
          props.experimental && 'overflow-hidden rounded-2xl bg-surface'
        )}
      >
        <RangeUnavailableBanner
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
                    <Page
                      id={pageId}
                      initialDate={calendarPager.initialDateFor(pageId)}
                      useNarrowDayHeaders={useNarrowDayHeaders()}
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
                    'button, input, select, textarea, [role="button"], .fc-event'
                  )
                )
              }
            />
          </Show>
          <SetupStatus />
        </div>
      </div>
    </Layer>
  );
}

function WorkspaceContent() {
  const panel = useSplitPanelOrThrow();
  const calendarView = useCalendarView();

  onMount(() => panel.handle.setDisplayName('Calendar'));

  return (
    <>
      <Header />
      <SidePanelSections />

      <SelectedEventDetails
        anchor={calendarView.selectedEventAnchor}
        event={calendarView.selectedEvent}
        timeFormat={() => calendarView.displaySettings.timeFormat}
        onClose={calendarView.closeEventDetails}
      />

      <main class="flex size-full min-h-0">
        <div class="calendar-view-content flex min-w-0 min-h-0 flex-1 flex-col">
          <CalendarPages />
        </div>
      </main>
    </>
  );
}

const formatMonthTitle = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  year: 'numeric',
}).format;

function ExperimentalCalendarWorkspaceContent() {
  const panel = useSplitPanelOrThrow();
  const calendarView = useCalendarView();
  const calendarPager = useCalendarPager();
  const pager = usePager<CalendarPageId>();
  const openEventComposer = useOpenEventComposer();
  const initialDate = new Date();

  onMount(() => panel.handle.setDisplayName('Calendar'));

  useCalendarHotkeys({
    scopeId: panel.splitHotkeyScope,
    changeView: calendarPager.changeView,
    previousPeriod: pager.previous,
    nextPeriod: pager.next,
    navigateToToday: calendarPager.navigateToToday,
  });

  const currentDate = () =>
    calendarPager.activeDateInfo()?.view.calendar.getDate() ?? initialDate;
  const dateTitle = () => formatMonthTitle(currentDate());
  const periodLabel = () =>
    calendarPeriodLabel(calendarView.displaySettings.periodView).toLowerCase();
  const isTodayVisible = () => {
    const dateInfo = calendarPager.activeDateInfo();
    if (!dateInfo) return true;
    const today = new Date();
    return today >= dateInfo.start && today < dateInfo.end;
  };

  const NewEventButton = () => (
    <Button
      variant="cta"
      size="sm"
      class="h-8 shrink-0 rounded-lg px-3 font-semibold"
      onClick={() => openEventComposer()}
    >
      <PlusIcon class="size-3.5" />
      New event
    </Button>
  );

  return (
    <div class="@container/experimental-soup relative flex size-full min-h-0 bg-panel">
      <ExperimentalViewSidebar
        label="Calendar navigation"
        class="mb-0 border-r-0! pt-2"
      >
        <ComposedSplitHeader class="flex min-h-8 shrink-0 items-center">
          <ComposedSplitControls />
        </ComposedSplitHeader>
        <div class="mt-3 flex shrink-0 items-center">
          <NewEventButton />
        </div>
        <div class="scrollbar-hidden mt-5 min-h-0 flex-1 overflow-y-auto">
          <CalendarMiniCalendarControl />
          <Show when={calendarView.sources().length > 1}>
            <section class="mt-5 border-t border-edge-muted pt-4">
              <h2 class="m-0 px-2 pb-2 text-xs font-semibold text-ink-extra-muted">
                Calendars
              </h2>
              <SourceControls
                sources={calendarView.sources()}
                isVisible={calendarView.isSourceVisible}
                onVisibilityChange={calendarView.setSourceVisibility}
              />
            </section>
          </Show>
        </div>
      </ExperimentalViewSidebar>

      <SelectedEventDetails
        anchor={calendarView.selectedEventAnchor}
        event={calendarView.selectedEvent}
        timeFormat={() => calendarView.displaySettings.timeFormat}
        onClose={calendarView.closeEventDetails}
      />

      <main class="flex min-h-0 min-w-0 flex-1 flex-col">
        <div class="hidden shrink-0 px-2 pt-2 @max-[720px]/experimental-soup:block">
          <div class="flex min-h-7 items-center">
            <ComposedSplitControls />
          </div>
        </div>
        <header class="flex shrink-0 items-center gap-3 px-4 pb-4 pt-4 @max-[720px]/experimental-soup:flex-col @max-[720px]/experimental-soup:items-stretch @max-[720px]/experimental-soup:gap-2 @max-[720px]/experimental-soup:pt-1 @max-[760px]/experimental-soup:px-3 @max-[480px]/experimental-soup:px-2">
          <div class="flex min-w-0 flex-1 items-center gap-2">
            <h1 class="m-0 min-w-0 truncate text-2xl font-semibold tracking-[-0.03em] text-ink @max-[720px]/experimental-soup:flex-1">
              {dateTitle()}
            </h1>
            <CalendarSettingsDropdown />
          </div>
          <div class="ml-auto flex shrink-0 items-center gap-1 @max-[720px]/experimental-soup:w-full @max-[720px]/experimental-soup:justify-end">
            <Show
              when={!isTodayVisible()}
              fallback={
                <Button
                  variant="active"
                  size="sm"
                  class="hidden h-9 rounded-lg px-4 @max-[720px]/experimental-soup:inline-flex"
                  depth={2}
                  label="Go to today"
                  hotkey={TOKENS.calendar.period.today}
                  onClick={calendarPager.navigateToToday}
                >
                  Today
                </Button>
              }
            >
              <Button
                variant="active"
                size="sm"
                class="h-9 rounded-lg px-4"
                depth={2}
                label="Go to today"
                hotkey={TOKENS.calendar.period.today}
                onClick={calendarPager.navigateToToday}
              >
                Today
              </Button>
            </Show>
            <div class="hidden flex-1 @max-[720px]/experimental-soup:block" />
            <PeriodSelector large />
            <Button
              variant="ghost"
              size="icon-md"
              class="rounded-lg"
              label={`Previous ${periodLabel()}`}
              hotkey={TOKENS.calendar.period.previous}
              onClick={() => void pager.previous()}
            >
              <CaretLeftIcon class="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-md"
              class="rounded-lg"
              label={`Next ${periodLabel()}`}
              hotkey={TOKENS.calendar.period.next}
              onClick={() => void pager.next()}
            >
              <CaretRightIcon class="size-4" />
            </Button>
          </div>
        </header>
        <div class="flex min-h-0 flex-1 flex-col px-4 pb-4 @max-[760px]/experimental-soup:px-3 @max-[480px]/experimental-soup:px-2">
          <div class="relative flex min-h-0 flex-1 flex-col">
            <CalendarPages experimental />
            <Button
              variant="cta"
              size="icon-md"
              class="absolute left-2 top-2 z-annotation-layer hidden rounded-lg opacity-65 shadow-md shadow-drop-shadow/30 transition-opacity hover:opacity-100 focus-visible:opacity-100 @max-[720px]/experimental-soup:inline-flex"
              label="New event"
              tooltipPlacement="right"
              onClick={() => openEventComposer()}
            >
              <PlusIcon />
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}

function CalendarPagerWorkspace() {
  const calendarPager = useCalendarPager();

  return (
    <Pager.Root controller={calendarPager.pager}>
      <Show
        when={activeAppLayout().capabilities.usesCalendarWorkspace}
        fallback={
          <SidePanel.Layout persistKey="calendar">
            <WorkspaceContent />
          </SidePanel.Layout>
        }
      >
        <ExperimentalCalendarWorkspaceContent />
      </Show>
    </Pager.Root>
  );
}

export function Workspace() {
  const calendarView = useCalendarView();

  return (
    <CalendarPagerContextProvider
      initialView={calendarView.displaySettings.periodView}
      showWeekends={() => calendarView.displaySettings.showWeekends}
      weekStartsOn={() => calendarView.displaySettings.weekStartsOn}
      onNavigate={calendarView.closeEventDetails}
      onViewChange={calendarView.setPeriodView}
    >
      <CalendarPagerWorkspace />
    </CalendarPagerContextProvider>
  );
}
