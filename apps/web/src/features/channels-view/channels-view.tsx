import {
  ViewShell,
  type ViewShellRootProps,
  ViewSidebar,
} from '@app/components/view-shell';
import { useInlinePreviewLayout } from '@app/components/view-shell/use-inline-preview-layout';
import { SearchState } from '@app/features/command/mobile/mobileSearchState';
import {
  type ChannelPreviewSelection,
  markChannelNotificationsSeenOnOpen,
  navigateChannelEntityToTarget,
} from '@app/features/next-soup/utils';
import { MaybeSoupEntityActionDrawerManager } from '@app/features/soup';
import { withEntityNotifications } from '@app/features/soup/entity-notifications';
import { ViewTour } from '@app/features/tours/ViewTour';
import { TutorialPill } from '@app/features/video-tutorials';
import { SplitRouter } from '@app/lib/split-router';
import { usePending } from '@app/observability/flow';
import { ChannelDetailLayout } from '@channel/Channel/ChannelDetailLayout';
import { ChannelLoading } from '@channel/Channel/ChannelLoading';
import { useChannelByIdQuery } from '@channel/Channel/channel-entity';
import { ChannelAccessDenied } from '@channel/ChannelAccessDenied';
import { ChannelUnavailable } from '@channel/components/ChannelUnavailable';
import { DebugSuspense } from '@channel/DebugSuspense';
import { isPendingDirectMessageId } from '@channel/primitives/pending-direct-messages';
import { prefetchChannelTarget } from '@channel/queries/prefetch-channel-target';
import {
  useGlobalBlockOrchestrator,
  useGlobalNotificationSource,
} from '@components/app/GlobalAppState';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { useIsAuthenticated } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { type ChannelEntity, ListEntityMetadataQueryProvider } from '@entity';
import SpinnerIcon from '@icon/system/regular/spinner.svg';
import { hydrateChannelNotificationSelection } from '@queries/channel/notification-selection';
import { useFavoritesData } from '@queries/favorites/favorites';
import {
  type Accessor,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
  useContext,
} from 'solid-js';
import { ChannelsViewProvider, useChannelsView } from './channels-view-context';
import { ChannelDetailView } from './components/ChannelDetailView';
import { MAX_PINNED_CHANNELS } from './components/ChannelPins';
import { ChannelsMobileView } from './components/ChannelsMobileView';
import { ChannelsTouchSidebar } from './components/ChannelsTouchSidebar';
import { ChannelsViewMain } from './components/ChannelsViewMain';
import { ChannelThreadsView } from './components/ChannelThreadsView';
import { PendingDirectMessageDetail } from './components/PendingDirectMessageDetail';
import { ChannelsRail } from './components/rail/ChannelsRail';
import { createSectionSearchSource } from './components/rail/next/channel-discovery-source';
import { MobileSectionsView } from './components/rail/next/mobile/MobileSectionsView';
import { createChannelDetail } from './primitives/create-channel-detail';
import {
  type ChannelsSources,
  deduplicateChannels,
  resolveSelectedChannel,
  useChannelsSources,
} from './queries';
import { createChannelDetailSource } from './queries/channel-detail-source';
import { useChannelListSearchPool } from './queries/channel-list-search-pool';
import { createChannelSearchSource } from './queries/channel-search-source';
import { channelsTour } from './tour';

const ChannelSourcesContext =
  createContext<ReturnType<typeof useChannelsSources>>();

import type { ChannelsViewStateOptions } from './types';

export type ChannelsViewProps = {
  /** Explicit navigation state. When present, it wins over entry restoration. */
  initialState?: ChannelsViewStateOptions;
};

