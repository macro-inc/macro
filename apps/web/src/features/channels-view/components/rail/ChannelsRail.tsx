import {
  createListController,
  type ListScrollHandle,
  listOwnedSlotName,
  useListInteractions,
} from '@app/components/list';
import {
  useViewControlHotkeys,
  useViewTabHotkeys,
} from '@app/components/view-shell';
import {
  type ChannelPreviewSelection,
  channelPreviewSelection,
  getChannelEntityTarget,
  markChannelNotificationsSeenOnOpen,
  navigateChannelEntityToTarget,
  openEntityInSplitFromUnifiedList,
} from '@app/features/next-soup/utils';
import { withEntityNotifications } from '@app/features/soup/entity-notifications';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { favoriteSplitContent } from '@app/util/favorites';
import { prefetchLatestChannelMessages } from '@channel/queries/prefetch-channel-target';
import {
  useGlobalBlockOrchestrator,
  useGlobalNotificationSource,
} from '@components/app/GlobalAppState';
import { useSplitLayout } from '@components/app/split-layout/layout';
import {
  useSplitPanelOrThrow,
  withSplitPanelOwner,
} from '@components/app/split-layout/layoutUtils';
import { toast } from '@core/component/Toast/Toast';
import { enableChannelTags } from '@core/constant/featureFlags';

import { createHotkeyGroup, registerHotkey } from '@core/hotkey/hotkeys';
import { thrownResultErrorHasCode } from '@core/util/result';
import type { ChannelEntity, WithNotification } from '@entity';

import { hydrateChannelNotificationSelection } from '@queries/channel/notification-selection';
import { fetchChannelSelectionById } from '@queries/channel/selection-by-id';
import { useChannelLabelsQuery } from '@queries/channel-labels/channel-labels';
import { useFavoritesData } from '@queries/favorites/favorites';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';

import { debounce } from '@solid-primitives/scheduled';
import { useDragDropContext } from '@thisbeyond/solid-dnd';

import {
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  getOwner,
  onCleanup,
  Show,
  startTransition,
} from 'solid-js';
import type { VirtualizerHandle } from 'virtua/solid';
import { useChannelsView } from '../../channels-view-context';
import {
  canLabelChannel,
  filterChannelLabelMembers,
} from '../../core/channel-label-eligibility';
import { resolveChannelLabelMemberships } from '../../core/smart-tags';
import {
  type ChannelsSourceScope,
  type ChannelsSources,
  deduplicateChannels,
  resolveReferencedChannels,
  useChannelsByIdsQuery,
} from '../../queries';
import { useReferencedChannels } from '../../queries/referenced-channels';
import type {
  ChannelSectionKey,
  ChannelsQueryScope,
  ChannelsRailSection,
  ChannelsTab,
} from '../../types';
import {
  buildChannelRailRows as buildOriginalChannelRailRows,
  buildChannelSectionRows as buildOriginalChannelSectionRows,
} from './build-channel-rail-rows';
import {
  type ChannelLabelDragData,
  type ChannelLabelDropData,
  type ChannelLabelDropTarget,
  type ChannelRailActivationMetadata,
  type ChannelRailRow,
  type ChannelsRailContext,
  ChannelsRailProvider,
  domIdForRow,
  rowKeyForChannel,
  rowKeyForFavorite,
  rowKeyForLabel,
  rowKeyForSection,
} from './ChannelsRailContext';
import { ExpandedChannelsRail } from './ExpandedChannelsRail';
import {
  buildChannelRailRows,
  buildChannelSectionRows,
  getChannelRailPaginationScope,
} from './next/build-channel-rail-rows';
import { ExpandedChannelsRail as NextChannelsRail } from './next/ExpandedChannelsRail';

export { buildChannelRailRows } from './next/build-channel-rail-rows';

import { fireAndForget } from '@core/util/fireAndForget';
import { useChannelCalls } from './hooks/useChannelCalls';
import { useChannelLabelActions } from './hooks/useChannelLabelActions';
import { useChannelRailActivity } from './hooks/useChannelRailActivity';

const LABEL_KEY_PREFIX = 'label:';
const BROWSE_QUERY_SCOPES = [
  'team_channels',
  'channels',
  'direct_messages',
] as const;
const CHANNEL_TAB_IDS: ChannelsTab[] = ['browse', 'recents'];
const CHANNEL_TAB_IDS_WITH_THREADS: ChannelsTab[] = [
  ...CHANNEL_TAB_IDS,
  'threads',
];
const DM_LOADING_PREVIEW_OFFSET = 80;

export type ChannelsRailProps = {
  sources: ChannelsSources;
  searchOpen: boolean;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  onSearchOpenChange: (open: boolean) => void;
};

