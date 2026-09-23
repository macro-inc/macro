import {
  useViewShell,
  ViewBreadcrumbs,
  ViewShell,
} from '@app/components/view-shell';
import { SplitRouter } from '@app/lib/split-router';
import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import {
  PreviewPanel,
  type PreviewPanelSelection,
} from '@components/app/PreviewPanel';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { ListEntityMetadataQueryProvider } from '@entity';
import SpinnerIcon from '@phosphor/spinner.svg';
import { createEffect, onMount, Show, Suspense } from 'solid-js';
import { HomeChatStart } from './components/HomeChatStart';
import { InboxListLayout } from './components/InboxHeader';
import { InboxList } from './components/InboxList';
import { InboxTabs } from './components/InboxTabs';
import { InboxViewProvider, useInboxView } from './inbox-view-context';
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
  previewEntity: PreviewPanelSelection | undefined;
  onPreviewEntityChange: (entity: PreviewPanelSelection | undefined) => void;
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
          previewEntity={props.previewEntity}
          onPreviewEntityChange={props.onPreviewEntityChange}
          onPreviewActivate={showContent}
        />
      </Suspense>
    </InboxListLayout>
  );
}

function HomeReturnBreadcrumb(props: { onReturn: () => void }) {
  return (
    <nav aria-label="Home location" class="flex items-center gap-0.5">
      <ViewBreadcrumbs.ReturnButton
        data-allow-focus-in-preview
        onClick={props.onReturn}
      >
        Home
      </ViewBreadcrumbs.ReturnButton>
      <ViewBreadcrumbs.Separator />
    </nav>
  );
}

function InboxViewRoot() {
  const panel = useSplitPanelOrThrow();
  const { state, setTab, previewEntity, openPreview, closePreview } =
    useInboxView();

  createEffect(() => {
    if (state.tab !== 'reminders') return;
    setTab('signal');
  });
  const newChat = closePreview;

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
                        previewEntity={previewEntity()}
                        onPreviewEntityChange={(entity) =>
                          entity ? openPreview(entity) : closePreview()
                        }
                        onNewChat={newChat}
                      />
                    </ViewShell.Aside>
                    <ViewShell.Main class="overflow-hidden">
                      <SplitRouter.Outlet
                        fallback={() => (
                          <Suspense fallback={<InboxFallback />}>
                            <HomeChatStart />
                          </Suspense>
                        )}
                      />
                    </ViewShell.Main>
                  </ViewShell.Root>
                </div>
              }
            >
              <ViewShell.Root aside={false} main={{ min: 224 }}>
                <ViewShell.Main>
                  <HomeListPane
                    previewEntity={previewEntity()}
                    onPreviewEntityChange={(entity) =>
                      entity ? openPreview(entity) : closePreview()
                    }
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

export function InboxDetailRouteView() {
  const panel = useSplitPanelOrThrow();
  const orchestrator = useGlobalBlockOrchestrator();
  const { previewEntity, closePreview } = useInboxView();

  return (
    <Suspense>
      <PreviewPanel
        selectedEntity={previewEntity()}
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