// Mounted inside the mobile list's Suspense boundary.
function MobileChannelsList(props: {
  sources: ChannelsSources;
  localChannels: Accessor<ChannelEntity[]>;
}) {
  const {
    mobileLayout,
    selectedChannel,
    setSelectedChannel,
    sectionsEnabled,
    sectionsLoading,
  } = useChannelsView();
  const panel = useSplitPanelOrThrow();
  const notificationSource = useGlobalNotificationSource();
  const orchestrator = useGlobalBlockOrchestrator();
  let activation = 0;
  onCleanup(() => activation++);
  const refreshSelection = async (
    channel: ChannelEntity,
    selection: ChannelPreviewSelection,
    request: number,
    reaim: boolean
  ) => {
    const hydrated = await hydrateChannelNotificationSelection(
      channel,
      notificationSource.withLocalOverrides
    );
    const current = selectedChannel();
    if (
      request !== activation ||
      mobileLayout() ||
      !panel.handle.isActive() ||
      current?.id !== selection.id ||
      current.target
    )
      return;
    markChannelNotificationsSeenOnOpen(
      withEntityNotifications(hydrated, notificationSource),
      notificationSource,
      { channelReadScope: 'top-level' }
    );
    if (reaim) await navigateChannelEntityToTarget(selection, orchestrator);
  };
  const openPreview = (channel: ChannelEntity) => {
    const request = ++activation;
    if (channel.isParticipant === false) return false;
    const previous = selectedChannel();
    const selection: ChannelPreviewSelection = {
      type: 'channel',
      id: channel.id,
    };
    if (!setSelectedChannel(selection)) return false;
    if (previous?.id === selection.id) {
      fireAndForget(
        refreshSelection(channel, selection, request, !previous.target),
        'channels-view'
      );
    }
    return true;
  };
  const listChannels = props.localChannels;
  const mobileSearchText = () => '';
  const mobileSearchSource = createChannelSearchSource({
    additionalLocalChannels: listChannels,
    text: mobileSearchText,
    scope: () => 'recents',
    source: () => props.sources.recents,
  });
  const favoritesData = useFavoritesData({ entityType: ['channel'] });
  // Recents carry the latest message and unread state; the channel list
  // covers favorites that have not surfaced in Recents yet.
  const pinned = createMemo(() => {
    const channelsById = new Map(
      deduplicateChannels([props.sources.recents.items(), listChannels()]).map(
        (channel) => [channel.id, channel]
      )
    );
    return (favoritesData()?.favorites ?? [])
      .filter((favorite) => favorite.entityType === 'channel')
      .flatMap((favorite) => channelsById.get(favorite.entityId) ?? []);
  });
  return (
    <Show when={!sectionsLoading()}>
      <Show
        when={sectionsEnabled()}
        fallback={
          <ChannelsMobileView
            source={mobileSearchSource}
            pinned={pinned().slice(0, MAX_PINNED_CHANNELS)}
            searchQuery={mobileSearchText()}
            onClearSearch={() => SearchState.setQuery('')}
            openPreview={mobileLayout() ? undefined : openPreview}
          />
        }
      >
        <MobileSectionsView
          sources={props.sources}
          localChannels={listChannels}
          pinned={pinned()}
          openPreview={mobileLayout() ? undefined : openPreview}
        />
      </Show>
    </Show>
  );
}

function DesktopChannelsRail(props: {
  sources: ChannelsSources;
  localChannels: Accessor<ChannelEntity[]>;
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
}) {
  const listChannels = props.localChannels;
  const { sectionsEnabled } = useChannelsView();
  const [searchQuery, setSearchQuery] = createSignal('');
  const searchSource = createChannelSearchSource({
    additionalLocalChannels: listChannels,
    text: searchQuery,
    enabled: () => props.searchOpen && !sectionsEnabled(),
    scope: () => 'search',
    source: () => props.sources.search,
  });
  const sectionSearch = createSectionSearchSource({
    enabled: () => props.searchOpen && sectionsEnabled(),
    text: searchQuery,
    recent: () => props.sources.search,
    localChannels: listChannels,
  });
  return (
    <ChannelsRail
      sources={{
        ...props.sources,
        search: sectionsEnabled() ? sectionSearch : searchSource,
      }}
      searchQuery={searchQuery()}
      onSearchQueryChange={setSearchQuery}
      searchOpen={props.searchOpen}
      onSearchOpenChange={props.onSearchOpenChange}
    />
  );
}

function DesktopChannelThreads(props: { sources: ChannelsSources }) {
  const { threadsChannelId, setTab, setSelectedChannel } = useChannelsView();
  const channelsById = createMemo(
    () =>
      new Map(
        deduplicateChannels([
          props.sources.threads.items(),
          props.sources.team_channels.items(),
          props.sources.channels.items(),
          props.sources.direct_messages.items(),
          props.sources.recents.items(),
        ]).map((channel) => [channel.id, channel])
      )
  );

  return (
    <ChannelThreadsView
      channelId={threadsChannelId()}
      resolveChannel={(channelId) => channelsById().get(channelId)}
      onOpenThread={(thread) => {
        setTab('browse');
        setSelectedChannel(thread);
      }}
    />
  );
}
type ChannelsAsideList = ViewShellRootProps['asideList'];

