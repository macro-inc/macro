import { ViewShell } from '@app/components/view-shell';
import {
  CALENDAR_PAGE_IDS,
  type CalendarPageId,
  CalendarPagerContextProvider,
  useCalendarPager,
} from '@app/features/calendar/components/CalendarPagerContext';
import { useCalendarView } from '@app/features/calendar/components/CalendarViewContext';
import { RangeUnavailableBanner } from '@app/features/calendar/components/RangeUnavailableBanner';
import { ViewTour } from '@app/features/tours/ViewTour';
import { createRenderQueue } from '@app/lib/utils/create-render-queue';
import { createSizeBreakpoints } from '@app/util/create-size-breakpoints';
import {
  useSplitDisplayName,
  useSplitPanelOrThrow,
} from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { isMobile } from '@core/mobile/isMobile';
import { createElementSize } from '@solid-primitives/resize-observer';
import { Layer } from '@ui';
import { Pager, PagerSwipeGestures } from '@ui/components/Pager';
import { tourTarget } from '@ui/components/Tour';
import {
  createEffect,
  createSignal,
  For,
  type JSX,
  Match,
  on,
  onCleanup,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import { CALENDAR_TOUR, calendarTour } from '../tour';
import { CalendarSidebar } from './CalendarSidebar';
import { Header } from './Header';
import { Page } from './Page';
import { SelectedEventDetails } from './SelectedEventDetails';
import { SetupStatus } from './SetupStatus';
import { SyncStatus } from './SyncStatus';

const CALENDAR_SWIPE_EDGE_INSET = 40;
const NEIGHBOR_MOUNT_DEADLINE_MS = 600;

/** One period's grid, starting beside what the active page shows by then. */
function CalendarPeriodPage(props: {
  id: CalendarPageId;
  useNarrowDayHeaders: boolean;
}) {
  const calendarPager = useCalendarPager();
  // Read once: FullCalendar takes its initial date only when it mounts.
  const initialDate = calendarPager.initialDateFor(props.id);

  return (
    <Suspense>
      <Page
        id={props.id}
        initialDate={initialDate}
        useNarrowDayHeaders={props.useNarrowDayHeaders}
      />
    </Suspense>
  );
}

function CalendarPages() {
  const calendarView = useCalendarView();
  const calendarPager = useCalendarPager();
  // Opening the calendar paints the visible period alone. Its neighbors only
  // matter once someone swipes, so they mount on later tasks.
  const mountQueue = createRenderQueue();
  const [mountedPages, setMountedPages] = createSignal<
    readonly CalendarPageId[]
  >([calendarPager.activePageId()]);

  const mountNeighbors = () => {
    const neighbors = CALENDAR_PAGE_IDS.filter(
      (id) => !mountedPages().includes(id)
    );

    for (const id of neighbors) {
      mountQueue.enqueue(id, () => setMountedPages((pages) => [...pages, id]));
    }
  };

  // Neighbors wait for the visible period's events, so mounting them never
  // holds up what is on screen; a slow load releases them after a moment.
  createEffect(() => {
    const visiblePeriodLoaded =
      calendarPager.activeData()?.isLoading() === false;

    if (!visiblePeriodLoaded) {
      const deadline = setTimeout(mountNeighbors, NEIGHBOR_MOUNT_DEADLINE_MS);
      onCleanup(() => clearTimeout(deadline));
      return;
    }

    // After the frame that paints those events.
    const frame = requestAnimationFrame(mountNeighbors);
    onCleanup(() => cancelAnimationFrame(frame));
  });

  const [viewport, setViewport] = createSignal<HTMLDivElement>();
  const viewportSize = createElementSize(viewport);
  const breakpoints = createSizeBreakpoints(
    () => viewportSize.width ?? undefined,
    {
      fullDayHeaders: { min: 520 },
    }
  );
  const useNarrowDayHeaders = () =>
    viewportSize.width !== null && !breakpoints.fullDayHeaders();
  let resizeFrame: number | undefined;

  createEffect(
    on(
      () => viewportSize.width,
      (width) => {
        if (width === null) return;
        if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(() => {
          resizeFrame = undefined;
          calendarPager.updateSize();
        });
      }
    )
  );

  onCleanup(() => {
    if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
  });

  return (
    <Layer depth={2}>
      <div class="flex min-w-0 min-h-0 flex-1 flex-col">
        <SyncStatus
          syncing={calendarPager.activeData()?.isSyncing() ?? false}
        />
        <RangeUnavailableBanner
          class={isMobile() ? 'order-last' : undefined}
          fullWidth={isMobile()}
        />
        <div
          ref={setViewport}
          class="relative flex min-w-0 min-h-0 flex-1 overflow-hidden"
          role="region"
          aria-label="Calendar periods"
        >
          <Pager.Viewport class="size-full min-w-0 min-h-0">
            <For each={CALENDAR_PAGE_IDS}>
              {(pageId) => (
                <Pager.Page id={pageId}>
                  <Show when={mountedPages().includes(pageId)}>
                    <CalendarPeriodPage
                      id={pageId}
                      useNarrowDayHeaders={useNarrowDayHeaders()}
                    />
                  </Show>
                </Pager.Page>
              )}
            </For>
          </Pager.Viewport>
          <Show when={viewport()}>
            {(boundary) => (
              <SelectedEventDetails
                boundary={boundary()}
                anchor={calendarView.selectedEventAnchor}
                event={calendarView.selectedEvent}
                timeFormat={() => calendarView.displaySettings.timeFormat}
                onClose={calendarView.closeEventDetails}
              />
            )}
          </Show>
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

function CalendarPageContent() {
  return (
    <div
      ref={tourTarget(CALENDAR_TOUR.grid)}
      class="calendar-view-content flex min-w-0 min-h-0 flex-1 flex-col"
    >
      <CalendarPages />
    </div>
  );
}

function WorkspaceContent(props: { headerLeading?: JSX.Element }) {
  const panel = useSplitPanelOrThrow();

  // An inline preview keeps its host's name.
  useSplitDisplayName(() => (panel.isInlinePreview ? undefined : 'Calendar'));

  return (
    <Switch>
      <Match when={panel.isInlinePreview}>
        <div class="flex size-full min-h-0 min-w-0 flex-col">
          <Header presentation="preview" leading={props.headerLeading} />
          <main class="flex min-h-0 flex-1">
            <CalendarPageContent />
          </main>
        </div>
      </Match>
      <Match when={!panel.isInlinePreview}>
        <SplitPanel.Root>
          <SplitPanel.Body>
            <ViewShell.Root
              asidePreferenceKey="calendar"
              resizable
              aside={isMobile() ? false : { preserveDuringResize: false }}
              main={{ preferredWidth: 640 }}
            >
              <Show when={!isMobile()}>
                <ViewShell.Aside>
                  <CalendarSidebar />
                </ViewShell.Aside>
              </Show>
              <ViewShell.Main>
                <Header presentation="workspace" />
                <ViewTour tour={calendarTour} />
                <ViewShell.Content class="flex min-h-0 flex-1">
                  <CalendarPageContent />
                </ViewShell.Content>
              </ViewShell.Main>
            </ViewShell.Root>
          </SplitPanel.Body>
        </SplitPanel.Root>
      </Match>
    </Switch>
  );
}

function CalendarPagerWorkspace(props: { headerLeading?: JSX.Element }) {
  const calendarPager = useCalendarPager();

  return (
    <Pager.Root controller={calendarPager.pager}>
      <WorkspaceContent headerLeading={props.headerLeading} />
    </Pager.Root>
  );
}

export function Workspace(props: { headerLeading?: JSX.Element }) {
  const calendarView = useCalendarView();

  return (
    <CalendarPagerContextProvider
      initialView={calendarView.displaySettings.periodView}
      showWeekends={() => calendarView.displaySettings.showWeekends}
      weekStartsOn={() => calendarView.displaySettings.weekStartsOn}
      onNavigate={calendarView.closeEventDetails}
      onViewChange={calendarView.setPeriodView}
    >
      <CalendarPagerWorkspace headerLeading={props.headerLeading} />
    </CalendarPagerContextProvider>
  );
}
