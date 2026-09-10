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
import { InboxHeader } from './components/InboxHeader';
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
      <SpinnerIcon
        aria-label="Loading notifications"
        class="size-5 animate-spin"
      />
    </div>
  );
}

function NotificationsListPane(props: {
  onPreviewEntityChange: (entity: EntityData | undefined) => void;
}) {
  return (
    <>
      <InboxHeader>
        <InboxTabs />
      </InboxHeader>
      <Suspense fallback={<InboxFallback />}>
        <InboxList onPreviewEntityChange={props.onPreviewEntityChange} />
      </Suspense>
    </>
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
    if (state.tab !== 'reminders') return;

    setTab('signal');
  });

  onMount(() => panel.handle.setDisplayName('Notifications'));

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
                    aside={{
                      width: 360,
                      min: 300,
                      max: 420,
                      preserveDuringResize: false,
                    }}
                    breakpoints={{ collapsed: 0 }}
                    layoutBreakpoint="collapsed"
                    main={{ min: 224, preferredWidth: 640 }}
                    resizable
                  >
                    <ViewShell.Aside class="flex flex-col border-r border-edge bg-panel">
                      <NotificationsListPane
                        onPreviewEntityChange={setPreviewEntity}
                      />
                    </ViewShell.Aside>
                    <ViewShell.Main class="overflow-hidden">
                      <Show
                        when={previewEntity()}
                        fallback={
                          <div class="flex size-full items-center justify-center px-6 text-center">
                            <div class="flex max-w-sm flex-col gap-2">
                              <h2 class="text-base font-semibold text-ink">
                                Select a notification
                              </h2>
                              <p class="text-sm leading-5 text-ink-muted">
                                Choose an item from the sidebar to preview it
                                here.
                              </p>
                            </div>
                          </div>
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
                  <NotificationsListPane
                    onPreviewEntityChange={setPreviewEntity}
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