function ChannelsViewRoot(props: {
  registerAsideList: (list: (() => ChannelsAsideList) | undefined) => void;
}) {
  const panel = useSplitPanelOrThrow();
  const {
    state,
    tab,
    setTab,
    mobileLayout,
    sectionsLoading,
    sectionsEnabled,
    selectedChannel,
    setSelectedChannel,
  } = useChannelsView();
  const threadsTab = () => !isTouchDevice() && tab() === 'threads';
  // Threads fill Main like a conversation, so going back leaves them first.
  const returnToList = () => {
    if (threadsTab()) setTab('browse');
    else setSelectedChannel(undefined);
  };
  // Narrow desktop, the rail and the conversation take turns at full width.
  // The loading spinner has no rail to take turns with.
  props.registerAsideList(() =>
    isTouchDevice() || sectionsLoading()
      ? undefined
      : {
          open: selectedChannel() !== undefined || threadsTab(),
          onBack: returnToList,
        }
  );
  onCleanup(() => props.registerAsideList(undefined));
  const [railSearchOpen, setRailSearchOpen] = createSignal(false);
  const localChannels = useChannelListSearchPool();

  const sources = useChannelsSources(
    (scope) => {
      if (isTouchDevice()) {
        return (
          scope === 'recents' ||
          (!sectionsLoading() &&
            sectionsEnabled() &&
            scope === 'direct_messages')
        );
      }
      if (sectionsLoading()) return false;
      if (railSearchOpen()) return scope === 'search';
      if (scope === 'search') return false;
      if (scope === 'recents') return tab() === 'recents';
      if (scope === 'threads') return tab() === 'threads';
      return tab() === 'browse';
    },
    (group) => state.sortBy[group],
    localChannels
  );
  onMount(() => {
    panel.handle.setDisplayName('Channels');
    panel.handle.updateMeta?.({ splitPanelLayout: 'composable' });
  });

  return (
    <ListEntityMetadataQueryProvider>
      <StaticMarkdownContext>
        <Show
          when={!sectionsLoading()}
          fallback={
            <div class="grid size-full place-items-center">
              <SpinnerIcon
                aria-hidden={false}
                aria-label="Loading channels"
                class="size-5 animate-spin"
              />
            </div>
          }
        >
          <Show when={!mobileLayout()}>
            <ViewShell.Aside>
              <DebugSuspense
                name="ChannelsView.rail"
                fallback={
                  <SpinnerIcon
                    aria-hidden={false}
                    aria-label="Loading channels"
                    class="size-5 animate-spin"
                  />
                }
              >
                <Show
                  when={isTouchDevice()}
                  fallback={
                    <DesktopChannelsRail
                      sources={sources}
                      localChannels={localChannels}
                      searchOpen={railSearchOpen()}
                      onSearchOpenChange={setRailSearchOpen}
                    />
                  }
                >
                  <ChannelsTouchSidebar>
                    <MaybeSoupEntityActionDrawerManager>
                      <MobileChannelsList
                        sources={sources}
                        localChannels={localChannels}
                      />
                    </MaybeSoupEntityActionDrawerManager>
                  </ChannelsTouchSidebar>
                </Show>
              </DebugSuspense>
            </ViewShell.Aside>
          </Show>
          <ChannelsViewMain
            mobileLayout={mobileLayout()}
            sidebarToggle={
              isTouchDevice() && !mobileLayout() && !selectedChannel()
            }
          >
            <Show
              when={!mobileLayout()}
              fallback={
                <MaybeSoupEntityActionDrawerManager>
                  <DebugSuspense
                    name="ChannelsView.mobile"
                    fallback={<SpinnerIcon class="size-5 animate-spin" />}
                  >
                    <MobileChannelsList
                      sources={sources}
                      localChannels={localChannels}
                    />
                  </DebugSuspense>
                </MaybeSoupEntityActionDrawerManager>
              }
            >
              <ViewTour tour={channelsTour} />
              <Show
                when={!threadsTab()}
                fallback={
                  <DebugSuspense name="ChannelsView.threads">
                    <DesktopChannelThreads sources={sources} />
                  </DebugSuspense>
                }
              >
                <ChannelSourcesContext.Provider value={sources}>
                  <DebugSuspense name="ChannelsView.outlet">
                    <SplitRouter.Outlet
                      fallback={() => (
                        <>
                          <ViewShell.TopBar>
                            <ViewSidebar.Title caret={false}>
                              Chat
                            </ViewSidebar.Title>
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
                              <TutorialPill
                                tutorial="chat"
                                class="mt-3 self-center"
                              />
                            </div>
                          </div>
                        </>
                      )}
                    />
                  </DebugSuspense>
                </ChannelSourcesContext.Provider>
              </Show>
            </Show>
          </ChannelsViewMain>
        </Show>
      </StaticMarkdownContext>
    </ListEntityMetadataQueryProvider>
  );
}

