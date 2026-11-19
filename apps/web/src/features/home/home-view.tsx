import { useViewShell } from '@app/components/view-shell';
import { SidebarCreateHeader } from '@app/components/view-shell/SidebarCreateButton';
import { useInlinePreviewLayout } from '@app/components/view-shell/use-inline-preview-layout';
import { calendarSearch } from '@app/features/calendar-view/calendar-url';
import { ViewTour } from '@app/features/tours/ViewTour';
import { createSearchParams, SplitRouter } from '@app/lib/split-router';
import { TraceFlow } from '@app/observability/flow';
import { homeCalendarRoute } from '@app/routes/routes';
import { DebugSuspense } from '@channel/DebugSuspense';
import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import { PreviewFrame, PreviewPanel } from '@components/app/PreviewPanel';
import type { PreviewSelection } from '@components/app/previewTarget';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { lazyNamed } from '@core/util/lazyNamed';
import { ListEntityMetadataQueryProvider } from '@entity';
import { createEffect, Show } from 'solid-js';
import { HomeChatStart } from './components/HomeChatStart';
import { HomeList } from './components/HomeList';
import { type HomeFrame, HomeListLayout } from './components/HomeListLayout';
import { HomeListSkeleton } from './components/HomeListSkeleton';
import { HomeReturnBreadcrumb } from './components/HomeReturnBreadcrumb';
import { HomeSetupPromotion } from './components/HomeSetupPromotion';
import { HomeTabs } from './components/HomeTabs';
import { HomeViewLayout } from './components/HomeViewLayout';
import { HomeViewProvider, useHomeView } from './home-view-context';
import { homeTour } from './tour';
import type { HomeTab, HomeViewStateOptions } from './types';

const HomeProjectPreview = lazyNamed(
  () => import('./components/HomeProjectPreview'),
  'HomeProjectPreview'
);

// The calendar grid (FullCalendar) only loads once Home's calendar route opens.
const CalendarView = lazyNamed(
  () => import('@app/features/calendar-view/calendar-view'),
  'CalendarView'
);

export type HomeViewProps = {
  /** Explicit navigation state. When present, it wins over entry restoration. */
  initialState?: HomeViewStateOptions;
  /** The one tab this Home lists: New Home's Recent. */
  tab?: HomeTab;
  /** New Home's title and tabs around the list. */
  frame?: HomeFrame;
};

function HomeFallback() {
  const { state } = useHomeView();
  return (
    <div class="mt-3 min-h-0 min-w-0 flex-1 overflow-hidden touch:mt-0 touch:pt-(--mobile-content-inset-top)">
      <HomeListSkeleton
        grouped={state.groupBy === 'date' && !state.search.trim()}
      />
    </div>
  );
}

function HomeListPane(props: {
  frame?: HomeFrame;
  hasPreview: boolean;
  onPreviewEntityChange: (
    entity: PreviewSelection | undefined,
    options?: { activate?: boolean }
  ) => void;
  onNewChat: () => void;
}) {
  const shell = useViewShell();
  const showContent = () => {
    if (shell.aside.isOverlay()) shell.aside.collapse();
  };

  return (
    <HomeListLayout
      frame={props.frame}
      tabs={
        <DebugSuspense name="HomeView.tabs">
          <HomeTabs />
        </DebugSuspense>
      }
      onNewChat={() => {
        props.onNewChat();
        showContent();
      }}
      footer={<HomeSetupPromotion class="px-(--sidebar-gutter) py-2" />}
    >
      <ViewTour tour={homeTour} />
      <DebugSuspense name="HomeView.list" fallback={<HomeFallback />}>
        <TraceFlow name="home.list">
          <HomeList
            hasPreview={props.hasPreview}
            onPreviewEntityChange={props.onPreviewEntityChange}
            onPreviewActivate={showContent}
          />
        </TraceFlow>
      </DebugSuspense>
    </HomeListLayout>
  );
}

