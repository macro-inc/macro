import { ViewShell } from '@app/components/view-shell';
import { MaybeSoupEntityActionDrawerManager } from '@app/features/soup';
import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import { PreviewPanel } from '@components/app/PreviewPanel';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { ListEntityMetadataQueryProvider } from '@entity';
import SpinnerIcon from '@phosphor/spinner.svg';
import { createMemo, createSignal, onMount, Show, Suspense } from 'solid-js';
import { ChannelsViewProvider, useChannelsView } from './channels-view-context';
import { ChannelsMobileView } from './components/ChannelsMobileView';
import { ChannelsRail } from './components/rail/ChannelsRail';
import {
  deduplicateChannels,
  resolveSelectedChannel,
  useChannelByIdQuery,
  useChannelsSources,
} from './queries';
import type { ChannelsViewStateOptions } from './types';

export type ChannelsViewProps = {
  /** Explicit navigation state. When present, it wins over entry restoration. */
  initialState?: ChannelsViewStateOptions;
};

function ChannelsViewRoot() {
  const panel = useSplitPanelOrThrow();
  const orchestrator = useGlobalBlockOrchestrator();
  const { state, setAsideWidth, setMobileTab } = useChannelsView();
  const [railSearchOpen, setRailSearchOpen] = createSignal(false);

  const sources = useChannelsSources(
    (scope) => {
      if (isTouchDevice())
        return scope !== 'search' && state.mobileTab === scope;
      if (railSearchOpen()) return scope === 'search';
      if (scope === 'search') return false;
      if (scope === 'recents') return state.tab === 'recents';
      return state.tab === 'browse';
    },
    (group) => state.sortBy[group]
  );
  const loadedChannels = createMemo(() =>
    deduplicateChannels([
      sources.channels.items(),
      sources.direct_messages.items(),
      sources.recents.items(),
      sources.search.items(),
    ])
  );
  const loadedSelectedChannel = createMemo(() =>
    resolveSelectedChannel(state.selectedChannelId, loadedChannels())
  );
  const selectedChannelQuery = useChannelByIdQuery(
    () => state.selectedChannelId,
    () =>
      !isTouchDevice() &&
      state.selectedChannelId !== undefined &&
      loadedSelectedChannel() === undefined
  );
  const selectedChannel = createMemo(() => {
    const loaded = loadedSelectedChannel();
    if (loaded) return loaded;
    if (!selectedChannelQuery.isEnabled || selectedChannelQuery.isLoading) {
      return;
    }

    return resolveSelectedChannel(
      state.selectedChannelId,
      loadedChannels(),
      selectedChannelQuery.data?.entities
    );
  });

  onMount(() => panel.handle.setDisplayName('Channels'));

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
                    asidePreferenceKey="channels"
                    aside={{
                      width: state.asideWidth,
                      preserveDuringResize: false,
                    }}
                    main={{ preferredWidth: 640 }}
                    resizable
                  >
                    <ViewShell.Aside onWidthChangeEnd={setAsideWidth}>
                      <ChannelsRail
                        sources={sources}
                        searchOpen={railSearchOpen()}
                        onSearchOpenChange={setRailSearchOpen}
                      />
                    </ViewShell.Aside>
                    <ViewShell.Main class="overflow-hidden">
                      <Show
                        when={selectedChannel()}
                        fallback={
                          <>
                            <ViewShell.TopBar>
                              <span class="text-sm font-semibold">Chat</span>
                            </ViewShell.TopBar>
                            <div class="flex min-h-0 flex-1 items-center justify-center px-6 text-center">
                              <div class="flex max-w-sm flex-col gap-2">
                                <h2 class="text-base font-semibold text-ink">
                                  Select a conversation
                                </h2>
                                <p class="text-sm leading-5 text-ink-muted">
                                  Choose a channel or person from the sidebar to
                                  open the conversation here.
                                </p>
                              </div>
                            </div>
                          </>
                        }
                      >
                        {(channel) => (
                          <Suspense>
                            <PreviewPanel
                              selectedEntity={channel()}
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
              <MaybeSoupEntityActionDrawerManager>
                <Suspense
                  fallback={
                    <div class="grid size-full place-items-center text-ink-muted">
                      <SpinnerIcon
                        aria-label="Loading channels"
                        class="size-5 animate-spin"
                      />
                    </div>
                  }
                >
                  <ChannelsMobileView
                    source={sources[state.mobileTab]}
                    tab={state.mobileTab}
                    onTabChange={setMobileTab}
                  />
                </Suspense>
              </MaybeSoupEntityActionDrawerManager>
            </Show>
          </SplitPanel.Body>
        </SplitPanel.Root>
      </StaticMarkdownContext>
    </ListEntityMetadataQueryProvider>
  );
}

/** Chat workspace with shared workspace navigation. */
export function ChannelsView(props: ChannelsViewProps) {
  return (
    <ChannelsViewProvider initialState={props.initialState}>
      <ChannelsViewRoot />
    </ChannelsViewProvider>
  );
}
