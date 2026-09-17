import { ViewShell } from '@app/components/view-shell';
import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import { PreviewPanel } from '@components/app/PreviewPanel';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { type EntityData, ListEntityMetadataQueryProvider } from '@entity';
import SpinnerIcon from '@phosphor/spinner.svg';
import { createEffect, createSignal, onMount, Show, Suspense } from 'solid-js';
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
  previewEntity: EntityData | undefined;
  onPreviewEntityChange: (entity: EntityData | undefined) => void;
  onNewChat: () => void;
}) {
  return (
    <InboxListLayout tabs={<InboxTabs />} onNewChat={props.onNewChat}>
      <Suspense fallback={<InboxFallback />}>
        <InboxList
          previewEntity={props.previewEntity}
          onPreviewEntityChange={props.onPreviewEntityChange}
        />
      </Suspense>
    </InboxListLayout>
  );
}

function InboxViewRoot() {
  const panel = useSplitPanelOrThrow();
  const orchestrator = useGlobalBlockOrchestrator();
  const { state, setTab } = useInboxView();
  const [previewEntity, setPreviewEntity] = createSignal<EntityData>();

  let activeTab = state.tab;
  createEffect(() => {
    const nextTab = state.tab;
    if (nextTab === activeTab) return;
    activeTab = nextTab;
    setPreviewEntity(undefined);
  });

  createEffect(() => {
    if (state.tab === 'reminders') setTab('signal');
  });
  const newChat = () => setPreviewEntity(undefined);

  onMount(() => panel.handle.setDisplayName('Home'));

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
                    aside={{
                      min: 224,
                      max: 420,
                      preserveDuringResize: false,
                    }}
                    breakpoints={{ collapsed: 0 }}
                    layoutBreakpoint="collapsed"
                    main={{ min: 224, preferredWidth: 640 }}
                    resizable
                  >
                    <ViewShell.Aside class="flex flex-col bg-panel">
                      <HomeListPane
                        previewEntity={previewEntity()}
                        onPreviewEntityChange={setPreviewEntity}
                        onNewChat={newChat}
                      />
                    </ViewShell.Aside>
                    <ViewShell.Main class="overflow-hidden">
                      <Show
                        when={previewEntity()}
                        fallback={
                          <Suspense fallback={<InboxFallback />}>
                            <HomeChatStart />
                          </Suspense>
                        }
                      >
                        {(entity) => (
                          <Suspense>
                            <PreviewPanel
                              selectedEntity={entity()}
                              orchestrator={orchestrator}
                              splitPanelContext={panel}
                            />
                          </Suspense>
                        )}
                      </Show>
                    </ViewShell.Main>
                  </ViewShell.Root>
                </div>
              }
            >
              <ViewShell.Root aside={false} main={{ min: 224 }}>
                <ViewShell.Main>
                  <HomeListPane
                    previewEntity={previewEntity()}
                    onPreviewEntityChange={setPreviewEntity}
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

/** Composable heterogeneous Inbox built on the shared view and Soup primitives. */
export function InboxView(props: InboxViewProps) {
  return (
    <InboxViewProvider initialState={props.initialState}>
      <InboxViewRoot />
    </InboxViewProvider>
  );
}
