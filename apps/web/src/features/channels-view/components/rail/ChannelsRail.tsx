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
import { compareDateDesc } from '@core/util/date';
import type { ChannelEntity } from '@entity';
import {
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  on,
  onCleanup,
} from 'solid-js';
import { useChannelsView } from '../../channels-view-context';
import type { ChannelsGroup, ChannelsTab } from '../../types';
import { channelHasMessages, isDirectMessage } from '../../utils';
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

export type ChannelsRailProps = {
  channels: ChannelEntity[];
  mode: 'full' | 'slim';
  onModeChange: (mode: 'full' | 'slim') => void;
};

export function ChannelsRail(props: ChannelsRailProps) {
  const { state, setGroupOpen, setSelectedChannelId, setTab } =
    useChannelsView();
  const panel = useSplitPanelOrThrow();
  const listDomId = createUniqueId();
  const [sectionScrollRoots, setSectionScrollRoots] = createSignal<
    Partial<Record<ChannelsGroup, HTMLDivElement>>
  >({});
  const [listRoot, setListRoot] = createSignal<HTMLDivElement>();

  const channelCalls = useChannelCalls();
  const channelActivity = useChannelRailActivity(
    () => props.channels,
    channelCalls
  );

  const teamChannels = createMemo(() =>
    props.channels.filter((channel) => !isDirectMessage(channel))
  );
  const directMessages = createMemo(() =>
    props.channels.filter(isDirectMessage)
  );
  const recentConversations = createMemo(() =>
    props.channels
      .filter(channelHasMessages)
      .sort((a, b) =>
        compareDateDesc(
          a.latestRootMessage?.createdAt,
          b.latestRootMessage?.createdAt
        )
      )
  );

  const visibleRows = createMemo<ChannelRailRow[]>(() => {
    if (state.tab === 'recents') {
      return recentConversations().map((channel) => ({
        kind: 'conversation',
        id: `channel:${channel.id}`,
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
    if (state.expandedGroups.channels) {
      rows.push(
        ...teamChannels().map(
          (channel): ChannelRailRow => ({
            kind: 'conversation',
            id: `channel:${channel.id}`,
            group: 'channels',
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
    if (state.expandedGroups.direct_messages) {
      rows.push(
        ...directMessages().map(
          (channel): ChannelRailRow => ({
            kind: 'conversation',
            id: `channel:${channel.id}`,
            group: 'direct_messages',
            channel,
          })
        )
      );
    }

    return rows;
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
        if (item.kind === 'section') {
          setGroupOpen(item.group, !state.expandedGroups[item.group]);
          return;
        }

        setSelectedChannelId(item.channel.id);
      },
    })
  );

  const scrollHandle: ListScrollHandle = {
    scrollToIndex: (index) => {
      const row = list.items.at(index);
      if (!row) return;

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

  const rail: ChannelsRailContext = {
    railId: listDomId,
    list,
    tab: () => state.tab,
    selectTab: setTab,
    setMode: (mode) => props.onModeChange(mode),
    teamChannels,
    directMessages,
    recentConversations,
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