function ChannelDetailRouteContent() {
  const { selectedChannel } = useChannelsView();
  const notificationSource = useGlobalNotificationSource();
  const channelId = createMemo(() => selectedChannel()?.id);
  const authenticated = useIsAuthenticated();
  const target = createMemo(() => selectedChannel()?.target);
  createEffect(
    on([channelId, target, authenticated], ([id, destination, signedIn]) => {
      if (!id || !destination || signedIn !== true) return;
      fireAndForget(
        prefetchChannelTarget(id, destination),
        'channel-target-prefetch'
      );
    })
  );
  const sources = useContext(ChannelSourcesContext);
  const loaded = createMemo(() =>
    resolveSelectedChannel(
      channelId(),
      sources
        ? deduplicateChannels([
            sources.team_channels.items(),
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
  usePending(
    'channel.detail',
    () => channelId() !== undefined && detail.view().status === 'loading'
  );
  const unavailable = () => detail.view().status === 'unavailable';
  const deniedChannelId = createMemo<string | undefined>((previous) => {
    const view = detail.view();
    if (
      view.status === 'unavailable' &&
      (view.denied ||
        source.load().status === 'ready' ||
        (source.load().status === 'pending' && previous === view.channelId))
    )
      return view.channelId;
  });
  const retry = async () => {
    try {
      await detail.refresh();
    } catch {
      /* The source presents the failure. */
    }
  };

  return (
    <DebugSuspense
      name="ChannelsView.detail-content"
      fallback={<ChannelLoading />}
    >
      <Show
        when={visibleChannel()}
        fallback={
          <ChannelDetailLayout
            scrollBehindHeader={false}
            header={
              <ViewShell.TopBar class="touch:flex touch:h-10 touch:px-0 touch:py-0">
                <span class="truncate text-sm font-semibold">
                  {loaded()?.name ?? 'Conversation'}
                </span>
              </ViewShell.TopBar>
            }
          >
            <Show when={unavailable()} fallback={<ChannelLoading />}>
              <Show
                when={deniedChannelId()}
                keyed
                fallback={
                  <ChannelUnavailable
                    onRetry={() => fireAndForget(retry(), 'channel')}
                  />
                }
              >
                {(id) => (
                  <ChannelAccessDenied
                    channelId={id}
                    onRefreshChannel={() =>
                      fireAndForget(retry(), 'channel-access-request')
                    }
                  />
                )}
              </Show>
            </Show>
          </ChannelDetailLayout>
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
  const { selectedChannel } = useChannelsView();
  // A DM its first message will create has nothing to load yet.
  const pendingId = () => {
    const id = selectedChannel()?.id;
    return isPendingDirectMessageId(id) ? id : undefined;
  };

  return (
    <DebugSuspense
      name="ChannelsView.detail-route"
      fallback={<ChannelLoading />}
    >
      <Show when={pendingId()} keyed fallback={<ChannelDetailRouteContent />}>
        {(id) => <PendingDirectMessageDetail pendingId={id} />}
      </Show>
    </DebugSuspense>
  );
}

/** Chat workspace with shared workspace navigation. */
export function ChannelsView(props: ChannelsViewProps) {
  const inlinePreviewLayout = useInlinePreviewLayout();
  // The selection lives in the provider, which needs the shell around it.
  const [asideList, setAsideList] = createSignal<() => ChannelsAsideList>();
  return (
    <DebugSuspense name="ChannelsView.root">
      <SplitPanel.Root>
        <SplitPanel.Body>
          <ViewShell.Root
            asidePreferenceKey="channels"
            aside={
              inlinePreviewLayout() ? { preserveDuringResize: false } : false
            }
            asideList={asideList()?.()}
            main={{ preferredWidth: 640 }}
            resizable
          >
            <ChannelsViewProvider initialState={props.initialState}>
              <ChannelsViewRoot
                registerAsideList={(list) => setAsideList(() => list)}
              />
            </ChannelsViewProvider>
          </ViewShell.Root>
        </SplitPanel.Body>
      </SplitPanel.Root>
    </DebugSuspense>
  );
}