function HomeViewRoot(props: { frame?: HomeFrame }) {
  const inlinePreviewLayout = useInlinePreviewLayout();
  const panel = useSplitPanelOrThrow();
  const {
    previewTarget,
    calendarOpen,
    openPreview,
    closePreview,
    openStartedSession,
  } = useHomeView();
  const title = () => props.frame?.title() ?? 'Home';

  const newChat = closePreview;
  const onPreviewEntityChange = (
    entity: PreviewSelection | undefined,
    options?: { activate?: boolean }
  ) => {
    if (entity) openPreview(entity, options);
    else closePreview();
  };

  // The touch nav item calls this "Notifications".
  createEffect(() =>
    panel.handle.setDisplayName(isTouchDevice() ? 'Notifications' : title())
  );

  return (
    <ListEntityMetadataQueryProvider>
      <StaticMarkdownContext>
        <SplitPanel.Root>
          <SplitPanel.Body>
            <HomeViewLayout
              inlinePreview={inlinePreviewLayout()}
              listLayout={props.frame?.list}
              list={
                <DebugSuspense name="HomeView.list-pane">
                  <HomeListPane
                    frame={props.frame}
                    hasPreview={previewTarget() !== undefined || calendarOpen()}
                    onPreviewEntityChange={onPreviewEntityChange}
                    onNewChat={newChat}
                  />
                </DebugSuspense>
              }
            >
              <DebugSuspense name="HomeView.outlet" fallback={<HomeFallback />}>
                <SplitRouter.Outlet
                  fallback={() => (
                    <Show
                      when={isTouchDevice()}
                      fallback={
                        <HomeChatStart
                          title={title()}
                          onStartedSession={openStartedSession}
                        />
                      }
                    >
                      <div class="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-ink-muted">
                        Select a notification to open it here.
                      </div>
                    </Show>
                  )}
                />
              </DebugSuspense>
            </HomeViewLayout>
          </SplitPanel.Body>
        </SplitPanel.Root>
      </StaticMarkdownContext>
    </ListEntityMetadataQueryProvider>
  );
}

/**
 * Home's frame while sign-in is confirmed: the view's layout, header, and list
 * skeleton. Home's persisted state and list query key on the user, so the view
 * itself waits for identity; the frame keeps the screen from going blank.
 */
export function HomePendingView() {
  const inlinePreviewLayout = useInlinePreviewLayout();
  const listSkeleton = (
    <div class="flex size-full min-h-0 flex-col">
      <Show when={!isTouchDevice()}>
        <SidebarCreateHeader
          title="Home"
          label="New chat"
          onCreate={() => {}}
        />
      </Show>
      <div class="mt-3 min-h-0 min-w-0 flex-1 overflow-hidden touch:mt-0 touch:pt-(--mobile-content-inset-top)">
        <HomeListSkeleton grouped />
      </div>
    </div>
  );
  return (
    <SplitPanel.Root>
      <SplitPanel.Body>
        <HomeViewLayout
          inlinePreview={inlinePreviewLayout()}
          list={listSkeleton}
        >
          <div class="size-full" />
        </HomeViewLayout>
      </SplitPanel.Body>
    </SplitPanel.Root>
  );
}

/** The Calendar view aimed at an event, inside Home's inline preview chrome. */
function HomeCalendarRouteContent() {
  const panel = useSplitPanelOrThrow();
  const { closePreview, calendarRefocus } = useHomeView();
  const [search] = createSearchParams(calendarSearch);

  return (
    <div class="flex size-full min-h-0">
      <PreviewFrame
        splitPanelContext={panel}
        headerLeading={<HomeReturnBreadcrumb onReturn={closePreview} />}
        hideHeader={!isTouchDevice()}
        locationKey={() => `${search.eventId}:${search.occurrenceKey}`}
      >
        <CalendarView
          route={homeCalendarRoute}
          refocus={calendarRefocus}
          headerLeading={
            <Show when={!isTouchDevice()}>
              <HomeReturnBreadcrumb onReturn={closePreview} />
            </Show>
          }
        />
      </PreviewFrame>
    </div>
  );
}

export function HomeCalendarRouteView() {
  return (
    <DebugSuspense name="HomeView.calendar-route">
      <HomeCalendarRouteContent />
    </DebugSuspense>
  );
}

function HomeDetailRouteContent() {
  const panel = useSplitPanelOrThrow();
  const orchestrator = useGlobalBlockOrchestrator();
  const { previewTarget, previewNavigationRequest, closePreview } =
    useHomeView();

  return (
    <DebugSuspense name="HomeView.detail-content">
      <Show
        when={previewTarget()?.blockType === 'initiative'}
        fallback={
          <PreviewPanel
            target={previewTarget()}
            navigationRequest={previewNavigationRequest()}
            orchestrator={orchestrator}
            splitPanelContext={panel}
            headerLeading={<HomeReturnBreadcrumb onReturn={closePreview} />}
          />
        }
      >
        <HomeProjectPreview />
      </Show>
    </DebugSuspense>
  );
}

export function HomeDetailRouteView() {
  return (
    <DebugSuspense name="HomeView.detail-route">
      <HomeDetailRouteContent />
    </DebugSuspense>
  );
}

/** Composable heterogeneous Home built on the shared view and Soup primitives. */
export function HomeView(props: HomeViewProps) {
  return (
    <DebugSuspense name="HomeView.root">
      <HomeViewProvider initialState={props.initialState} tab={props.tab}>
        <HomeViewRoot frame={props.frame} />
      </HomeViewProvider>
    </DebugSuspense>
  );
}
