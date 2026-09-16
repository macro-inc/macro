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
import { favoriteSplitContent } from '@app/util/favorites';
import { useSplitLayout } from '@components/app/split-layout/layout';
import {
  useSplitPanelOrThrow,
  withSplitPanelOwner,
} from '@components/app/split-layout/layoutUtils';
import { createHotkeyGroup, registerHotkey } from '@core/hotkey/hotkeys';
import { debouncedDependent } from '@core/util/debounce';
import { type ChannelEntity, isChannelEntity, type WithSearch } from '@entity';
import { useFavoritesData } from '@queries/favorites/favorites';
import { useSearchSoupQuery } from '@queries/soup/search';
import type { EntityFilters } from '@service-search/generated/models';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { debounce } from '@solid-primitives/scheduled';
import {
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  on,
  onCleanup,
} from 'solid-js';
import type { VirtualizerHandle } from 'virtua/solid';
import { useChannelsView } from '../../channels-view-context';
import {
  type ChannelsSourceScope,
  type ChannelsSources,
  deduplicateChannels,
} from '../../queries';
import type {
  ChannelsQueryScope,
  ChannelsRailSection,
  ChannelsTab,
} from '../../types';
import {
  type ChannelRailRow,
  type ChannelsRailContext,
  ChannelsRailProvider,
  domIdForRow,
  rowKeyForChannel,
  rowKeyForFavorite,
  rowKeyForSection,
} from './ChannelsRailContext';
import { ExpandedChannelsRail } from './ExpandedChannelsRail';
import { useChannelCalls } from './hooks/useChannelCalls';
import { useChannelRailActivity } from './hooks/useChannelRailActivity';
import { SlimChannelsRail } from './SlimChannelsRail';

const CHANNEL_RAIL_SECTIONS: ChannelsRailSection[] = [
  'favorites',
  'channels',
  'direct_messages',
];
const BROWSE_QUERY_SCOPES = ['channels', 'direct_messages'] as const;
const CHANNEL_TAB_IDS: ChannelsTab[] = ['browse', 'recents'];
const DM_LOADING_PREVIEW_OFFSET = 80;
const CHANNEL_SEARCH_FILTERS = {
  ...QUERY_FILTERS_BASE,
  channel_filters: { is_participant: true },
} satisfies EntityFilters;

export type ChannelsRailProps = {
  sources: ChannelsSources;
  mode: 'full' | 'slim';
  onModeChange: (mode: 'full' | 'slim') => void;
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
};

type ChannelRailItemsByScope = Record<
  ChannelsQueryScope,
  readonly ChannelEntity[]
> & {
  favorites: readonly Favorite[];
};

export function buildChannelRailRows(
  tab: ChannelsTab,
  expandedGroups: Record<ChannelsRailSection, boolean>,
  items: ChannelRailItemsByScope
): ChannelRailRow[] {
  if (tab === 'recents') {
    return items.recents.map((channel, localIndex) => ({
      kind: 'conversation',
      id: `channel:${channel.id}`,
      scope: 'recents',
      localIndex,
      channel,
    }));
  }

  const rows: ChannelRailRow[] = [];
  if (items.favorites.length > 0) {
    rows.push({
      kind: 'section',
      id: 'section:favorites',
      group: 'favorites',
    });
    if (expandedGroups.favorites) {
      rows.push(
        ...items.favorites.map(
          (favorite): ChannelRailRow => ({
            kind: 'favorite',
            id: rowKeyForFavorite(favorite),
            group: 'favorites',
            favorite,
          })
        )
      );
    }
  }

  rows.push({
    kind: 'section',
    id: 'section:channels',
    group: 'channels',
  });
  if (expandedGroups.channels) {
    rows.push(
      ...items.channels.map(
        (channel, localIndex): ChannelRailRow => ({
          kind: 'conversation',
          id: `channel:${channel.id}`,
          group: 'channels',
          scope: 'channels',
          localIndex,
          channel,
        })
      )
    );
  }

  rows.push({
    kind: 'section',
    id: 'section:direct_messages',
    group: 'direct_messages',
  });
  if (expandedGroups.direct_messages) {
    rows.push(
      ...items.direct_messages.map(
        (channel, localIndex): ChannelRailRow => ({
          kind: 'conversation',
          id: `channel:${channel.id}`,
          group: 'direct_messages',
          scope: 'direct_messages',
          localIndex,
          channel,
        })
      )
    );
  }

  return rows;
}

