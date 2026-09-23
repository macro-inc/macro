import {
  CALENDAR_PAGE_IDS,
  CalendarPagerContextProvider,
  useCalendarPager,
} from '@app/features/calendar/components/CalendarPagerContext';
import { useCalendarView } from '@app/features/calendar/components/CalendarViewContext';
import { RangeUnavailableBanner } from '@app/features/calendar/components/RangeUnavailableBanner';
import { SidePanel } from '@components/app/side-panel/SidePanel';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { isMobile } from '@core/mobile/isMobile';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import { Layer } from '@ui';
import { Pager, PagerSwipeGestures } from '@ui/components/Pager';
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
import { SidePanelSections } from './SidePanelSections';

const CALENDAR_SWIPE_EDGE_INSET = 40;

function CalendarPages() {
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
      <div class="flex min-w-0 min-h-0 flex-1 flex-col">
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

function CalendarPagerWorkspace() {
  const calendarPager = useCalendarPager();

  return (
    <Pager.Root controller={calendarPager.pager}>
      <SidePanel.Layout persistKey="calendar">
        <WorkspaceContent />
      </SidePanel.Layout>
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
