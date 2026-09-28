import { ViewShell } from '@app/components/view-shell';
import {
  CALENDAR_PAGE_IDS,
  CalendarPagerContextProvider,
  useCalendarPager,
} from '@app/features/calendar/components/CalendarPagerContext';
import { useCalendarView } from '@app/features/calendar/components/CalendarViewContext';
import { RangeUnavailableBanner } from '@app/features/calendar/components/RangeUnavailableBanner';
import { createSizeBreakpoints } from '@app/util/create-size-breakpoints';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { isMobile } from '@core/mobile/isMobile';
import { createElementSize } from '@solid-primitives/resize-observer';
import { Layer } from '@ui';
import { Pager, PagerSwipeGestures } from '@ui/components/Pager';
import {
  createEffect,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import { CalendarSidebar } from './CalendarSidebar';
import { Header } from './Header';
import { Page } from './Page';
import { SelectedEventDetails } from './SelectedEventDetails';
import { SetupStatus } from './SetupStatus';

const CALENDAR_SWIPE_EDGE_INSET = 40;

function CalendarPages() {
  const calendarPager = useCalendarPager();
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

function CalendarPageContent() {
  return (
    <div class="calendar-view-content flex min-w-0 min-h-0 flex-1 flex-col">
      <CalendarPages />
    </div>
  );
}

function WorkspaceContent() {
  const panel = useSplitPanelOrThrow();
  const calendarView = useCalendarView();

  // An inline preview keeps its host's name.
  onMount(() => {
    if (!panel.isInlinePreview) panel.handle.setDisplayName('Calendar');
  });

  const eventDetails = () => (
    <SelectedEventDetails
      anchor={calendarView.selectedEventAnchor}
      event={calendarView.selectedEvent}
      timeFormat={() => calendarView.displaySettings.timeFormat}
      onClose={calendarView.closeEventDetails}
    />
  );

  return (
    <Switch>
      <Match when={panel.isInlinePreview}>
        <Header presentation="preview" />
        {eventDetails()}
        <main class="flex size-full min-h-0">
          <CalendarPageContent />
        </main>
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
                <ViewShell.Content class="flex min-h-0 flex-1">
                  <CalendarPageContent />
                </ViewShell.Content>
              </ViewShell.Main>
            </ViewShell.Root>
            {eventDetails()}
          </SplitPanel.Body>
        </SplitPanel.Root>
      </Match>
    </Switch>
  );
}

function CalendarPagerWorkspace() {
  const calendarPager = useCalendarPager();

  return (
    <Pager.Root controller={calendarPager.pager}>
      <WorkspaceContent />
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
