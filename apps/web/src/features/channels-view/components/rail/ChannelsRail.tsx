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
import { QUERY_FILTERS_BASE } from '@app/features/next-soup/filters/query-filters';
import type { ChannelPreviewSelection } from '@app/features/next-soup/utils';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { favoriteSplitContent } from '@app/util/favorites';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { useSplitLayout } from '@components/app/split-layout/layout';
import {
  useSplitPanelOrThrow,
  withSplitPanelOwner,
} from '@components/app/split-layout/layoutUtils';
import { toast } from '@core/component/Toast/Toast';
import { enableChannelTags } from '@core/constant/featureFlags';
import { createHotkeyGroup, registerHotkey } from '@core/hotkey/hotkeys';
import { debouncedDependent } from '@core/util/debounce';
import { thrownResultErrorHasCode } from '@core/util/result';
import { type ChannelEntity, isChannelEntity, type WithSearch } from '@entity';
import { notificationIsRead } from '@entity/utils/notification';
import { ensureNotificationSourceLoaded } from '@notifications/notification-helpers';
import {
  useChannelLabelsQuery,
  useCreateChannelLabelMutation,
  useDeleteChannelLabelMutation,
  useRenameChannelLabelMutation,
  useSetChannelLabelMutation,
} from '@queries/channel-labels/channel-labels';
import { useFavoritesData } from '@queries/favorites/favorites';
import { useSearchSoupQuery } from '@queries/soup/search';
import type { EntityFilters } from '@service-search/generated/models';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import { debounce } from '@solid-primitives/scheduled';
import { useDragDropContext } from '@thisbeyond/solid-dnd';
import { confirmDialog } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  getOwner,
  onCleanup,
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
  useChannelsByIdsQuery,
} from '../../queries';
import type {
  ChannelsQueryScope,
  ChannelsRailSection,
  ChannelsTab,
} from '../../types';
import {
  buildChannelRailRows,
  buildChannelSectionRows,
} from './build-channel-rail-rows';
import { promptLabelName } from './ChannelLabelNameDialog';
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
import { promptSmartTag } from './SmartTagDialog';

export { buildChannelRailRows } from './build-channel-rail-rows';

import { useChannelCalls } from './hooks/useChannelCalls';
import { useChannelRailActivity } from './hooks/useChannelRailActivity';

const CHANNEL_RAIL_SECTIONS: ChannelsRailSection[] = [
  'favorites',
  'channels',
  'direct_messages',
];
const LABEL_KEY_PREFIX = 'label:';
const BROWSE_QUERY_SCOPES = ['channels', 'direct_messages'] as const;
const CHANNEL_TAB_IDS: ChannelsTab[] = ['browse', 'recents'];
const DM_LOADING_PREVIEW_OFFSET = 80;
const CHANNEL_SEARCH_FILTERS = {
  ...QUERY_FILTERS_BASE,
  channel_filters: { is_participant: true },
} satisfies EntityFilters;

export type ChannelsRailProps = {
  sources: ChannelsSources;
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
};

