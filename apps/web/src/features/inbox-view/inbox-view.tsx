import { ViewShell } from '@app/components/view-shell';
import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import { PreviewPanel } from '@components/app/PreviewPanel';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import EmptyStatePreviewIcon from '@design/empty-state-doc.svg';
import type { EntityData, WithNotification } from '@entity';
import { ListEntityMetadataQueryProvider } from '@entity';
import SpinnerIcon from '@phosphor/spinner.svg';
import { EmptyStatePanel } from '@ui';
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
      <SpinnerIcon aria-label="Loading inbox" class="size-5 animate-spin" />
    </div>
  );
}

function InboxViewRoot() {
  const panel = useSplitPanelOrThrow();
  const orchestrator = useGlobalBlockOrchestrator();
  const [selectedEntity, setSelectedEntity] =
    createSignal<WithNotification<EntityData>>();
  const { state, setTab } = useInboxView();

  createEffect(() => {
    if (state.tab !== 'reminders') return;

    setTab('signal');
  });

  onMount(() => {
    panel.handle.setDisplayName('Inbox');
    if (!isTouchDevice() && panel.handle.isControllerSplit()) {
      panel.handle.disengagePreview();
    }
  });

  return (
    <ListEntityMetadataQueryProvider>
      <StaticMarkdownContext>
        <SplitPanel.Root>
          <SplitPanel.Body>
            <Show
              when={!isTouchDevice()}
              fallback={
                <ViewShell.Root aside={false} main={{ min: 224 }}>
                  <ViewShell.Main>
                    <InboxHeader>
                      <InboxTabs />
                    </InboxHeader>
                    <Suspense fallback={<InboxFallback />}>
                      <InboxList />
                    </Suspense>
                  </ViewShell.Main>
                </ViewShell.Root>
              }
            >
              <div class="relative size-full min-h-0">
                <ViewShell.Root
                  aside={{ width: 384, min: 288, max: 480 }}
                  breakpoints={{ collapsed: 0 }}
                  layoutBreakpoint="collapsed"
                  main={{ min: 224 }}
                  resizable
                >
                  <ViewShell.Aside>
                    <aside
                      aria-label="Inbox navigation"
                      class="flex size-full min-h-0 flex-col border-r border-edge-muted bg-sidebar"
                    >
                      <InboxHeader>
                        <InboxTabs />
                      </InboxHeader>
                      <Suspense fallback={<InboxFallback />}>
                        <InboxList onPreview={setSelectedEntity} />
                      </Suspense>
                    </aside>
                  </ViewShell.Aside>
                  <ViewShell.Main class="overflow-hidden">
                    <Show
                      when={selectedEntity()}
                      fallback={
                        <div class="flex size-full min-h-0 flex-col">
                          <div class="h-12 shrink-0 border-b border-edge-muted" />
                          <div class="min-h-0 flex-1">
                            <EmptyStatePanel
                              graphic={EmptyStatePreviewIcon}
                              title="No content selected"
                              description="Select an item from the inbox to preview it here"
                              centered
                            />
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
                            headerClass="h-12 min-h-12 border-b border-edge-muted"
                          />
                        </Suspense>
                      )}
                    </Show>
                  </ViewShell.Main>
                </ViewShell.Root>
                <div
                  aria-hidden="true"
                  class="pointer-events-none absolute inset-x-0 top-0 z-10 h-12 border-b border-edge-muted"
                />
              </div>
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
