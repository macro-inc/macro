import {
  CALENDAR_PAGE_IDS,
  CalendarPagerContextProvider,
  useCalendarPager,
} from '@app/features/calendar/components/CalendarPagerContext';
import { useCalendarView } from '@app/features/calendar/components/CalendarViewContext';
import { RangeUnavailableBanner } from '@app/features/calendar/components/RangeUnavailableBanner';
import { calendarMacroCallUrl } from '@app/features/calendar/utils/macro-call-link';
import { SidePanel } from '@components/app/side-panel/SidePanel';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { ENABLE_CALLS } from '@core/constant/featureFlags';
import { useEmail } from '@core/context/user';
import { isMobile } from '@core/mobile/isMobile';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import { Layer } from '@ui';
import { Pager, PagerSwipeGestures } from '@ui/components/Pager';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
  Suspense,
} from 'solid-js';
import { CalendarAgenda } from '../../calendar-home/components/calendar-agenda';
import { CalendarNavigation } from '../../calendar-home/components/calendar-navigation';
import type {
  CalendarEventFilter,
  CalendarHomeTab,
} from '../../calendar-home/core/calendar-home';
import { CalendarActiveCallSidebar } from '../../meetings/calendar-calls-view';
import { CalendarCreateMenu } from '../../meetings/calendar-create-menu';
import { CalendarCalls } from '../calendar-calls';
import { matchesEventFilter } from '../calendar-event-filter';
import { useCalendarFocus } from '../calendar-focus-target';
import { useCalendarHomeNavigation } from '../use-calendar-home-navigation';
import { CalendarSidebarDetails } from './CalendarSidebarDetails';
import { Header } from './Header';
import { CalendarPageDataStatus, Page } from './Page';
import { SelectedEventDetails } from './SelectedEventDetails';
import { SetupStatus } from './SetupStatus';
import { useOpenEventComposer } from './use-open-event-composer';

const CALENDAR_SWIPE_EDGE_INSET = 40;

