import { ViewShell } from '@app/components/view-shell';
import {
  CALENDAR_PAGE_COUNT,
  type CalendarPageId,
  CalendarPagerContextProvider,
  useCalendarPager,
} from '@app/features/calendar/components/CalendarPagerContext';
import { useCalendarView } from '@app/features/calendar/components/CalendarViewContext';
import { RangeUnavailableBanner } from '@app/features/calendar/components/RangeUnavailableBanner';
import { useCalendarComposerHost } from '@app/features/calendar/context/calendar-composer-host-context';
import { CALENDAR_GRID_FULL_HEADER_WIDTH } from '@app/features/calendar/primitives/create-calendar-composer-pinning';
import { ViewTour } from '@app/features/tours/ViewTour';
import { t } from '@app/lib/i18n';
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
import { SnapPager } from '@ui/components/SnapPager/SnapPager';
import { tourTarget } from '@ui/components/Tour';
import {
  createEffect,
  createMemo,
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
import {
  CALENDAR_VIEWPORT_KEY,
  type CalendarViewportContext,
  CalendarViewportProvider,
  type CalendarViewportSnapshot,
  CalendarViewportSnapshotSchema,
} from '../context/calendar-viewport-context';
import { CALENDAR_TOUR, calendarTour } from '../tour';
import { AgendaContent } from '../views/agenda/AgendaContent';
import { AgendaNavigation } from '../views/agenda/AgendaNavigation';
import { AgendaSetup } from '../views/agenda/AgendaSetup';
import { CalendarGridNavigation } from '../views/CalendarGridNavigation';
import { CalendarComposerDock } from '../views/composer/CalendarComposerDock';
import { CalendarComposerHost } from '../views/composer/CalendarComposerHost';
import { MobileCalendarGridAxis } from '../views/mobile/calendar-grid-axis';
import { SelectedCalendarEvent } from '../views/SelectedCalendarEvent';
import { CalendarSidebar } from './CalendarSidebar';
import { Header } from './Header';
import { Page } from './Page';
import { SetupBanner, SetupStatus } from './SetupStatus';
import { SyncStatus } from './SyncStatus';

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
    const neighbors = Array.from(
      { length: CALENDAR_PAGE_COUNT },
      (_, id) => id
    ).filter((id) => !mountedPages().includes(id));

    for (const id of neighbors) {
      mountQueue.enqueue(String(id), () =>
        setMountedPages((pages) => [...pages, id])
      );
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
      fullDayHeaders: { min: CALENDAR_GRID_FULL_HEADER_WIDTH },
    }
  );
  const useNarrowDayHeaders = () =>
    viewportSize.width !== null && !breakpoints.fullDayHeaders();
  let resizeFrame: number | undefined;

  createEffect(
    on(
      () => [viewportSize.width, viewportSize.height] as const,
      ([width, height]) => {
        if (width === null || height === null) return;
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
    <div class="flex min-w-0 min-h-0 flex-1 flex-col">
      <SyncStatus syncing={calendarPager.activeData()?.isSyncing() ?? false} />
      <RangeUnavailableBanner
        class={isMobile() ? 'order-last' : undefined}
        fullWidth={isMobile()}
      />
      <SetupBanner
        data={calendarPager.activeData()}
        hasOverlayEvents={calendarPager.activeTeamEvents().length > 0}
        fullWidth={isMobile()}
      />
      <div
        ref={setViewport}
        class="relative flex min-w-0 min-h-0 flex-1 overflow-hidden"
        role="region"
        aria-label={t('calendar.periods')}
      >
        <Show
          when={isMobile() && calendarPager.periodView() !== 'dayGridMonth'}
        >
          <MobileCalendarGridAxis
            root={() => calendarPager.activePage()?.element()}
            viewport={viewport}
          />
        </Show>
        <SnapPager.Viewport class="size-full min-w-0 min-h-0">
          <For each={calendarPager.pager.pages()}>
            {(page) => (
              <SnapPager.Page page={page}>
                <Show when={mountedPages().includes(page.key)}>
                  <CalendarPeriodPage
                    id={page.key}
                    useNarrowDayHeaders={useNarrowDayHeaders()}
                  />
                </Show>
              </SnapPager.Page>
            )}
          </For>
        </SnapPager.Viewport>
        <Show when={viewport()}>
          {(boundary) => (
            <SelectedCalendarEvent
              boundary={boundary()}
              anchor={calendarView.selectedEventAnchor}
              event={calendarView.selectedEvent}
              timeFormat={() => calendarView.displaySettings.timeFormat}
              onClose={calendarView.closeEventDetails}
            />
          )}
        </Show>
        <SetupStatus
          data={calendarPager.activeData()}
          hasOverlayEvents={calendarPager.activeTeamEvents().length > 0}
        />
      </div>
    </div>
  );
}

function CalendarPageContent(props: { agenda: boolean }) {
  const calendar = useCalendarView();
  return (
    <Layer offset={1}>
      <div
        ref={tourTarget(CALENDAR_TOUR.grid)}
        class="calendar-view-content flex min-w-0 min-h-0 flex-1 flex-col not-touch:m-3 not-touch:overflow-hidden not-touch:rounded-xl not-touch:bg-surface"
        classList={{
          'phone-month-content':
            isMobile() &&
            !props.agenda &&
            calendar.displaySettings.periodView === 'dayGridMonth',
        }}
      >
        <Show when={props.agenda} fallback={<CalendarPages />}>
          <div class="relative flex min-h-0 min-w-0 flex-1 flex-col">
            <AgendaContent />
            <AgendaSetup />
          </div>
        </Show>
      </div>
    </Layer>
  );
}

function WorkspaceContent(props: {
  headerLeading?: JSX.Element;
  agenda: boolean;
}) {
  const panel = useSplitPanelOrThrow();
  const composerHost = useCalendarComposerHost();
  const composerPinned = () => composerHost?.leftPanelPinned() ?? false;

  // An inline preview keeps its host's name.
  useSplitDisplayName(() => (panel.isInlinePreview ? undefined : 'Calendar'));

  return (
    <Switch>
      <Match when={panel.isInlinePreview}>
        <div class="flex size-full min-h-0 min-w-0 flex-col">
          <Header presentation="preview" leading={props.headerLeading} />
          <main class="flex min-h-0 flex-1">
            <CalendarComposerDock />
            <CalendarPageContent agenda={props.agenda} />
          </main>
        </div>
      </Match>
      <Match when={!panel.isInlinePreview}>
        <SplitPanel.Root>
          <SplitPanel.Body>
            <div class="flex size-full min-h-0 min-w-0">
              <CalendarComposerDock />
              <ViewShell.Root
                contentLayout="collection"
                asidePreferenceKey="calendar"
                resizable
                aside={
                  !isMobile() && composerPinned()
                    ? false
                    : { preserveDuringResize: false }
                }
                main={{ preferredWidth: 640 }}
                class="min-w-0 flex-1 !w-auto"
              >
                <ViewShell.Aside>
                  <CalendarSidebar />
                </ViewShell.Aside>
                <ViewShell.Main class="relative">
                  <Header presentation="workspace" />
                  <ViewTour tour={calendarTour} />
                  <ViewShell.Content class="flex min-h-0 flex-1">
                    <CalendarPageContent agenda={props.agenda} />
                  </ViewShell.Content>
                </ViewShell.Main>
              </ViewShell.Root>
            </div>
          </SplitPanel.Body>
        </SplitPanel.Root>
      </Match>
    </Switch>
  );
}

export function Workspace(props: { headerLeading?: JSX.Element }) {
  const calendarView = useCalendarView();
  const panel = useSplitPanelOrThrow();
  const stored = CalendarViewportSnapshotSchema.safeParse(
    panel.handle.currentEntryState()?.[CALENDAR_VIEWPORT_KEY]
  );
  const initial =
    !panel.isInlinePreview && stored.success ? stored.data : undefined;
  let capture = (): CalendarViewportSnapshot => ({ date: date().getTime() });
  let restoring = true;
  const viewport: CalendarViewportContext = {
    get initial() {
      return restoring ? initial : undefined;
    },
    register(read) {
      restoring = false;
      capture = read;
      return () => {
        if (capture === read) capture = () => ({ date: date().getTime() });
      };
    },
  };
  if (!panel.isInlinePreview) {
    onCleanup(
      panel.handle.registerEntryStateCaptor(CALENDAR_VIEWPORT_KEY, () =>
        capture()
      )
    );
  }
  // Transfer a snapshot only when changing hosts; the active host owns navigation.
  const [date, setDate] = createSignal(
    initial ? new Date(initial.date) : new Date()
  );
  const gridView = createMemo(() => {
    const period = calendarView.displaySettings.periodView;
    return period === 'agenda' ? undefined : period;
  });
  const openAgenda = (currentDate: Date | undefined) => {
    if (currentDate) setDate(currentDate);
    calendarView.closeEventDetails();
    calendarView.setPeriodView('agenda');
  };

  return (
    <CalendarViewportProvider value={viewport}>
      <CalendarComposerHost>
        <Show
          when={gridView()}
          fallback={
            <AgendaNavigation date={date()} onDateChange={setDate}>
              <WorkspaceContent headerLeading={props.headerLeading} agenda />
            </AgendaNavigation>
          }
        >
          {(period) => (
            <CalendarPagerContextProvider
              initialView={period()}
              initialDate={date()}
              initialScrollTop={viewport.initial?.gridScrollTop}
              showWeekends={() => calendarView.displaySettings.showWeekends}
              weekStartsOn={() => calendarView.displaySettings.weekStartsOn}
              onNavigate={calendarView.closeEventDetails}
              onViewChange={calendarView.setPeriodView}
            >
              <CalendarGridNavigation onAgendaSelect={openAgenda}>
                <WorkspaceContent
                  headerLeading={props.headerLeading}
                  agenda={false}
                />
              </CalendarGridNavigation>
            </CalendarPagerContextProvider>
          )}
        </Show>
      </CalendarComposerHost>
    </CalendarViewportProvider>
  );
}