export function ChannelsRail(props: ChannelsRailProps) {
  const channelTagsFlag = useFeatureFlag(enableChannelTags);
  const channelTagsEnabled = createMemo(() => channelTagsFlag().enabled);
  const {
    state,
    sectionsEnabled,
    setGroupOpen,
    setLabelOpen,
    selectedChannel,
    setSelectedChannel,
    setSortBy,
    setSectionPreferences,
    setTab,
    tab,
    threadsEnabled,
    threadsChannelId,
    setThreadsChannelId,
  } = useChannelsView();
  // Dispose label dialogs when either rollout switches their owning UI.
  // Memo recomputation runs these cleanups even when the owner identity is unchanged.
  const labelDialogOwner = createMemo(() => {
    sectionsEnabled();
    return channelTagsEnabled() ? getOwner() : undefined;
  });

  const panel = useSplitPanelOrThrow();
  const layout = useSplitLayout();
  const notificationSource = useGlobalNotificationSource();
  const orchestrator = useGlobalBlockOrchestrator();
  let activation = 0;
  onCleanup(() => activation++);

  const reportActivationError = (error: unknown) => {
    console.error('Failed to open conversation', error);
    toast.failure('Unable to open conversation. Please try again.');
  };

  const selectChannel = async (
    channel: WithNotification<ChannelEntity>,
    channelId: string,
    openInNewSplit: boolean
  ) => {
    try {
      const entity = withEntityNotifications(channel, notificationSource);
      if (openInNewSplit) {
        await openEntityInSplitFromUnifiedList(entity, {
          openInNewSplit: true,
          referredFrom: 'channels',
          notificationSource,
          channelNavigation: 'latest',
          channelReadScope: 'top-level',
        });
        return;
      }
      const selection = channelPreviewSelection(channelId, {
        target: getChannelEntityTarget(entity, {
          channelNavigation: 'latest',
        }),
      });
      const previous = selectedChannel();
      if (!setSelectedChannel(selection)) return;
      // The detail owns read marking on route opens. Re-clicks refresh and
      // mark again even though the mounted route does not change.
      if (previous?.id === selection.id && channel.isParticipant !== false) {
        markChannelNotificationsSeenOnOpen(entity, notificationSource, {
          channelReadScope: 'top-level',
        });
      }
      // Repeated clicks must navigate even when the route stays the same.
      if (
        previous?.id === selection.id &&
        previous.target?.messageId === selection.target?.messageId &&
        previous.target?.threadId === selection.target?.threadId
      ) {
        await navigateChannelEntityToTarget(selection, orchestrator);
      }
    } catch (error) {
      reportActivationError(error);
    }
  };

  const selectHydratedChannel = async (
    pending: Promise<WithNotification<ChannelEntity>>,
    request: number,
    channelId: string,
    openInNewSplit: boolean
  ) => {
    try {
      const channel = await pending;
      if (request !== activation) return;
      // Only fetched selections need to join the browser router's transition.
      await startTransition(() => {
        if (request === activation)
          fireAndForget(
            selectChannel(channel, channelId, openInNewSplit),
            'channels-view'
          );
      });
    } catch (error) {
      if (request === activation) reportActivationError(error);
    }
  };

  const activateChannel = (channel: ChannelEntity, openInNewSplit: boolean) => {
    const request = ++activation;
    // Capture before hydrate/await — store proxies from the list can lose
    // fields if the query refreshes while notifications are fetched.
    const channelId = channel.id;
    if (!channelId) {
      reportActivationError(new Error('Missing channel id'));
      return;
    }
    // A different channel owns its loading UI and notification hydration.
    // Select it before fetching so the rail and destination respond to the
    // click immediately. Re-clicks still refresh and re-aim the open channel.
    if (!openInNewSplit && selectedChannel()?.id !== channelId) {
      setSelectedChannel(
        channelPreviewSelection(channelId, {
          target: channel.target
            ? { kind: 'message', ...channel.target }
            : undefined,
        })
      );
      return;
    }
    const selection = hydrateChannelNotificationSelection(
      channel,
      notificationSource.withLocalOverrides
    );
    // Telemetry installs ZoneAwarePromise; native async results are not
    // instances of that constructor. Detect the pending edge structurally.
    if ('then' in selection) {
      fireAndForget(
        selectHydratedChannel(selection, request, channelId, openInNewSplit),
        'channels-view'
      );
    } else {
      fireAndForget(
        selectChannel(selection, channelId, openInNewSplit),
        'channels-view'
      );
    }
  };

  const favoritesData = useFavoritesData({ entityType: ['channel'] });

  const listDomId = createUniqueId();

  const [sectionScrollRoots, setSectionScrollRoots] = createSignal<
    Partial<Record<ChannelsRailSection | 'threads', HTMLDivElement>>
  >({});

  const [listRoot, setListRoot] = createSignal<HTMLDivElement>();
  const [virtualizers, setVirtualizers] = createSignal<
    Partial<Record<ChannelsSourceScope, VirtualizerHandle>>
  >({});

  const searchQuery = () => props.searchQuery;
  const setSearchQuery = (query: string) => props.onSearchQueryChange(query);

  const [restoreListScroll, setRestoreListScroll] = createSignal(false);

  let searchInput: HTMLInputElement | undefined;

  const previewAfterNavigation = debounce(
    (channel: ChannelPreviewSelection) => setSelectedChannel(channel),
    150
  );
  onCleanup(() => previewAfterNavigation.clear());

  const closeSearch = () => {
    if (props.searchOpen) setRestoreListScroll(true);
    setSearchQuery('');
    props.onSearchOpenChange(false);
  };

  const openSearch = () => {
    props.onSearchOpenChange(true);
    queueMicrotask(() => searchInput?.focus());
  };

  const selectTab = (tab: ChannelsTab) => {
    previewAfterNavigation.clear();
    setRestoreListScroll(true);
    setTab(tab);
  };

  const channelCalls = useChannelCalls();

  const channels = createMemo(() =>
    deduplicateChannels([
      props.sources.team_channels.items(),
      props.sources.channels.items(),
      props.sources.direct_messages.items(),
      props.sources.recents.items(),
      props.sources.search.items(),
    ])
  );

  const searchResults = () => props.sources.search.items();
  const searchLoading = () => props.sources.search.isFetching();
  const searchError = () => props.sources.search.error();
  const retrySearch = () => props.sources.search.refresh();

  const labelsQuery = useChannelLabelsQuery();
  const personalLabelsQuery = useChannelLabelsQuery(
    'personal',
    sectionsEnabled
  );
  const sharedLabels = () =>
    !labelsQuery.isPending && Boolean(labelsQuery.data?.teamId);
  const labels = createMemo<readonly ChannelLabel[]>(() => {
    if (!channelTagsEnabled()) return [];
    if (!sectionsEnabled()) {
      return !labelsQuery.isPending
        ? resolveChannelLabelMemberships(
            labelsQuery.data?.labels ?? [],
            channels()
          )
        : [];
    }
    const shared =
      !labelsQuery.isPending && labelsQuery.data?.teamId
        ? labelsQuery.data.labels
        : [];
    const personal = !personalLabelsQuery.isPending
      ? (personalLabelsQuery.data?.labels ?? [])
      : [];
    return resolveChannelLabelMemberships([...shared, ...personal], channels());
  });
  const labelsAvailable = () =>
    channelTagsEnabled() &&
    !labelsQuery.isPending &&
    Boolean(labelsQuery.data) &&
    (!sectionsEnabled() ||
      (!personalLabelsQuery.isPending && Boolean(personalLabelsQuery.data)));
  const labelsUnavailableReason = () => {
    if (labelsAvailable()) return '';
    if (
      labelsQuery.isPending ||
      (sectionsEnabled() && personalLabelsQuery.isPending)
    )
      return t('channelSections.loading');
    const error =
      labelsQuery.error ??
      (sectionsEnabled() ? personalLabelsQuery.error : undefined);
    if (
      thrownResultErrorHasCode(error, 'UNAUTHORIZED') ||
      thrownResultErrorHasCode(error, 'FORBIDDEN')
    ) {
      return t('channelSections.noAccess');
    }
    return t('channelSections.unavailable');
  };

  const favorites = createMemo(() => favoritesData()?.favorites ?? []);
  const favoriteChannelIds = createMemo(() =>
    favorites()
      .filter((favorite) => favorite.entityType === 'channel')
      .map((favorite) => favorite.entityId)
  );

  // Sections and favorites can reference channels outside the loaded pages.
  // Resolve their records independently without exhausting the main lists.
  const referencedChannelIds = createMemo(() => [
    ...new Set([
      ...labels().flatMap((label) => label.channelIds),
      ...favoriteChannelIds(),
    ]),
  ]);
  const missingChannelIds = createMemo(() => {
    const loaded = new Set(channels().map((channel) => channel.id));
    return referencedChannelIds().filter((id) => !loaded.has(id));
  });
  const referencedChannelsQuery = useChannelsByIdsQuery(() =>
    sectionsEnabled() ? [] : missingChannelIds()
  );
  const nextReferencedChannels = useReferencedChannels(
    referencedChannelIds,
    channels,
    sectionsEnabled
  );
  const referencedChannels = createMemo<ChannelEntity[]>(
    (previous) =>
      sectionsEnabled()
        ? nextReferencedChannels.channels()
        : resolveReferencedChannels(previous, referencedChannelsQuery),
    []
  );
  // Only a label puts a fetched channel in the channel-section lists.
  const labelledChannels = createMemo<ChannelEntity[]>(() => {
    if (!channelTagsEnabled()) return [];
    const labelled = new Set(labels().flatMap((label) => label.channelIds));
    return referencedChannels().filter((channel) => labelled.has(channel.id));
  });

  const allChannels = createMemo(() =>
    deduplicateChannels([channels(), labelledChannels()])
  );
  const channelsById = createMemo(
    () => new Map(allChannels().map((channel) => [channel.id, channel]))
  );
  const channelById = (channelId: string) =>
    channelsById().get(channelId) ??
    referencedChannels().find((channel) => channel.id === channelId);

  const activityChannels = createMemo(() => {
    if (!sectionsEnabled()) return allChannels();
    return deduplicateChannels([
      allChannels(),
      favoriteChannelIds().flatMap((id) => channelById(id) ?? []),
    ]);
  });
  const channelActivity = useChannelRailActivity(
    activityChannels,
    channelCalls
  );

  const isLabelOpen = (labelId: string) =>
    !state.collapsedLabels.includes(labelId);

  const channelSectionRows = createMemo(() => {
    const build = sectionsEnabled()
      ? buildChannelSectionRows
      : buildOriginalChannelSectionRows;
    return build({
      labels: labels(),
      channels: deduplicateChannels([
        props.sources.team_channels.items(),
        labelledChannels(),
      ]),
      channelsById: channelsById(),
      isLabelOpen,
    });
  });

  const labelUnreadCount = (label: ChannelLabel) => {
    const unread = channelActivity.unreadChannelIds();
    return filterChannelLabelMembers(label.channelIds, channelsById()).filter(
      (id) => unread.has(id)
    ).length;
  };

  const referenceStatuses = createMemo(() => {
    const statuses: Partial<Record<ChannelSectionKey, 'loading' | 'error'>> =
      {};
    if (!sectionsEnabled()) return statuses;
    const pending = nextReferencedChannels.pendingIds();
    const failed = nextReferencedChannels.failedIds();
    const statusFor = (ids: readonly string[]) => {
      if (ids.some((id) => failed.has(id) && !channelById(id))) return 'error';
      if (ids.some((id) => pending.has(id) && !channelById(id)))
        return 'loading';
    };
    if (state.expandedGroups.favorites) {
      statuses.favorites = statusFor(favoriteChannelIds());
    }
    for (const label of labels()) {
      if (isLabelOpen(label.id)) {
        statuses[`label:${label.id}`] = statusFor(label.channelIds);
      }
    }
    return statuses;
  });

  const visibleRows = createMemo(() => {
    if (props.searchOpen) {
      return searchResults().map(
        (channel, localIndex): ChannelRailRow => ({
          kind: 'conversation',
          id: rowKeyForChannel(channel.id),
          scope: 'search',
          localIndex,
          channel,
        })
      );
    }

    const items = {
      favorites: favorites(),
      team_channels: props.sources.team_channels.items(),
      channels: props.sources.channels.items(),
      direct_messages: props.sources.direct_messages.items(),
      recents: props.sources.recents.items(),
      threads: props.sources.threads.items(),
    };
    if (!sectionsEnabled()) {
      return buildOriginalChannelRailRows(
        tab(),
        state.expandedGroups,
        items,
        channelSectionRows()
      );
    }
    return buildChannelRailRows(
      tab(),
      state.expandedGroups,
      items,
      channelSectionRows(),
      {
        preferences: state.sectionPreferences,
        channelById,
        unreadChannelIds: channelActivity.unreadChannelIds(),
        referenceStatuses: referenceStatuses(),
      }
    );
  });

  const initialSelectedChannelId = selectedChannel()?.id;
  const list = withSplitPanelOwner(listOwnedSlotName('controller'), () =>
    createListController<ChannelRailRow, ChannelRailActivationMetadata>({
      items: visibleRows,
      getKey: (row) => row.id,
      isSelectable: () => false,
      isNavigable: (row) =>
        row.kind !== 'status' && row.kind !== 'reference-status',
      initialFocusKey: visibleRows().find(
        (row) =>
          row.kind === 'conversation' &&
          row.channel.id === initialSelectedChannelId
      )?.id,
      onActivate: ({ item, metadata }) => {
        activation++;
        previewAfterNavigation.clear();
        const openInNewSplit =
          metadata?.newSplit === true || metadata?.event?.shiftKey === true;
        if (item.kind === 'status' || item.kind === 'reference-status') return;

        if (item.kind === 'all-threads') {
          setThreadsChannelId(undefined);
          return;
        }

        // In the Threads tab, conversation rows (including search results)
        // filter the thread list; they open only into a new split.
        if (item.kind === 'conversation' && tab() === 'threads') {
          if (openInNewSplit) activateChannel(item.channel, true);
          else setThreadsChannelId(item.channel.id);
          return;
        }

        if (item.kind === 'section') {
          setGroupOpen(item.group, !state.expandedGroups[item.group]);
          return;
        }

        if (item.kind === 'label') {
          setLabelOpen(item.label.id, !isLabelOpen(item.label.id));
          return;
        }

        if (
          item.kind === 'favorite' &&
          item.favorite.entityType !== 'channel'
        ) {
          layout.openWithSplit(favoriteSplitContent(item.favorite), {
            preferNewSplit: openInNewSplit,
            referredFrom: 'channels',
          });
          return;
        }

        const channelId =
          item.kind === 'favorite' ? item.favorite.entityId : item.channel.id;

        const channel =
          item.kind === 'conversation' ? item.channel : channelById(channelId);
        if (channel) activateChannel(channel, openInNewSplit);
        else {
          const request = ++activation;
          if (openInNewSplit) {
            fireAndForget(
              selectHydratedChannel(
                fetchChannelSelectionById(channelId),
                request,
                channelId,
                true
              ),
              'channels-view'
            );
          } else setSelectedChannel({ type: 'channel', id: channelId });
        }
      },
    })
  );

  const scrollHandle: ListScrollHandle = {
    scrollToIndex: (index, options) => {
      const row = list.items.at(index);
      if (!row) return;
      if (
        sectionsEnabled() &&
        !props.searchOpen &&
        row.group !== 'direct_messages'
      ) {
        virtualizers().team_channels?.scrollToIndex(index, options);
        return;
      }

      if (row.kind === 'conversation' || row.kind === 'label') {
        const virtualizer =
          virtualizers()[row.kind === 'label' ? 'team_channels' : row.scope];
        if (virtualizer) {
          virtualizer.scrollToIndex(row.localIndex, options);
          return;
        }
      }

      const element = document.getElementById(domIdForRow(listDomId, row.id));
      const scrollRoot = props.searchOpen
        ? listRoot()
        : row.kind === 'favorite'
          ? sectionScrollRoots().favorites
          : row.kind === 'conversation' && row.group
            ? sectionScrollRoots()[row.group]
            : tab() === 'recents'
              ? listRoot()
              : tab() === 'threads'
                ? sectionScrollRoots().threads
                : undefined;
      if (!element || !scrollRoot) return;

      const elementBounds = element.getBoundingClientRect();
      const scrollBounds = scrollRoot.getBoundingClientRect();
      if (elementBounds.top < scrollBounds.top) {
        scrollRoot.scrollTop -= scrollBounds.top - elementBounds.top;
      } else if (elementBounds.bottom > scrollBounds.bottom) {
        scrollRoot.scrollTop += elementBounds.bottom - scrollBounds.bottom;
      }
    },
  };

  const scrollScopeToSelectedOrStart = (scope: ChannelsQueryScope) => {
    let rendered: (string | undefined)[];
    if (scope === 'team_channels' && sectionsEnabled()) {
      rendered = visibleRows()
        .filter((row) => row.group !== 'direct_messages')
        .map((row) => {
          if (row.kind === 'conversation') return row.channel.id;
          if (row.kind === 'favorite') return row.favorite.entityId;
          return undefined;
        });
    } else if (scope === 'team_channels') {
      rendered = channelSectionRows().map((row) =>
        row.kind === 'conversation' ? row.channel.id : undefined
      );
    } else if (scope === 'direct_messages' && sectionsEnabled()) {
      rendered = visibleRows().flatMap((row) =>
        row.kind === 'conversation' && row.scope === 'direct_messages'
          ? [row.channel.id]
          : []
      );
    } else {
      rendered = props.sources[scope].items().map((channel) => channel.id);
    }

    const selectedIndex = rendered.indexOf(selectedChannel()?.id ?? '');

    const targetIndex = selectedIndex >= 0 ? selectedIndex : 0;
    const virtualizer = virtualizers()[scope];

    if (virtualizer && rendered.length > 0) {
      virtualizer.scrollToIndex(targetIndex, {
        align: selectedIndex >= 0 ? 'nearest' : 'start',
      });
      return;
    }

    const scrollRoot =
      scope === 'recents' ? listRoot() : sectionScrollRoots()[scope];
    if (scrollRoot?.isConnected) scrollRoot.scrollTop = 0;
  };

  const scrollThreadsToSelectedOrStart = () => {
    const items = props.sources.threads.items();
    const selectedIndex = items.findIndex(
      (channel) => channel.id === threadsChannelId()
    );
    const virtualizer = virtualizers().threads;
    if (!virtualizer || items.length === 0) return;

    virtualizer.scrollToIndex(selectedIndex >= 0 ? selectedIndex : 0, {
      align: selectedIndex >= 0 ? 'nearest' : 'start',
    });
  };

  const scrollSearchToSelectedOrStart = () => {
    const items = searchResults();

    const selectedIndex = items.findIndex(
      (channel) => channel.id === selectedChannel()?.id
    );

    const virtualizer = virtualizers().search;
    if (!virtualizer || items.length === 0) return;

    virtualizer.scrollToIndex(selectedIndex >= 0 ? selectedIndex : 0, {
      align: selectedIndex >= 0 ? 'nearest' : 'start',
    });
  };

  const scrollFavoritesToSelectedOrStart = () => {
    const scrollRoot = sectionScrollRoots().favorites;
    if (!scrollRoot?.isConnected) return;
    scrollRoot.scrollTop = 0;
    const favorite = favorites().find(
      (item) =>
        item.entityType === 'channel' && item.entityId === selectedChannel()?.id
    );
    if (!favorite) return;
    const element = document.getElementById(
      domIdForRow(listDomId, rowKeyForFavorite(favorite))
    );
    if (!element) return;
    scrollRoot.scrollTop += Math.max(
      0,
      element.getBoundingClientRect().bottom -
        scrollRoot.getBoundingClientRect().bottom
    );
  };
  createEffect(() => {
    if (!restoreListScroll()) return;

    const searchOpen = props.searchOpen;
    const sourcesReady = searchOpen
      ? !props.sources.search.isLoading()
      : tab() === 'recents'
        ? !props.sources.recents.isLoading()
        : tab() === 'threads'
          ? !props.sources.threads.isLoading()
          : BROWSE_QUERY_SCOPES.every(
              (scope) => !props.sources[scope].isLoading()
            );
    if (!sourcesReady) return;

    const frame = requestAnimationFrame(() => {
      if (props.searchOpen !== searchOpen) return;

      if (searchOpen) {
        scrollSearchToSelectedOrStart();
      } else if (tab() === 'recents') {
        scrollScopeToSelectedOrStart('recents');
      } else if (tab() === 'threads') {
        scrollThreadsToSelectedOrStart();
      } else {
        if (sectionsEnabled()) {
          scrollScopeToSelectedOrStart('team_channels');
          scrollScopeToSelectedOrStart('direct_messages');
        } else {
          scrollFavoritesToSelectedOrStart();
          for (const scope of BROWSE_QUERY_SCOPES)
            scrollScopeToSelectedOrStart(scope);
        }
      }
      setRestoreListScroll(false);
    });
    onCleanup(() => cancelAnimationFrame(frame));
  });

  useViewTabHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: () => panel.isPanelActive() && !sectionsEnabled(),
    ids: () =>
      threadsEnabled() ? CHANNEL_TAB_IDS_WITH_THREADS : CHANNEL_TAB_IDS,
    activeId: tab,
    setActiveId: selectTab,
  });
  useViewControlHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    search: {
      description: 'Search channels and direct messages',
      run: () => {
        openSearch();
        return true;
      },
    },
  });

  withSplitPanelOwner(listOwnedSlotName('navigation-hotkeys'), () =>
    useListInteractions({
      controller: list,
      scopeId: panel.splitHotkeyScope,
      scrollHandle: () => scrollHandle,
      enabled: panel.isPanelActive,
      conditions: {
        open: () =>
          !document.activeElement?.closest('[data-live-calls-sidebar]'),
      },
      navigation: {
        onBeforeMove: ({ direction, current }) => {
          if (props.searchOpen) return true;

          const row = current?.item;
          if (direction !== 1 || !row) return true;
          const scope = sectionsEnabled()
            ? getChannelRailPaginationScope(
                row,
                visibleRows(),
                state.expandedGroups
              )
            : row.kind === 'conversation' &&
                row.localIndex >=
                  (row.scope === 'team_channels'
                    ? channelSectionRows().length
                    : props.sources[row.scope].items().length) -
                    1
              ? row.scope
              : undefined;
          if (!scope) return true;
          const source = props.sources[scope];

          if (!source.isLoadingMore()) {
            if (!source.hasMore()) return true;
            fireAndForget(source.loadMore(), 'channels-view');
          }

          if (row.kind === 'conversation' && scope === 'direct_messages') {
            requestAnimationFrame(() => {
              const scrollRoot = sectionScrollRoots().direct_messages;
              const element = document.getElementById(
                domIdForRow(listDomId, row.id)
              );
              if (!scrollRoot || !element) return;

              const scrollBounds = scrollRoot.getBoundingClientRect();
              const elementBounds = element.getBoundingClientRect();
              const previewOffset = Math.max(
                0,
                Math.min(
                  DM_LOADING_PREVIEW_OFFSET,
                  scrollBounds.height - elementBounds.height
                )
              );
              scrollRoot.scrollTop += Math.max(
                0,
                elementBounds.bottom + previewOffset - scrollBounds.bottom
              );
            });
          }

          return false;
        },
        onNavigate: (event) => {
          activation++;
          listRoot()?.focus({ preventScroll: true });
          previewAfterNavigation.clear();

          const row = event.result?.item;
          if (tab() === 'threads') {
            if (row?.kind === 'all-threads') setThreadsChannelId(undefined);
            else if (row?.kind === 'conversation')
              setThreadsChannelId(row.channel.id);
          } else if (row?.kind === 'conversation') {
            previewAfterNavigation(row.channel);
          } else if (
            row?.kind === 'favorite' &&
            row.favorite.entityType === 'channel'
          ) {
            previewAfterNavigation({
              type: 'channel',
              id: row.favorite.entityId,
            });
          }
        },
      },
      activation: {
        createMetadata: (intent) => ({ newSplit: intent === 'alternate' }),
        alternateDescription: 'Open in new split',
      },
      // Labels disclose like sections: `h`/`l` on a label heading or one of
      // its channels collapse or expand that label; anywhere else, the section.
      disclosure: {
        isHeader: (row) => row.kind === 'section' || row.kind === 'label',
        getKey: (row) =>
          row.kind === 'label'
            ? row.id
            : row.kind === 'conversation' && row.labelId
              ? rowKeyForLabel(row.labelId)
              : row.group,
        isExpanded: (key) =>
          key.startsWith(LABEL_KEY_PREFIX)
            ? isLabelOpen(key.slice(LABEL_KEY_PREFIX.length))
            : state.expandedGroups[key as ChannelsRailSection],
        setExpanded: (key, expanded) =>
          key.startsWith(LABEL_KEY_PREFIX)
            ? setLabelOpen(key.slice(LABEL_KEY_PREFIX.length), expanded)
            : setGroupOpen(key as ChannelsRailSection, expanded),
        getFocusKey: (key) =>
          key.startsWith(LABEL_KEY_PREFIX)
            ? rowKeyForLabel(key.slice(LABEL_KEY_PREFIX.length))
            : rowKeyForSection(key as ChannelsRailSection),
      },
    })
  );

  const jumpToSection = (offset: 1 | -1) => {
    const headers = list.items
      .all()
      .filter((row) => row.kind === 'section' || row.kind === 'label');
    const current = list.focus.item();
    const currentKey =
      current?.kind === 'conversation' && current.labelId
        ? rowKeyForLabel(current.labelId)
        : current?.group
          ? rowKeyForSection(current.group)
          : current?.id;
    const currentIndex = headers.findIndex((row) => row.id === currentKey);
    const origin = currentIndex === -1 ? (offset === 1 ? -1 : 0) : currentIndex;
    const nextIndex = (origin + offset + headers.length) % headers.length;
    const next = headers[nextIndex];
    if (!next) return false;
    const result = list.focus.set(next.id, { reason: 'keyboard' });
    if (!result) return false;

    listRoot()?.focus({ preventScroll: true });
    scrollHandle.scrollToIndex(result.index);
    return true;
  };

  const sectionHotkeys = createHotkeyGroup();
  const sectionHotkeysEnabled = () =>
    panel.isPanelActive() && !props.searchOpen && tab() === 'browse';

  registerHotkey({
    hotkey: ']',
    scopeId: panel.splitHotkeyScope,
    description: 'Next channel section',
    condition: sectionHotkeysEnabled,
    keyDownHandler: () => jumpToSection(1),
  }).withGroup(sectionHotkeys);
  registerHotkey({
    hotkey: '[',
    scopeId: panel.splitHotkeyScope,
    description: 'Previous channel section',
    condition: sectionHotkeysEnabled,
    keyDownHandler: () => jumpToSection(-1),
  }).withGroup(sectionHotkeys);
  onCleanup(() => sectionHotkeys.dispose());

  const activateRow = (rowId: ChannelRailRow['id'], event?: MouseEvent) => {
    list.activate.key(rowId, {
      reason: 'pointer',
      metadata: event ? { event } : undefined,
    });
  };

  // A mouse press reaches the server before the click that opens its channel.
  // Touch presses also start scrolls, which would fetch every row they cross.
  const prefetchRow = (rowId: ChannelRailRow['id'], event: PointerEvent) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    // Threads-tab rows filter the thread list in place.
    if (tab() === 'threads') return;
    const row = visibleRows().find((row) => row.id === rowId);
    if (row?.kind === 'conversation') {
      // A message target loads around that message instead.
      if (!row.channel.target) prefetchLatestChannelMessages(row.channel.id);
    } else if (
      row?.kind === 'favorite' &&
      row.favorite.entityType === 'channel'
    ) {
      prefetchLatestChannelMessages(row.favorite.entityId);
    }
  };

  const {
    createLabel,
    createSmartTag,
    renameLabel,
    deleteLabel,
    setChannelLabel,
    markLabelRead,
    canLabelChannelId,
    labelChannelById,
  } = useChannelLabelActions({
    sectionsEnabled,
    channelTagsEnabled,
    labelsAvailable,
    labelsUnavailableReason,
    sharedLabels,
    labels,
    channelsById,
    searchResults,
    labelDialogOwner,
    setGroupOpen,
    setLabelOpen,
  });

  // Drops are resolved here rather than per row so a channel dragged from
  // anywhere in the section lands the same way.
  const [dndState, dndActions] = useDragDropContext() ?? [];
  const canDropOnChannel = (sourceId: string, targetId: string) =>
    sourceId !== targetId && canLabelChannelId(targetId);
  // The highlight follows the whole target (a label with all its rows), not
  // the row under the cursor, so rows read this instead of their own state.
  const activeDropTarget = (): ChannelLabelDropTarget | undefined => {
    if (!channelTagsEnabled()) return undefined;
    const drag = dndState?.active.draggable?.data as
      | ChannelLabelDragData
      | undefined;
    if (drag?.dragType !== 'channel-label' || drag.dndScope !== listDomId)
      return undefined;
    if (!canLabelChannelId(drag.channelId)) return undefined;
    const drop = dndState?.active.droppable?.data as
      | ChannelLabelDropData
      | undefined;
    if (
      drop?.dragType !== 'channel-label-target' ||
      drop.dndScope !== listDomId
    )
      return undefined;
    if (drop.target.kind === 'smart-tag') return undefined;
    if (
      drop.target.kind === 'channel' &&
      !canDropOnChannel(drag.channelId, drop.target.channelId)
    )
      return undefined;
    if (drop.target.kind === 'label') {
      const labelId = drop.target.labelId;
      const label = labels().find((label) => label.id === labelId);
      if (!label || !canLabelChannel(labelChannelById(drag.channelId), label))
        return undefined;
    }
    if (drop.target.kind === 'label' && drop.target.labelId === drag.labelId)
      return undefined;
    if (drop.target.kind === 'unlabelled' && !drag.labelId) return undefined;
    return drop.target;
  };
  dndActions?.onDragEnd(({ draggable, droppable }) => {
    if (!channelTagsEnabled()) return;
    const drag = draggable?.data as ChannelLabelDragData | undefined;
    if (drag?.dragType !== 'channel-label' || drag.dndScope !== listDomId)
      return;
    if (!canLabelChannelId(drag.channelId)) return;
    // With labels unavailable every target reports itself disabled, so the
    // drag ends on nothing; say why rather than silently doing nothing.
    if (!labelsAvailable()) {
      toast.failure(labelsUnavailableReason());
      return;
    }
    if (!droppable) return;
    const drop = droppable.data as ChannelLabelDropData | undefined;
    if (
      drop?.dragType !== 'channel-label-target' ||
      drop.dndScope !== listDomId
    )
      return;

    const target = drop.target;
    if (target.kind === 'smart-tag') return;
    if (target.kind === 'label') {
      if (drag.labelId !== target.labelId) {
        setChannelLabel(drag.channelId, target.labelId);
      }
      return;
    }
    if (target.kind === 'unlabelled') {
      if (drag.labelId)
        setChannelLabel(drag.channelId, undefined, drag.labelId);
      return;
    }
    if (!canDropOnChannel(drag.channelId, target.channelId)) return;
    // Dragging a labelled channel onto the plain list takes it out of its
    // label; dropping one plain channel on another starts a label with both.
    if (drag.labelId) {
      setChannelLabel(drag.channelId, undefined, drag.labelId);
      return;
    }
    fireAndForget(
      createLabel([drag.channelId, target.channelId]),
      'channels-view'
    );
  });

  const registerVirtualizer = (
    scope: ChannelsSourceScope,
    handle: VirtualizerHandle
  ) => {
    setVirtualizers((current) => ({ ...current, [scope]: handle }));

    return () => {
      setVirtualizers((current) => {
        if (current[scope] !== handle) return current;

        const next = { ...current };
        delete next[scope];
        return next;
      });
    };
  };

  const rail: ChannelsRailContext = {
    railId: listDomId,
    list,
    sectionsEnabled,
    tab,
    selectTab,
    sources: props.sources,
    favorites,
    channelById,
    selectedChannel,
    threadsEnabled,
    threadsChannelId,
    isGroupOpen: (group) => state.expandedGroups[group],
    toggleGroup: (group) => setGroupOpen(group, !state.expandedGroups[group]),
    channelTagsEnabled,
    labels,
    labelsAvailable,
    labelsUnavailableReason,
    retryLabels: async () => {
      await labelsQuery.refetch();
      if (sectionsEnabled()) await personalLabelsQuery.refetch();
    },
    retryReferencedChannels: nextReferencedChannels.retry,
    isLabelOpen,
    toggleLabel: (labelId) => setLabelOpen(labelId, !isLabelOpen(labelId)),
    channelSectionRows,
    labelUnreadCount,
    createLabel,
    createSmartTag,
    editSmartTag: renameLabel,
    canShareSections: () => sharedLabels(),
    renameLabel,
    deleteLabel,
    setChannelLabel,
    activeDropTarget,
    markLabelRead,
    sortBy: (group) => state.sortBy[group],
    setSortBy,
    sectionPreferences: (section) => ({
      sort:
        section === 'team_channels' ||
        section === 'channels' ||
        section === 'direct_messages'
          ? state.sortBy[section]
          : 'name',
      ...state.sectionPreferences[section],
    }),
    setSectionPreferences: (section, preferences) => {
      if (
        preferences.sort &&
        preferences.sort !== 'name' &&
        (section === 'team_channels' ||
          section === 'channels' ||
          section === 'direct_messages')
      ) {
        setSortBy(section, preferences.sort);
      }
      setSectionPreferences(section, preferences);
    },
    registerRootRef: setListRoot,
    activateRow,
    prefetchRow,
    registerScrollRef: (group, element) => {
      setSectionScrollRoots((current) => ({
        ...current,
        [group]: element,
      }));
    },
    registerVirtualizer,
    channelActivity,
  };

  const search = {
    isOpen: () => props.searchOpen,
    query: searchQuery,
    results: searchResults,
    isLoading: searchLoading,
    error: searchError,
    open: openSearch,
    close: closeSearch,
    setQuery: setSearchQuery,
    registerInput: (element: HTMLInputElement) => {
      searchInput = element;
    },
    retry: retrySearch,
  };
  return (
    <ChannelsRailProvider value={rail}>
      <aside
        aria-label="Chat navigation"
        class="flex size-full min-h-0 flex-col gap-3 bg-panel"
      >
        <Show
          when={sectionsEnabled()}
          fallback={<ExpandedChannelsRail search={search} />}
        >
          <NextChannelsRail search={search} />
        </Show>
      </aside>
    </ChannelsRailProvider>
  );
}