function CalendarPages(props: {
  eventFilter: CalendarEventFilter;
  viewerEmail?: string;
  interactive: boolean;
}) {
  const calendarPager = useCalendarPager();
  const [viewport, setViewport] = createSignal<HTMLDivElement>();
  const [useNarrowDayHeaders, setUseNarrowDayHeaders] = createSignal(false);
  let resizeFrame: number | undefined;

  createResizeObserver(viewport, ({ width }) => {
    if (width <= 0) return;
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
                      eventFilter={props.eventFilter}
                      viewerEmail={props.viewerEmail}
                      interactive={props.interactive}
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
        </div>
      </div>
    </Layer>
  );
}

function WorkspaceContent() {
  const panel = useSplitPanelOrThrow();
  const calendarView = useCalendarView();
  const calendarPager = useCalendarPager();
  const calendarFocus = useCalendarFocus();
  const email = useEmail();
  const openEventComposer = useOpenEventComposer();
  const { tab, eventFilter, navigateView } =
    useCalendarHomeNavigation(ENABLE_CALLS);
  const [list, setList] = createSignal(false);
  const [viewport, setViewport] = createSignal<HTMLElement>();
  const [wide, setWide] = createSignal(false);
  createResizeObserver(viewport, ({ width }) =>
    setWide(width >= 850 && !isMobile())
  );

  const selectTab = (next: CalendarHomeTab) => {
    calendarView.closeEventDetails();
    navigateView(next === 'calls' ? 'calls' : eventFilter());
  };
  const showEvents = () => {
    setList(false);
    calendarView.closeEventDetails();
    navigateView('all');
  };
  const changeFilter = (filter: CalendarEventFilter) => {
    calendarView.closeEventDetails();
    navigateView(filter);
  };
  const changeList = (next: boolean) => {
    calendarView.closeEventDetails();
    setList(next);
  };
  const create = () => openEventComposer();
  const scheduleCall = () => openEventComposer({ addMacroCall: true });
  // External event navigation must reveal the grid even while Calls is open.
  createEffect(
    on(
      () => calendarFocus.pendingTarget()?.requestId,
      (requestId) => {
        if (requestId !== undefined) showEvents();
      }
    )
  );
  const events = createMemo(() => {
    const data = calendarPager.activeData();
    return data?.occurrencesQuery.isSuccess &&
      !data.occurrencesQuery.isPlaceholderData
      ? [...data.visibleEvents(), ...calendarPager.activeTeamEvents()]
      : [];
  });
  const filteredEvents = createMemo(() =>
    events().filter((event) =>
      matchesEventFilter(event, eventFilter(), email())
    )
  );
  const agendaEvents = createMemo(() =>
    filteredEvents().map((event) => ({
      id: event.id,
      title: event.title,
      start: event.start,
      end: event.end,
      allDay: event.allDay,
      color: event.calendar.color,
      calendar: event.calendar.name,
      hasCall: Boolean(event.conferenceUrl || calendarMacroCallUrl(event)),
    }))
  );

  // An inline preview keeps its host's name.
  onMount(() => {
    if (!panel.isInlinePreview) panel.handle.setDisplayName('Calendar');
  });

  return (
    <>
      <Header
        calls={tab() === 'calls'}
        list={list()}
        onListChange={changeList}
      />

      <SelectedEventDetails
        anchor={calendarView.selectedEventAnchor}
        event={calendarView.selectedEvent}
        timeFormat={() => calendarView.displaySettings.timeFormat}
        onClose={calendarView.closeEventDetails}
      />

      <main ref={setViewport} class="flex size-full min-h-0">
        <Show when={wide()}>
          <aside
            class="flex w-56 shrink-0 flex-col gap-6 overflow-y-auto border-r border-edge-muted bg-panel p-3"
            aria-label="Calendar navigation"
          >
            <CalendarNavigation
              tab={tab()}
              eventFilter={eventFilter()}
              callsEnabled={ENABLE_CALLS}
              onTabChange={selectTab}
              onEventFilterChange={changeFilter}
              onCreate={create}
              createMenu={
                ENABLE_CALLS ? (
                  <CalendarCreateMenu
                    onEvent={create}
                    onScheduledCall={scheduleCall}
                  />
                ) : undefined
              }
            />
            <Show when={ENABLE_CALLS}>
              <Suspense>
                <CalendarActiveCallSidebar
                  onShowCalls={() => selectTab('calls')}
                />
              </Suspense>
            </Show>
            <Suspense>
              <CalendarSidebarDetails calls={tab() === 'calls'} />
            </Suspense>
          </aside>
        </Show>
        <div class="flex min-w-0 min-h-0 flex-1 flex-col">
          <Show when={!wide()}>
            <div class="border-b border-edge-muted p-2">
              <CalendarNavigation
                compact
                tab={tab()}
                eventFilter={eventFilter()}
                callsEnabled={ENABLE_CALLS}
                onTabChange={selectTab}
                onEventFilterChange={changeFilter}
                onCreate={create}
                createMenu={
                  ENABLE_CALLS ? (
                    <CalendarCreateMenu
                      onEvent={create}
                      onScheduledCall={scheduleCall}
                    />
                  ) : undefined
                }
              />
              <Show when={tab() === 'events'}>
                <details class="mt-1 rounded-lg text-xs text-ink-muted">
                  <summary class="px-3 py-2">
                    {ENABLE_CALLS
                      ? 'Calls, calendars and availability'
                      : 'Calendars and availability'}
                  </summary>
                  <div class="flex max-h-72 flex-col gap-6 overflow-y-auto p-3">
                    <Show when={ENABLE_CALLS}>
                      <Suspense>
                        <CalendarActiveCallSidebar
                          onShowCalls={() => selectTab('calls')}
                        />
                      </Suspense>
                    </Show>
                    <Suspense>
                      <CalendarSidebarDetails />
                    </Suspense>
                  </div>
                </details>
              </Show>
            </div>
          </Show>
          <div
            class="flex min-h-0 flex-1 flex-col"
            classList={{ hidden: tab() !== 'events' }}
            inert={tab() !== 'events'}
          >
            <div class="calendar-view-content relative flex min-w-0 min-h-0 flex-1 flex-col">
              <RangeUnavailableBanner fullWidth={isMobile()} />
              <div
                class="flex size-full min-h-0 flex-col"
                classList={{
                  'invisible pointer-events-none absolute inset-0': list(),
                }}
                inert={list()}
              >
                <CalendarPages
                  eventFilter={eventFilter()}
                  viewerEmail={email()}
                  interactive={tab() === 'events' && !list()}
                />
              </div>
              <Show when={list()}>
                <CalendarAgenda
                  events={agendaEvents()}
                  rangeStart={calendarPager.activeDateInfo()?.start}
                  use24HourTime={
                    calendarView.displaySettings.timeFormat === '24-hour'
                  }
                  loading={calendarPager.activeData()?.isLoading() ?? true}
                  onSelect={(id, anchor) => {
                    const event = filteredEvents().find(
                      (event) => event.id === id
                    );
                    if (event) calendarView.selectEvent(event, anchor);
                  }}
                />
                <Show when={calendarPager.activeData()}>
                  {(data) => <CalendarPageDataStatus data={data()} />}
                </Show>
              </Show>
              <SetupStatus />
            </div>
          </div>
          <Show when={ENABLE_CALLS && tab() === 'calls'}>
            <Suspense
              fallback={
                <p class="p-6 text-sm text-ink-muted">Loading calls…</p>
              }
            >
              <CalendarCalls
                onShowEvents={showEvents}
                onScheduleCall={scheduleCall}
              />
            </Suspense>
          </Show>
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