export function ChannelsRail(props: ChannelsRailProps) {
  const channelTagsFlag = useFeatureFlag(enableChannelTags);
  const channelTagsEnabled = createMemo(() => channelTagsFlag().enabled);
  // The dialog manager closes entries when their owner is disposed. Give
  // label dialogs an owner that is cleaned up when the rollout turns off.
  const labelDialogOwner = createMemo(() =>
    channelTagsEnabled() ? getOwner() : undefined
  );
  const {
    state,
    setGroupOpen,
    setLabelOpen,
    selectedChannel,
    setSelectedChannel,
    setSortBy,
    setTab,
  } = useChannelsView();

  const panel = useSplitPanelOrThrow();
  const layout = useSplitLayout();
  const notificationSource = useGlobalNotificationSource();

  const favoritesData = useFavoritesData({ entityType: ['channel'] });

  const listDomId = createUniqueId();

  const [sectionScrollRoots, setSectionScrollRoots] = createSignal<
    Partial<Record<ChannelsRailSection, HTMLDivElement>>
  >({});

  const [listRoot, setListRoot] = createSignal<HTMLDivElement>();
  const [virtualizers, setVirtualizers] = createSignal<
    Partial<Record<ChannelsSourceScope, VirtualizerHandle>>
  >({});

  const [searchQuery, setSearchQuery] = createSignal('');

  const [restoreListScroll, setRestoreListScroll] = createSignal(false);

  const normalizedSearchQuery = () => searchQuery().trim();

  const serviceSearchQuery = debouncedDependent(normalizedSearchQuery, 300);

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
      props.sources.channels.items(),
      props.sources.direct_messages.items(),
      props.sources.recents.items(),
      props.sources.search.items(),
    ])
  );

  const channelSearchQuery = useSearchSoupQuery(
    () => ({
      params: { page_size: 100 },
      body: {
        query: serviceSearchQuery(),
        match_type: 'partial',
        search_on: 'name',
        filters: CHANNEL_SEARCH_FILTERS,
      },
    }),
    () => ({
      enabled:
        props.searchOpen && normalizedSearchQuery() === serviceSearchQuery(),
    })
  );

  const localSearchResults = createMemo(() => {
    const query = normalizedSearchQuery().toLocaleLowerCase();
    const items = props.sources.search.items();
    if (!query) return items;

    return items.filter((channel) =>
      channel.name.toLocaleLowerCase().includes(query)
    );
  });

  const serviceSearchResults = createMemo(() => {
    if (
      normalizedSearchQuery() !== serviceSearchQuery() ||
      channelSearchQuery.isFetching ||
      !channelSearchQuery.isSuccess
    ) {
      return [];
    }

    return channelSearchQuery.data.filter(
      (entity): entity is WithSearch<ChannelEntity> => isChannelEntity(entity)
    );
  });

  const searchResults = createMemo(() =>
    deduplicateChannels([localSearchResults(), serviceSearchResults()])
  );

  const searchLoading = () =>
    props.sources.search.isLoading() ||
    (normalizedSearchQuery().length >= 3 &&
      (normalizedSearchQuery() !== serviceSearchQuery() ||
        channelSearchQuery.isFetching));

  const searchError = () => {
    if (
      normalizedSearchQuery() === serviceSearchQuery() &&
      channelSearchQuery.error instanceof Error
    ) {
      return channelSearchQuery.error;
    }

    return props.sources.search.error() ?? undefined;
  };

  const retrySearch = async () => {
    await props.sources.search.refresh();
    if (normalizedSearchQuery().length >= 3) {
      await channelSearchQuery.refetch();
    }
  };

  // Shared or private labels; channel membership is always viewer-relative.
  const labelsQuery = useChannelLabelsQuery();
  const labels = createMemo<readonly ChannelLabel[]>(() =>
    resolveChannelLabelMemberships(
      channelTagsEnabled() && labelsQuery.isSuccess
        ? labelsQuery.data.labels
        : [],
      channels()
    )
  );
  const labelsAvailable = () => channelTagsEnabled() && labelsQuery.isSuccess;
  const labelsUnavailableReason = () => {
    if (labelsQuery.isSuccess) return '';
    if (labelsQuery.isPending) return 'Loading labels…';
    const error = labelsQuery.error;
    if (
      thrownResultErrorHasCode(error, 'UNAUTHORIZED') ||
      thrownResultErrorHasCode(error, 'FORBIDDEN')
    ) {
      return 'You do not have access to these labels.';
    }
    if (thrownResultErrorHasCode(error, 'NOT_FOUND')) {
      return 'Channel labels are not available on this server yet.';
    }
    return 'Channel labels are unavailable right now.';
  };

  // A labelled channel renders under its label even before the paginated
  // Channels source reaches it, so fetch the ones the sources have not loaded.
  const labelledChannelIds = createMemo(() => [
    ...new Set(labels().flatMap((label) => label.channelIds)),
  ]);
  const missingLabelledIds = createMemo(() => {
    const loaded = new Set(channels().map((channel) => channel.id));
    return labelledChannelIds().filter((id) => !loaded.has(id));
  });
  const labelledChannelsQuery = useChannelsByIdsQuery(missingLabelledIds);
  const labelledChannels = createMemo<ChannelEntity[]>((previous) => {
    if (!channelTagsEnabled()) return [];
    if (!labelledChannelsQuery.isEnabled || labelledChannelsQuery.isLoading)
      return previous;
    return deduplicateChannels([
      (labelledChannelsQuery.data?.entities ?? []).filter(isChannelEntity),
      previous,
    ]);
  }, []);

  const allChannels = createMemo(() =>
    deduplicateChannels([channels(), labelledChannels()])
  );
  const channelsById = createMemo(
    () => new Map(allChannels().map((channel) => [channel.id, channel]))
  );

  const channelActivity = useChannelRailActivity(allChannels, channelCalls);

  const favorites = createMemo(() => favoritesData()?.favorites ?? []);

  const isLabelOpen = (labelId: string) =>
    !state.collapsedLabels.includes(labelId);

  const channelSectionRows = createMemo(() =>
    buildChannelSectionRows({
      labels: labels(),
      channels: deduplicateChannels([
        props.sources.channels.items(),
        labelledChannels(),
      ]),
      channelsById: channelsById(),
      isLabelOpen,
    })
  );

  const labelUnreadCount = (label: ChannelLabel) => {
    const unread = channelActivity.unreadChannelIds();
    return filterChannelLabelMembers(label.channelIds, channelsById()).filter(
      (id) => unread.has(id)
    ).length;
  };

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

    return buildChannelRailRows(
      state.tab,
      state.expandedGroups,
      {
        favorites: favorites(),
        channels: props.sources.channels.items(),
        direct_messages: props.sources.direct_messages.items(),
        recents: props.sources.recents.items(),
      },
      channelSectionRows()
    );
  });

  const initialSelectedChannelId = selectedChannel()?.id;
  const list = withSplitPanelOwner(listOwnedSlotName('controller'), () =>
    createListController<ChannelRailRow, ChannelRailActivationMetadata>({
      items: visibleRows,
      getKey: (row) => row.id,
      isSelectable: () => false,
      initialFocusKey: visibleRows().find(
        (row) =>
          row.kind === 'conversation' &&
          row.channel.id === initialSelectedChannelId
      )?.id,
      onActivate: ({ item, metadata }) => {
        previewAfterNavigation.clear();
        const openInNewSplit =
          metadata?.newSplit === true || metadata?.event?.shiftKey === true;

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

        if (openInNewSplit) {
          layout.openWithSplit(
            { type: 'channel', id: channelId },
            { preferNewSplit: true, referredFrom: 'channels' }
          );
          return;
        }

        setSelectedChannel(
          item.kind === 'conversation'
            ? item.channel
            : { type: 'channel', id: channelId }
        );
      },
    })
  );

  const scrollHandle: ListScrollHandle = {
    scrollToIndex: (index, options) => {
      const row = list.items.at(index);
      if (!row) return;

      if (row.kind === 'conversation' || row.kind === 'label') {
        const virtualizer =
          virtualizers()[row.kind === 'label' ? 'channels' : row.scope];
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
            : state.tab === 'recents'
              ? listRoot()
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
    // The Channels section renders label headings between channels, so its
    // indexes come from the rendered rows rather than the source.
    const rendered =
      scope === 'channels'
        ? channelSectionRows().map((row) =>
            row.kind === 'conversation' ? row.channel.id : undefined
          )
        : props.sources[scope].items().map((channel) => channel.id);

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

    const elementBounds = element.getBoundingClientRect();
    const scrollBounds = scrollRoot.getBoundingClientRect();

    if (elementBounds.bottom > scrollBounds.bottom) {
      scrollRoot.scrollTop += elementBounds.bottom - scrollBounds.bottom;
    }
  };

  createEffect(() => {
    if (!restoreListScroll()) return;

    const searchOpen = props.searchOpen;
    const sourcesReady = searchOpen
      ? !props.sources.search.isLoading()
      : state.tab === 'recents'
        ? !props.sources.recents.isLoading()
        : BROWSE_QUERY_SCOPES.every(
            (scope) => !props.sources[scope].isLoading()
          );
    if (!sourcesReady) return;

    const frame = requestAnimationFrame(() => {
      if (props.searchOpen !== searchOpen) return;

      if (searchOpen) {
        scrollSearchToSelectedOrStart();
      } else if (state.tab === 'recents') {
        scrollScopeToSelectedOrStart('recents');
      } else {
        scrollFavoritesToSelectedOrStart();
        for (const scope of BROWSE_QUERY_SCOPES) {
          scrollScopeToSelectedOrStart(scope);
        }
      }
      setRestoreListScroll(false);
    });
    onCleanup(() => cancelAnimationFrame(frame));
  });

  useViewTabHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    ids: () => CHANNEL_TAB_IDS,
    activeId: () => state.tab,
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
      navigation: {
        onBeforeMove: ({ direction, current }) => {
          if (props.searchOpen) return true;

          const row = current?.item;
          if (direction !== 1 || row?.kind !== 'conversation') return true;

          const source = props.sources[row.scope];
          const renderedCount =
            row.scope === 'channels'
              ? channelSectionRows().length
              : source.items().length;
          if (row.localIndex < renderedCount - 1) return true;

          if (!source.isLoadingMore()) {
            if (!source.hasMore()) return true;
            void source.loadMore();
          }

          if (row.scope === 'direct_messages') {
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
          listRoot()?.focus({ preventScroll: true });
          previewAfterNavigation.clear();

          const row = event.result?.item;
          if (row?.kind === 'conversation') {
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
    const currentGroup = list.focus.item()?.group;

    const sections = CHANNEL_RAIL_SECTIONS.filter((section) =>
      section === 'favorites' ? favorites().length > 0 : true
    );

    const currentIndex = currentGroup ? sections.indexOf(currentGroup) : -1;
    const origin = currentIndex === -1 ? (offset === 1 ? -1 : 0) : currentIndex;
    const nextIndex = (origin + offset + sections.length) % sections.length;
    const nextGroup = sections[nextIndex];
    if (!nextGroup) return false;

    const result = list.focus.set(rowKeyForSection(nextGroup), {
      reason: 'keyboard',
    });
    if (!result) return false;

    listRoot()?.focus({ preventScroll: true });
    scrollHandle.scrollToIndex(result.index);
    return true;
  };

  const sectionHotkeys = createHotkeyGroup();
  const sectionHotkeysEnabled = () =>
    panel.isPanelActive() && !props.searchOpen && state.tab === 'browse';

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

  // Explain shared versus private scope before creating or changing labels.
  const createLabelMutation = useCreateChannelLabelMutation();
  const renameLabelMutation = useRenameChannelLabelMutation();
  const deleteLabelMutation = useDeleteChannelLabelMutation();
  const setChannelLabelMutation = useSetChannelLabelMutation();

  const errorMessage = (error: unknown, fallback: string) => {
    if (
      thrownResultErrorHasCode(error, 'UNAUTHORIZED') ||
      thrownResultErrorHasCode(error, 'FORBIDDEN')
    ) {
      return 'You do not have access to these labels.';
    }
    const message = error instanceof Error ? error.message : '';
    return message || fallback;
  };
  const labelChannelById = (channelId: string) =>
    channelsById().get(channelId) ??
    serviceSearchResults().find((channel) => channel.id === channelId);
  const channelName = (channelId: string) => {
    const name = labelChannelById(channelId)?.name;
    return name ? `#${name}` : 'the channel';
  };
  const canLabelChannelId = (channelId: string) =>
    canLabelChannel(labelChannelById(channelId));

  const sharedLabels = () =>
    labelsQuery.isSuccess && Boolean(labelsQuery.data.teamId);
  const labelScopeDescription = () =>
    sharedLabels()
      ? 'Labels are shared with everyone on your team.'
      : 'Labels are private to your account.';

  const createLabel = async (channelIds: string[]) => {
    if (!channelTagsEnabled()) return;
    if (!channelIds.every(canLabelChannelId)) return;
    if (!labelsAvailable()) {
      toast.failure(labelsUnavailableReason());
      return;
    }
    const names = channelIds
      .map((id) => labelChannelById(id)?.name)
      .filter((name): name is string => Boolean(name))
      .map((name) => `#${name}`);
    const grouping =
      names.length > 1
        ? ` It will start with ${names.slice(0, -1).join(', ')} and ${names.at(-1)}.`
        : names.length === 1
          ? ` It will start with ${names[0]}.`
          : '';
    const name = await promptLabelName(
      {
        title: 'New label',
        body: `${labelScopeDescription()}${grouping}`,
        confirmLabel: 'Create label',
        onConfirm: async (name) => {
          if (!channelTagsEnabled())
            throw new Error('Channel tags are disabled.');
          if (!channelIds.every(canLabelChannelId))
            throw new Error('Only team channels can be added to labels.');
          const created = await createLabelMutation.mutateAsync({
            name,
            channelIds,
          });
          setGroupOpen('channels', true);
          setLabelOpen(created.id, true);
        },
      },
      { owner: labelDialogOwner() }
    );
    if (!name) return;
    toast.success(
      channelIds.length > 1
        ? `Grouped ${channelIds.length} channels under “${name}”`
        : `Created “${name}”`
    );
  };

  const createSmartTag = async () => {
    if (!channelTagsEnabled()) return;
    if (!labelsAvailable()) {
      toast.failure(labelsUnavailableReason());
      return;
    }
    await promptSmartTag(
      {
        scopeDescription: labelScopeDescription(),
        onConfirm: async (name, rule) => {
          if (!channelTagsEnabled())
            throw new Error('Channel tags are disabled.');
          const created = await createLabelMutation.mutateAsync({
            name,
            rule,
            channelIds: [],
          });
          setGroupOpen('channels', true);
          setLabelOpen(created.id, true);
          toast.success(`Created “${name}”`);
        },
      },
      { owner: labelDialogOwner() }
    );
  };

  const editSmartTag = async (label: ChannelLabel) => {
    if (!channelTagsEnabled() || !label.rule) return;
    await promptSmartTag(
      {
        scopeDescription: labelScopeDescription(),
        initial: { name: label.name, rule: label.rule },
        onConfirm: async (name, rule) => {
          if (!channelTagsEnabled())
            throw new Error('Channel tags are disabled.');
          await renameLabelMutation.mutateAsync({
            labelId: label.id,
            name,
            rule,
          });
          toast.success(`Updated “${name}”`);
        },
      },
      { owner: labelDialogOwner() }
    );
  };

  const renameLabel = async (label: ChannelLabel) => {
    if (!channelTagsEnabled()) return;
    const name = await promptLabelName(
      {
        title: 'Rename label',
        body: labelScopeDescription(),
        confirmLabel: 'Rename',
        initialValue: label.name,
        onConfirm: async (name) => {
          if (!channelTagsEnabled())
            throw new Error('Channel tags are disabled.');
          await renameLabelMutation.mutateAsync({ labelId: label.id, name });
        },
      },
      { owner: labelDialogOwner() }
    );
    if (!name || name === label.name) return;
    toast.success(`Renamed to “${name}”`);
  };

  const deleteLabel = async (label: ChannelLabel) => {
    if (!channelTagsEnabled()) return;
    const channelsText = label.rule
      ? 'Channels stop appearing in this smart label. Other labels are unchanged.'
      : label.channelCount === 0
        ? 'It has no channels in it.'
        : label.channelCount === 1
          ? 'Its 1 channel goes back to the main Channels list.'
          : `Its ${label.channelCount} channels go back to the main Channels list.`;
    const confirmed = await confirmDialog(
      {
        title: `Delete “${label.name}”?`,
        body: `${labelScopeDescription()} ${channelsText} Nobody loses access to a channel.`,
        confirmLabel: sharedLabels() ? 'Delete for everyone' : 'Delete label',
        cancelLabel: 'Cancel',
        tone: 'danger',
      },
      { owner: labelDialogOwner() }
    );
    if (!confirmed || !channelTagsEnabled()) return;
    try {
      await deleteLabelMutation.mutateAsync({ labelId: label.id });
      toast.success(`Deleted “${label.name}”`);
    } catch (error) {
      toast.failure(errorMessage(error, 'Failed to delete label'));
    }
  };

  const setChannelLabel = (channelId: string, labelId: string | undefined) => {
    if (!channelTagsEnabled() || !canLabelChannelId(channelId)) return;
    const from = labels().find(
      (label) => !label.rule && label.channelIds.includes(channelId)
    );
    const to = labelId
      ? labels().find((label) => label.id === labelId)
      : undefined;
    if (to?.rule || from?.id === labelId) return;
    if (labelId) setLabelOpen(labelId, true);
    setChannelLabelMutation.mutate(
      { channelId, labelId },
      {
        onSuccess: () => {
          if (to) {
            toast.success(`Moved ${channelName(channelId)} to “${to.name}”`);
          } else if (from) {
            toast.success(
              `Removed ${channelName(channelId)} from “${from.name}”`
            );
          }
        },
        onError: (error) =>
          toast.failure(errorMessage(error, 'Failed to move channel')),
      }
    );
  };

  const markLabelRead = async (label: ChannelLabel) => {
    if (!channelTagsEnabled()) return;
    const channelIds = new Set(
      filterChannelLabelMembers(label.channelIds, channelsById())
    );
    if (channelIds.size === 0) return;
    try {
      await ensureNotificationSourceLoaded(notificationSource);
      const unread = notificationSource
        .notifications()
        .filter(
          (notification) =>
            notification.entity_type === 'channel' &&
            channelIds.has(notification.entity_id) &&
            !notificationIsRead(notification)
        );
      await notificationSource.bulkMarkAsRead(unread);
    } catch (error) {
      toast.failure(
        errorMessage(error, 'Failed to mark channel label as read')
      );
    }
  };

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
      if (drag.labelId) setChannelLabel(drag.channelId, undefined);
      return;
    }
    if (!canDropOnChannel(drag.channelId, target.channelId)) return;
    // Dragging a labelled channel onto the plain list takes it out of its
    // label; dropping one plain channel on another starts a label with both.
    if (drag.labelId) {
      setChannelLabel(drag.channelId, undefined);
      return;
    }
    void createLabel([drag.channelId, target.channelId]);
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
    tab: () => state.tab,
    selectTab,
    sources: props.sources,
    favorites,
    selectedChannel,
    isGroupOpen: (group) => state.expandedGroups[group],
    toggleGroup: (group) => setGroupOpen(group, !state.expandedGroups[group]),
    channelTagsEnabled,
    labels,
    labelsAvailable,
    labelsUnavailableReason,
    isLabelOpen,
    toggleLabel: (labelId) => setLabelOpen(labelId, !isLabelOpen(labelId)),
    channelSectionRows,
    labelUnreadCount,
    createLabel,
    createSmartTag,
    editSmartTag,
    renameLabel,
    deleteLabel,
    setChannelLabel,
    activeDropTarget,
    markLabelRead,
    sortBy: (group) => state.sortBy[group],
    setSortBy,
    registerRootRef: setListRoot,
    activateRow,
    registerScrollRef: (group, element) => {
      setSectionScrollRoots((current) => ({
        ...current,
        [group]: element,
      }));
    },
    registerVirtualizer,
    channelActivity,
  };

  return (
    <ChannelsRailProvider value={rail}>
      <aside
        aria-label="Chat navigation"
        class="flex size-full min-h-0 flex-col gap-3 bg-panel"
      >
        <ExpandedChannelsRail
          search={{
            isOpen: () => props.searchOpen,
            query: searchQuery,
            results: searchResults,
            isLoading: searchLoading,
            error: searchError,
            open: openSearch,
            close: closeSearch,
            setQuery: setSearchQuery,
            registerInput: (element) => {
              searchInput = element;
            },
            retry: retrySearch,
          }}
        />
      </aside>
    </ChannelsRailProvider>
  );
}
