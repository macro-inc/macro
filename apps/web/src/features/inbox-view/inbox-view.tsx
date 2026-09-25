import { useViewShell, ViewShell } from '@app/components/view-shell';
import { calendarSearch } from '@app/features/calendar-view/calendar-url';
import { CalendarView } from '@app/features/calendar-view/calendar-view';
import { createSearchParams, SplitRouter } from '@app/lib/split-router';
import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import { PreviewFrame, PreviewPanel } from '@components/app/PreviewPanel';
import type { PreviewSelection } from '@components/app/previewTarget';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { ListEntityMetadataQueryProvider } from '@entity';
import SpinnerIcon from '@phosphor/spinner.svg';
import { createEffect, onMount, Show, Suspense } from 'solid-js';
import { HomeChatStart } from './components/HomeChatStart';
import { HomeReturnBreadcrumb } from './components/HomeReturnBreadcrumb';
import { InboxListLayout } from './components/InboxHeader';
import { InboxList } from './components/InboxList';
import { InboxTabs } from './components/InboxTabs';
import { InboxViewProvider, useInboxView } from './inbox-view-context';
import { inboxCalendarRoute } from './route';
import type { InboxViewStateOptions } from './types';

export type InboxViewProps = {
  /** Explicit navigation state. When present, it wins over entry restoration. */
  initialState?: InboxViewStateOptions;
};

function InboxFallback() {
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
    <InboxListLayout
      tabs={<InboxTabs />}
      onNewChat={() => {
        props.onNewChat();
        showContent();
      }}
    >
      <Suspense fallback={<InboxFallback />}>
        <InboxList
          hasPreview={props.hasPreview}
          onPreviewEntityChange={props.onPreviewEntityChange}
          onPreviewActivate={showContent}
        />
      </Suspense>
    </InboxListLayout>
  );
}

function InboxViewRoot() {
  const panel = useSplitPanelOrThrow();
  const {
    state,
    setTab,
    previewTarget,
    calendarOpen,
    openPreview,
    closePreview,
  } = useInboxView();

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
                    asidePreferenceKey="inbox"
                    aside={{ preserveDuringResize: false }}
                    main={{ preferredWidth: 640 }}
                    resizable
                  >
                    <ViewShell.Aside class="flex flex-col bg-panel">
                      <HomeListPane
                        hasPreview={
                          previewTarget() !== undefined || calendarOpen()
                        }
                        onPreviewEntityChange={onPreviewEntityChange}
                        onNewChat={newChat}
                      />
                    </ViewShell.Aside>
                    <ViewShell.Main class="overflow-hidden">
                      {/* Detail routes load lazily. Suspend only this area, so
                          the list stays mounted and a pending detail's effects
                          wait until it resolves. */}
                      <Suspense fallback={<InboxFallback />}>
                        <SplitRouter.Outlet
                          fallback={() => <HomeChatStart />}
                        />
                      </Suspense>
                    </ViewShell.Main>
                  </ViewShell.Root>
                </div>
              }
            >
              <ViewShell.Root aside={false} main={{ min: 224 }}>
                <ViewShell.Main>
                  <HomeListPane
                    hasPreview={previewTarget() !== undefined || calendarOpen()}
                    onPreviewEntityChange={onPreviewEntityChange}
                    onNewChat={newChat}
                  />
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
export function InboxCalendarRouteView() {
  const panel = useSplitPanelOrThrow();
  const { closePreview, calendarRefocus } = useInboxView();
  const [search] = createSearchParams(calendarSearch);

  return (
    <div class="flex size-full min-h-0">
      <PreviewFrame
        splitPanelContext={panel}
        headerLeading={<HomeReturnBreadcrumb onReturn={closePreview} />}
        locationKey={() => `${search.eventId}:${search.occurrenceKey}`}
      >
        <CalendarView route={inboxCalendarRoute} refocus={calendarRefocus} />
      </PreviewFrame>
    </div>
  );
}

export function InboxDetailRouteView() {
  const panel = useSplitPanelOrThrow();
  const orchestrator = useGlobalBlockOrchestrator();
  const { previewTarget, previewNavigationRequest, closePreview } =
    useInboxView();

  return (
    <Suspense>
      <PreviewPanel
        target={previewTarget()}
        navigationRequest={previewNavigationRequest()}
        orchestrator={orchestrator}
        splitPanelContext={panel}
        headerLeading={<HomeReturnBreadcrumb onReturn={closePreview} />}
      />
    </Suspense>
  );
}

/** Composable heterogeneous Inbox built on the shared view and Soup primitives. */
export function InboxView(props: InboxViewProps) {
  return (
    <InboxViewProvider initialState={props.initialState}>
      <InboxViewRoot />
    </InboxViewProvider>
  );
}
