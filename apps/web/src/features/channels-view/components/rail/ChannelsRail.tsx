import {
  createListController,
  type ListScrollHandle,
  listOwnedSlotName,
  useListInteractions,
} from '@app/components/list';
import { useViewTabHotkeys } from '@app/components/view-shell';
import {
  useSplitPanelOrThrow,
  withSplitPanelOwner,
} from '@components/app/split-layout/layoutUtils';
import { createHotkeyGroup, registerHotkey } from '@core/hotkey/hotkeys';
import type { ChannelEntity } from '@entity';
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
import { type ChannelsSources, deduplicateChannels } from '../../queries';
import type {
  ChannelsGroup,
  ChannelsQueryScope,
  ChannelsTab,
} from '../../types';
import {
  type ChannelRailRow,
  type ChannelsRailContext,
  ChannelsRailProvider,
  domIdForRow,
  rowKeyForChannel,
  rowKeyForSection,
} from './ChannelsRailContext';
import { ExpandedChannelsRail } from './ExpandedChannelsRail';
import { useChannelCalls } from './hooks/useChannelCalls';
import { useChannelRailActivity } from './hooks/useChannelRailActivity';
import { SlimChannelsRail } from './SlimChannelsRail';

const CHANNEL_GROUPS: ChannelsGroup[] = ['channels', 'direct_messages'];
const CHANNEL_TAB_IDS: ChannelsTab[] = ['browse', 'recents'];
const DM_LOADING_PREVIEW_OFFSET = 80;

export type ChannelsRailProps = {
  sources: ChannelsSources;
  mode: 'full' | 'slim';
  onModeChange: (mode: 'full' | 'slim') => void;
};

type ChannelRailItemsByScope = Record<
  ChannelsQueryScope,
  readonly ChannelEntity[]
>;

export function buildChannelRailRows(
  tab: ChannelsTab,
  expandedGroups: Record<ChannelsGroup, boolean>,
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

  const rows: ChannelRailRow[] = [
    {
      kind: 'section',
      id: 'section:channels',
      group: 'channels',
    },
  ];
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
  const listDomId = createUniqueId();
  const [sectionScrollRoots, setSectionScrollRoots] = createSignal<
    Partial<Record<ChannelsGroup, HTMLDivElement>>
  >({});
  const [listRoot, setListRoot] = createSignal<HTMLDivElement>();
  const [virtualizers, setVirtualizers] = createSignal<
    Partial<Record<ChannelsQueryScope, VirtualizerHandle>>
  >({});

  const channelCalls = useChannelCalls();
  const channels = createMemo(() =>
    deduplicateChannels([
      props.sources.channels.items(),
      props.sources.direct_messages.items(),
      props.sources.recents.items(),
    ])
  );
  const channelActivity = useChannelRailActivity(channels, channelCalls);

  const visibleRows = createMemo(() =>
    buildChannelRailRows(state.tab, state.expandedGroups, {
      channels: props.sources.channels.items(),
      direct_messages: props.sources.direct_messages.items(),
      recents: props.sources.recents.items(),
    })
  );

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
        if (item.kind === 'section') {
          setGroupOpen(item.group, !state.expandedGroups[item.group]);
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
      const scrollRoot =
        row.kind === 'conversation' && row.group
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

  useViewTabHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    ids: () => CHANNEL_TAB_IDS,
    activeId: () => state.tab,
    setActiveId: setTab,
  });

  withSplitPanelOwner(listOwnedSlotName('navigation-hotkeys'), () =>
    useListInteractions({
      controller: list,
      scopeId: panel.splitHotkeyScope,
      scrollHandle: () => scrollHandle,
      enabled: panel.isPanelActive,
      navigation: {
        onBeforeMove: ({ direction, current }) => {
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

          const row = event.result?.item;
          if (row?.kind === 'conversation') {
            setSelectedChannelId(row.channel.id);
          }
        },
      },
      disclosure: {
        getKey: (row) => row.group,
        isExpanded: (group) => state.expandedGroups[group as ChannelsGroup],
        setExpanded: (group, expanded) =>
          setGroupOpen(group as ChannelsGroup, expanded),
        getFocusKey: (group) => rowKeyForSection(group as ChannelsGroup),
      },
    })
  );

  const jumpToSection = (offset: 1 | -1) => {
    const currentGroup = list.focus.item()?.group;
    const currentIndex = currentGroup
      ? CHANNEL_GROUPS.indexOf(currentGroup)
      : -1;
    const origin = currentIndex === -1 ? (offset === 1 ? -1 : 0) : currentIndex;
    const nextIndex =
      (origin + offset + CHANNEL_GROUPS.length) % CHANNEL_GROUPS.length;
    const nextGroup = CHANNEL_GROUPS[nextIndex];
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
    panel.isPanelActive() && state.tab === 'browse';

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
    scope: ChannelsQueryScope,
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
    selectTab: setTab,
    setMode: (mode) => props.onModeChange(mode),
    sources: props.sources,
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
        class="flex size-full min-h-0 flex-col gap-3 bg-inset pt-2"
      >
        {props.mode === 'full' ? (
          <ExpandedChannelsRail />
        ) : (
          <SlimChannelsRail />
        )}
      </aside>
    </ChannelsRailProvider>
  );
}
