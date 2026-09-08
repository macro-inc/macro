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
  type Accessor,
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
import type { ChannelCallStatus } from './ChannelRailItems';
import { useChannelCalls } from './hooks/useChannelCalls';
import { useChannelRailActivity } from './hooks/useChannelRailActivity';

const CHANNEL_GROUPS: ChannelsGroup[] = ['channels', 'direct_messages'];
const CHANNEL_TAB_IDS: ChannelsTab[] = ['browse', 'recents'];

type ChannelRailRow =
  | {
      kind: 'section';
      id: `section:${ChannelsGroup}`;
      group: ChannelsGroup;
    }
  | {
      kind: 'conversation';
      id: `channel:${string}`;
      group?: ChannelsGroup;
      channel: ChannelEntity;
    };

const rowKeyForChannel = (channelId: string) => `channel:${channelId}`;
const rowKeyForSection = (group: ChannelsGroup) => `section:${group}`;

export type ChannelRailSectionState = {
  items: readonly ChannelEntity[];
  open: boolean;
  fillAvailable: boolean;
  focused: boolean;
  containsFocus: boolean;
  domId: string;
};

export type ChannelRailItemState = {
  domId: string;
  selected: boolean;
  focused: boolean;
};

export type ChannelRailSectionActivityState = {
  unreadCount: number;
  targetId: string | undefined;
  label: string | undefined;
};

export type ChannelRailItemActivityState = {
  unread: boolean;
  callStatus: ChannelCallStatus | undefined;
  incomingCallId: string | undefined;
};

export type ChannelsRailController = {
  tab: Accessor<ChannelsTab>;
  selectTab: (tab: ChannelsTab) => void;
  setMode: (mode: 'full' | 'slim') => void;
  recentConversations: Accessor<readonly ChannelEntity[]>;
  root: {
    ref: (element: HTMLDivElement) => void;
    activeDescendant: Accessor<string | undefined>;
  };
  group: {
    state: (group: ChannelsGroup) => ChannelRailSectionState;
    activate: (group: ChannelsGroup) => void;
    registerScrollRef: (
      group: ChannelsGroup
    ) => (element: HTMLDivElement) => void;
  };
  channel: {
    state: (channelId: string) => ChannelRailItemState;
    activate: (channelId: string) => void;
  };
  activity: {
    sectionState: (group: ChannelsGroup) => ChannelRailSectionActivityState;
    itemState: (channelId: string) => ChannelRailItemActivityState;
    visible: (group: ChannelsGroup, targetId: string) => void;
  };
};

export function useChannelsRailController(options: {
  channels: Accessor<ChannelEntity[]>;
  mode: Accessor<'full' | 'slim'>;
  onModeChange: (mode: 'full' | 'slim') => void;
}): ChannelsRailController {
  const { state, setGroupOpen, setSelectedChannelId, setTab } =
    useChannelsView();
  const panel = useSplitPanelOrThrow();
  const listDomId = createUniqueId();
  const [sectionScrollRoots, setSectionScrollRoots] = createSignal<
    Partial<Record<ChannelsGroup, HTMLDivElement>>
  >({});
  let listRoot: HTMLDivElement | undefined;

  const { callActivity, incomingCallIds, callStatuses } = useChannelCalls();
  const channelActivity = useChannelRailActivity(
    options.channels,
    callActivity
  );

  const teamChannels = createMemo(() =>
    options.channels().filter((channel) => !isDirectMessage(channel))
  );
  const directMessages = createMemo(() =>
    options.channels().filter(isDirectMessage)
  );
  const recentConversations = createMemo(() =>
    options
      .channels()
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

  const domIdForRow = (rowId: string) => `${listDomId}-${rowId}`;

  const scrollHandle: ListScrollHandle = {
    scrollToIndex: (index) => {
      const row = list.items.at(index);
      if (!row) return;

      const element = document.getElementById(domIdForRow(row.id));
      const scrollRoot =
        row.kind === 'conversation' && row.group
          ? sectionScrollRoots()[row.group]
          : state.tab === 'recents'
            ? listRoot
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
          listRoot?.focus({ preventScroll: true });

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

    listRoot?.focus({ preventScroll: true });
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
      options.mode,
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

  const itemsForGroup = (group: ChannelsGroup) =>
    group === 'channels' ? teamChannels() : directMessages();
  const activateRow = (rowId: string) => {
    list.activate.key(rowId, { reason: 'pointer' });
  };
  const activityTargetId = (group: ChannelsGroup) => {
    const channelId = channelActivity.targetChannelId(group);
    return channelId === undefined
      ? undefined
      : domIdForRow(rowKeyForChannel(channelId));
  };
  const clearVisibleActivity = (
    group: ChannelsGroup,
    visibleTargetId: string
  ) => {
    const channelId = channelActivity.targetChannelId(group);
    if (
      channelId === undefined ||
      domIdForRow(rowKeyForChannel(channelId)) !== visibleTargetId
    ) {
      return;
    }

    channelActivity.clearTarget(group, channelId);
  };

  return {
    tab: () => state.tab,
    selectTab: setTab,
    setMode: options.onModeChange,
    recentConversations,
    root: {
      ref: (element) => {
        listRoot = element;
      },
      activeDescendant: () => {
        const rowId = list.focus.key();
        return rowId === undefined ? undefined : domIdForRow(rowId);
      },
    },
    group: {
      state: (group) => ({
        items: itemsForGroup(group),
        open: state.expandedGroups[group],
        fillAvailable:
          group === 'direct_messages' && !state.expandedGroups.channels,
        focused: list.focus.key() === rowKeyForSection(group),
        containsFocus: list.focus.item()?.group === group,
        domId: domIdForRow(rowKeyForSection(group)),
      }),
      activate: (group) => activateRow(rowKeyForSection(group)),
      registerScrollRef: (group) => (element) => {
        setSectionScrollRoots((current) => ({
          ...current,
          [group]: element,
        }));
      },
    },
    channel: {
      state: (channelId) => ({
        domId: domIdForRow(rowKeyForChannel(channelId)),
        selected: state.selectedChannelId === channelId,
        focused: list.focus.key() === rowKeyForChannel(channelId),
      }),
      activate: (channelId) => activateRow(rowKeyForChannel(channelId)),
    },
    activity: {
      sectionState: (group) => ({
        unreadCount: channelActivity.unreadCount(group),
        targetId: activityTargetId(group),
        label: channelActivity.targetLabel(group),
      }),
      itemState: (channelId) => ({
        unread: channelActivity.unreadChannelIds().has(channelId),
        callStatus: callStatuses().get(channelId),
        incomingCallId: incomingCallIds().get(channelId),
      }),
      visible: clearVisibleActivity,
    },
  };
}
