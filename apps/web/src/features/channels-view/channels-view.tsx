import { ViewShell } from '@app/components/view-shell';
import { SearchState } from '@app/features/command/mobile/mobileSearchState';
import { useMobileSearchText } from '@app/features/command/mobile/use-mobile-search-text';
import { markChannelNotificationsSeenOnOpen } from '@app/features/next-soup/utils';
import { MaybeSoupEntityActionDrawerManager } from '@app/features/soup';
import { withEntityNotifications } from '@app/features/soup/entity-notifications';
import { SplitRouter } from '@app/lib/split-router';
import { DebugSuspense } from '@channel/DebugSuspense';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { ListEntityMetadataQueryProvider } from '@entity';
import SpinnerIcon from '@phosphor/spinner.svg';
import {
  createContext,
  createMemo,
  createSignal,
  onMount,
  Show,
  useContext,
} from 'solid-js';
import { ChannelsViewProvider, useChannelsView } from './channels-view-context';
import { ChannelDetailView } from './components/ChannelDetailView';
import { ChannelsMobileView } from './components/ChannelsMobileView';
import { ChannelsRail } from './components/rail/ChannelsRail';
import { createChannelDetail } from './primitives/create-channel-detail';
import {
  type ChannelsSources,
  deduplicateChannels,
  resolveSelectedChannel,
  useChannelByIdQuery,
  useChannelsSources,
} from './queries';
import { createChannelDetailSource } from './queries/channel-detail-source';
import { createChannelSearchSource } from './queries/channel-search-source';

const ChannelSourcesContext =
  createContext<ReturnType<typeof useChannelsSources>>();

import type { ChannelsViewStateOptions } from './types';

export type ChannelsViewProps = {
  /** Explicit navigation state. When present, it wins over entry restoration. */
  initialState?: ChannelsViewStateOptions;
};

// Mounted inside the mobile list's Suspense boundary.
function MobileChannelsList(props: { sources: ChannelsSources }) {
  const panel = useSplitPanelOrThrow();
  const { state, setMobileTab } = useChannelsView();
  const mobileSearchText = useMobileSearchText(() => '', panel.handle.isActive);
  const mobileSearchSource = createChannelSearchSource({
    text: mobileSearchText,
    scope: () => state.mobileTab,
    source: () => props.sources[state.mobileTab],
  });
  return (
    <ChannelsMobileView
      source={mobileSearchSource}
      searchQuery={mobileSearchText()}
      onClearSearch={() => SearchState.setQuery('')}
      tab={state.mobileTab}
      onTabChange={setMobileTab}
    />
  );
}

function DesktopChannelsRail(props: {
  sources: ChannelsSources;
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
}) {
  const [searchQuery, setSearchQuery] = createSignal('');
  const searchSource = createChannelSearchSource({
    text: searchQuery,
    enabled: () => props.searchOpen,
    scope: () => 'search',
    source: () => props.sources.search,
  });
  return (
    <ChannelsRail
      sources={{ ...props.sources, search: searchSource }}
      searchQuery={searchQuery()}
      onSearchQueryChange={setSearchQuery}
      searchOpen={props.searchOpen}
      onSearchOpenChange={props.onSearchOpenChange}
    />
  );
}