export function ChannelsRail(props: ChannelsRailProps) {
  const { state, setGroupOpen, setSelectedChannelId, setTab } =
    useChannelsView();
  const panel = useSplitPanelOrThrow();
  const layout = useSplitLayout();
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
  const previewAfterNavigation = debounce(setSelectedChannelId, 150);
  onCleanup(() => previewAfterNavigation.clear());

  const closeSearch = () => {
    if (props.searchOpen) setRestoreListScroll(true);
    setSearchQuery('');
    props.onSearchOpenChange(false);
  };
  const openSearch = () => {
    if (props.mode === 'slim') props.onModeChange('full');
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
  const channelActivity = useChannelRailActivity(channels, channelCalls);
  const favorites = createMemo(() => favoritesData()?.favorites ?? []);

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

    return buildChannelRailRows(state.tab, state.expandedGroups, {
      favorites: favorites(),
      channels: props.sources.channels.items(),
      direct_messages: props.sources.direct_messages.items(),
      recents: props.sources.recents.items(),
    });
  });

  const list = withSplitPanelOwner(listOwnedSlotName('controller'), () =>
    createListController<ChannelRailRow>({
      items: visibleRows,
      getKey: (row) => row.id,
      isSelectable: () => false,
      initialFocusKey:
        state.selectedChannelId === undefined
          ? undefined
          : rowKeyForChannel(state.selectedChannelId),
      onActivate: ({ item }) => {
        previewAfterNavigation.clear();

        if (item.kind === 'section') {
          setGroupOpen(item.group, !state.expandedGroups[item.group]);
          return;
        }

        if (item.kind === 'favorite') {
          if (item.favorite.entityType === 'channel') {
            setSelectedChannelId(item.favorite.entityId);
            return;
          }

          layout.openWithSplit(favoriteSplitContent(item.favorite), {
            referredFrom: 'channels',
          });
          return;
        }

        setSelectedChannelId(item.channel.id);
      },
    })
  );

  const scrollHandle: ListScrollHandle = {
    scrollToIndex: (index, options) => {
      const row = list.items.at(index);
      if (!row) return;

      if (row.kind === 'conversation') {
        const virtualizer = virtualizers()[row.scope];
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
    const items = props.sources[scope].items();
    const selectedIndex = items.findIndex(
      (channel) => channel.id === state.selectedChannelId
    );
    const targetIndex = selectedIndex >= 0 ? selectedIndex : 0;
    const virtualizer = virtualizers()[scope];

    if (virtualizer && items.length > 0) {
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
      (channel) => channel.id === state.selectedChannelId
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
        item.entityType === 'channel' &&
        item.entityId === state.selectedChannelId
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
    if (!restoreListScroll() || props.mode !== 'full') return;

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
      if (props.searchOpen !== searchOpen || props.mode !== 'full') return;

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
          if (row.localIndex < source.items().length - 1) return true;

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
            previewAfterNavigation(row.channel.id);
          } else if (
            row?.kind === 'favorite' &&
            row.favorite.entityType === 'channel'
          ) {
            previewAfterNavigation(row.favorite.entityId);
          }
        },
      },
      disclosure: {
        getKey: (row) => row.group,
        isExpanded: (group) =>
          state.expandedGroups[group as ChannelsRailSection],
        setExpanded: (group, expanded) =>
          setGroupOpen(group as ChannelsRailSection, expanded),
        getFocusKey: (group) => rowKeyForSection(group as ChannelsRailSection),
      },
    })
  );

  const jumpToSection = (offset: 1 | -1) => {
    const currentGroup = list.focus.item()?.group;
    const sections =
      favorites().length > 0
        ? CHANNEL_RAIL_SECTIONS
        : CHANNEL_RAIL_SECTIONS.filter((section) => section !== 'favorites');
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

  createEffect(
    on(
      () => props.mode,
      () => {
        if (props.mode === 'slim') {
          closeSearch();
          return;
        }

        const focusedIndex = list.focus.index();
        if (focusedIndex < 0) return;

        const frame = requestAnimationFrame(() => {
          scrollHandle.scrollToIndex(focusedIndex);
        });
        onCleanup(() => cancelAnimationFrame(frame));
      },
      { defer: true }
    )
  );

  const activateRow = (rowId: ChannelRailRow['id']) => {
    list.activate.key(rowId, { reason: 'pointer' });
  };

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
    setMode: (mode) => {
      if (mode === 'slim') closeSearch();
      props.onModeChange(mode);
    },
    sources: props.sources,
    favorites,
    selectedChannelId: () => state.selectedChannelId,
    isGroupOpen: (group) => state.expandedGroups[group],
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
        {props.mode === 'full' ? (
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
        ) : (
          <SlimChannelsRail />
        )}
      </aside>
    </ChannelsRailProvider>
  );
}
