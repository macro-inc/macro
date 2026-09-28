import { useViewShell, ViewShell } from '@app/components/view-shell';
import { calendarSearch } from '@app/features/calendar-view/calendar-url';
import { CalendarView } from '@app/features/calendar-view/calendar-view';
import { createSearchParams, SplitRouter } from '@app/lib/split-router';
import { DebugSuspense } from '@channel/DebugSuspense';
import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import { PreviewFrame, PreviewPanel } from '@components/app/PreviewPanel';
import type { PreviewSelection } from '@components/app/previewTarget';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { ListEntityMetadataQueryProvider } from '@entity';
import SpinnerIcon from '@phosphor/spinner.svg';
import { createEffect, onMount, Show } from 'solid-js';
import { HomeChatStart } from './components/HomeChatStart';
import { HomeList } from './components/HomeList';
import { HomeListLayout } from './components/HomeListLayout';
import { HomeReturnBreadcrumb } from './components/HomeReturnBreadcrumb';
import { HomeTabs } from './components/HomeTabs';
import { HomeViewProvider, useHomeView } from './home-view-context';
import { homeCalendarRoute } from './route';
import type { HomeViewStateOptions } from './types';

export type HomeViewProps = {
  /** Explicit navigation state. When present, it wins over entry restoration. */
  initialState?: HomeViewStateOptions;
};

function HomeFallback() {
  return (
    <div class="grid min-h-0 min-w-0 flex-1 place-items-center text-ink-muted">
      <SpinnerIcon aria-label="Loading Home" class="size-5 animate-spin" />
    </div>
  );
}

function HomeListPane(props: {
  hasPreview: boolean;
  onPreviewEntityChange: (entity: PreviewSelection | undefined) => void;
  onNewChat: () => void;
}) {
  const shell = useViewShell();
  const showContent = () => {
    if (shell.aside.isOverlay()) shell.aside.collapse();
  };

  return (
    <HomeListLayout
      tabs={
        <DebugSuspense name="HomeView.tabs">
          <HomeTabs />
        </DebugSuspense>
      }
      onNewChat={() => {
        props.onNewChat();
        showContent();
      }}
    >
      <DebugSuspense name="HomeView.list" fallback={<HomeFallback />}>
        <HomeList
          hasPreview={props.hasPreview}
          onPreviewEntityChange={props.onPreviewEntityChange}
          onPreviewActivate={showContent}
        />
      </DebugSuspense>
    </HomeListLayout>
  );
}

function HomeViewRoot() {
  const panel = useSplitPanelOrThrow();
  const {
    state,
    setTab,
    previewTarget,
    calendarOpen,
    openPreview,
    closePreview,
  } = useHomeView();

  createEffect(() => {
    if (state.tab !== 'reminders') return;
    setTab('signal');
  });
  const newChat = closePreview;
  const onPreviewEntityChange = (entity: PreviewSelection | undefined) => {
    if (entity) openPreview(entity);
    else closePreview();
  };

  // The touch nav item and legacy touch view both call this "Notifications".
  onMount(() =>
    panel.handle.setDisplayName(isTouchDevice() ? 'Notifications' : 'Home')
  );

  return (
    <ListEntityMetadataQueryProvider>
      <StaticMarkdownContext>
        <SplitPanel.Root>
          <SplitPanel.Body>
            <Show
              when={isTouchDevice()}
              fallback={
                <div class="size-full min-h-0 bg-panel">
                  <ViewShell.Root
                    asidePreferenceKey="home"
                    aside={{ preserveDuringResize: false }}
                    main={{ preferredWidth: 640 }}
                    resizable
                  >
                    <ViewShell.Aside class="flex flex-col bg-panel">
                      <DebugSuspense name="HomeView.list-pane">
                        <HomeListPane
                          hasPreview={
                            previewTarget() !== undefined || calendarOpen()
                          }
                          onPreviewEntityChange={onPreviewEntityChange}
                          onNewChat={newChat}
                        />
                      </DebugSuspense>
                    </ViewShell.Aside>
                    <ViewShell.Main class="overflow-hidden">
                      {/* Detail routes load lazily. Suspend only this area, so
                          the list stays mounted and a pending detail's effects
                          wait until it resolves. */}
                      <DebugSuspense
                        name="HomeView.outlet"
                        fallback={<HomeFallback />}
                      >
                        <SplitRouter.Outlet
                          fallback={() => <HomeChatStart />}
                        />
                      </DebugSuspense>
                    </ViewShell.Main>
                  </ViewShell.Root>
                </div>
              }
            >
              <ViewShell.Root aside={false} main={{ min: 224 }}>
                <ViewShell.Main>
                  <DebugSuspense name="HomeView.list-pane">
                    <HomeListPane
                      hasPreview={
                        previewTarget() !== undefined || calendarOpen()
                      }
                      onPreviewEntityChange={onPreviewEntityChange}
                      onNewChat={newChat}
                    />
                  </DebugSuspense>
                </ViewShell.Main>
              </ViewShell.Root>
            </Show>
          </SplitPanel.Body>
        </SplitPanel.Root>
      </StaticMarkdownContext>
    </ListEntityMetadataQueryProvider>
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
        locationKey={() => `${search.eventId}:${search.occurrenceKey}`}
      >
        <CalendarView route={homeCalendarRoute} refocus={calendarRefocus} />
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
      <PreviewPanel
        target={previewTarget()}
        navigationRequest={previewNavigationRequest()}
        orchestrator={orchestrator}
        splitPanelContext={panel}
        headerLeading={<HomeReturnBreadcrumb onReturn={closePreview} />}
      />
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
      <HomeViewProvider initialState={props.initialState}>
        <HomeViewRoot />
      </HomeViewProvider>
    </DebugSuspense>
  );
}