function ChannelsViewRoot() {
  const panel = useSplitPanelOrThrow();
  const { state, mobileLayout, selectedChannel, setAsideWidth } =
    useChannelsView();
  const [railSearchOpen, setRailSearchOpen] = createSignal(false);

  const sources = useChannelsSources(
    (scope) => {
      if (mobileLayout())
        return scope !== 'search' && state.mobileTab === scope;
      if (railSearchOpen()) return scope === 'search';
      if (scope === 'search') return false;
      if (scope === 'recents') return state.tab === 'recents';
      return state.tab === 'browse';
    },
    (group) => state.sortBy[group]
  );
  onMount(() => panel.handle.setDisplayName('Channels'));

  return (
    <ListEntityMetadataQueryProvider>
      <StaticMarkdownContext>
        <SplitPanel.Root>
          <SplitPanel.Body>
            <Show
              when={mobileLayout()}
              fallback={
                <div class="size-full min-h-0 bg-panel">
                  <ViewShell.Root
                    asidePreferenceKey="channels"
                    // The empty state only points at the rail, so keep it open.
                    asideRequired={selectedChannel() === undefined}
                    aside={{
                      width: state.asideWidth,
                      preserveDuringResize: false,
                    }}
                    main={{ preferredWidth: 640 }}
                    resizable
                  >
                    <ViewShell.Aside onWidthChangeEnd={setAsideWidth}>
                      <DebugSuspense
                        name="ChannelsView.rail"
                        fallback={
                          <SpinnerIcon
                            aria-label="Loading channels"
                            class="size-5 animate-spin"
                          />
                        }
                      >
                        <DesktopChannelsRail
                          sources={sources}
                          searchOpen={railSearchOpen()}
                          onSearchOpenChange={setRailSearchOpen}
                        />
                      </DebugSuspense>
                    </ViewShell.Aside>
                    <ViewShell.Main class="overflow-hidden">
                      <ChannelSourcesContext.Provider value={sources}>
                        <DebugSuspense name="ChannelsView.outlet">
                          <SplitRouter.Outlet
                            fallback={() => (
                              <>
                                <ViewShell.TopBar>
                                  <span class="text-sm font-semibold">
                                    Chat
                                  </span>
                                </ViewShell.TopBar>
                                <div class="flex min-h-0 flex-1 items-center justify-center px-6 text-center">
                                  <div class="flex max-w-sm flex-col gap-2">
                                    <h2 class="text-base font-semibold text-ink">
                                      Select a conversation
                                    </h2>
                                    <p class="text-sm leading-5 text-ink-muted">
                                      Choose a channel or person from the
                                      sidebar to open the conversation here.
                                    </p>
                                  </div>
                                </div>
                              </>
                            )}
                          />
                        </DebugSuspense>
                      </ChannelSourcesContext.Provider>
                    </ViewShell.Main>
                  </ViewShell.Root>
                </div>
              }
            >
              <MaybeSoupEntityActionDrawerManager>
                <DebugSuspense
                  name="ChannelsView.mobile"
                  fallback={
                    <div class="grid size-full place-items-center text-ink-muted">
                      <SpinnerIcon
                        aria-label="Loading channels"
                        class="size-5 animate-spin"
                      />
                    </div>
                  }
                >
                  <MobileChannelsList sources={sources} />
                </DebugSuspense>
              </MaybeSoupEntityActionDrawerManager>
            </Show>
          </SplitPanel.Body>
        </SplitPanel.Root>
      </StaticMarkdownContext>
    </ListEntityMetadataQueryProvider>
  );
}

function ChannelDetailRouteContent() {
  const { selectedChannel } = useChannelsView();
  const notificationSource = useGlobalNotificationSource();
  const channelId = createMemo(() => selectedChannel()?.id);
  const sources = useContext(ChannelSourcesContext);
  const loaded = createMemo(() =>
    resolveSelectedChannel(
      channelId(),
      sources
        ? deduplicateChannels([
            sources.channels.items(),
            sources.direct_messages.items(),
            sources.recents.items(),
            sources.search.items(),
          ])
        : []
    )
  );
  const source = createChannelDetailSource({
    channelId,
    cached: loaded,
    createQuery: useChannelByIdQuery,
  });
  const detail = createChannelDetail({
    selection: selectedChannel,
    cached: loaded,
    source,
    markRead: (channel) =>
      markChannelNotificationsSeenOnOpen(
        withEntityNotifications(channel, notificationSource),
        notificationSource,
        { channelReadScope: 'top-level' }
      ),
  });
  const visibleChannel = createMemo(() => {
    const view = detail.view();
    if (view.status !== 'ready') return;
    return withEntityNotifications(
      { ...view.channel, target: selectedChannel()?.target },
      notificationSource
    );
  });
  const unavailable = () => detail.view().status === 'unavailable';
  const retry = async () => {
    try {
      await detail.refresh();
    } catch {
      /* The source presents the failure. */
    }
  };

  return (
    <DebugSuspense name="ChannelsView.detail-content">
      <Show
        when={visibleChannel()}
        fallback={
          <>
            <ViewShell.TopBar>
              <span class="truncate text-sm font-semibold">
                {loaded()?.name ?? 'Conversation'}
              </span>
            </ViewShell.TopBar>
            <div
              class="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-ink-muted"
              role="status"
            >
              <h2>
                {unavailable()
                  ? 'Conversation unavailable'
                  : 'Loading conversation'}
              </h2>
              <Show when={unavailable()}>
                <button type="button" onClick={retry}>
                  Retry
                </button>
              </Show>
            </div>
          </>
        }
      >
        {(channel) => (
          <div class="flex size-full min-h-0 flex-col">
            <ChannelDetailView channel={channel()} target={detail.target()} />
          </div>
        )}
      </Show>
    </DebugSuspense>
  );
}

export function ChannelDetailRouteView() {
  return (
    <DebugSuspense name="ChannelsView.detail-route">
      <ChannelDetailRouteContent />
    </DebugSuspense>
  );
}

/** Chat workspace with shared workspace navigation. */
export function ChannelsView(props: ChannelsViewProps) {
  return (
    <DebugSuspense name="ChannelsView.root">
      <ChannelsViewProvider initialState={props.initialState}>
        <ChannelsViewRoot />
      </ChannelsViewProvider>
    </DebugSuspense>
  );
}
