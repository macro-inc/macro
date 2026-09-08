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
import { cn, Hotkey } from '@ui';
import {
  createEffect,
  createSignal,
  createUniqueId,
  Match,
  on,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import { useChannelsView } from '../../channels-view-context';
import type { ChannelsGroup, ChannelsTab } from '../../types';
import { ChannelsRailBrowse } from './Browse';
import { type ChannelRailContext, ChannelRailProvider } from './Context';
import { ChannelsRailHeader } from './Header';
import { useChannelCalls } from './hooks/useChannelCalls';
import { useChannelRailActivity } from './hooks/useChannelRailActivity';
import { useChannelRailRows } from './hooks/useChannelRailRows';
import {
  CHANNEL_GROUPS,
  type ChannelRailRow,
  rowKeyForChannel,
  rowKeyForSection,
} from './model';
import { ChannelsRailRecents } from './Recents';

const CHANNEL_TAB_IDS: ChannelsTab[] = ['browse', 'recents'];

export function ChannelsRail(props: {
  channels: ChannelEntity[];
  mode: 'full' | 'slim';
  onModeChange: (mode: 'full' | 'slim') => void;
}) {
  const { state, setGroupOpen, setSelectedChannelId, setTab } =
    useChannelsView();

  const panel = useSplitPanelOrThrow();

  const listDomId = createUniqueId();

  const [sectionScrollRoots, setSectionScrollRoots] = createSignal<
    Partial<Record<ChannelsGroup, HTMLDivElement>>
  >({});

  const { callActivity, incomingCallIds, callStatuses } = useChannelCalls();

  const channelActivity = useChannelRailActivity(
    () => props.channels,
    callActivity
  );

  useViewTabHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    ids: () => CHANNEL_TAB_IDS,
    activeId: () => state.tab,
    setActiveId: setTab,
  });

  const { directMessages, recentConversations, teamChannels, visibleRows } =
    useChannelRailRows({
      channels: () => props.channels,
      tab: () => state.tab,
      isGroupExpanded: (group) => state.expandedGroups[group],
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

  let listRoot: HTMLDivElement | undefined;

  const registerSectionScrollRef =
    (group: ChannelsGroup) => (element: HTMLDivElement) => {
      setSectionScrollRoots((current) => ({
        ...current,
        [group]: element,
      }));
    };

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

  onCleanup(() => {
    sectionHotkeys.dispose();
  });

  const activateRow = (rowId: string) => {
    list.activate.key(rowId, { reason: 'pointer' });
  };

  const activeDescendant = () => {
    const rowId = list.focus.key();
    return rowId === undefined ? undefined : domIdForRow(rowId);
  };

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

  const itemsForGroup = (group: ChannelsGroup) =>
    group === 'channels' ? teamChannels() : directMessages();

  const railContext: ChannelRailContext = {
    mode: () => props.mode,
    tab: () => state.tab,
    setTab,
    onModeChange: props.onModeChange,
    items: itemsForGroup,
    recentConversations,
    activity: {
      isUnread: (channelId) =>
        channelActivity.unreadChannelIds().has(channelId),
      callStatus: (channelId) => callStatuses().get(channelId),
      incomingCallId: (channelId) => incomingCallIds().get(channelId),
      unreadCount: channelActivity.unreadCount,
      targetId: activityTargetId,
      label: channelActivity.targetLabel,
      onVisible: clearVisibleActivity,
    },
    item: {
      domId: (channelId) => domIdForRow(rowKeyForChannel(channelId)),
      isSelected: (channelId) => state.selectedChannelId === channelId,
      isFocused: (channelId) =>
        list.focus.key() === rowKeyForChannel(channelId),
      activate: (channelId) => activateRow(rowKeyForChannel(channelId)),
    },
    section: {
      domId: (group) => domIdForRow(rowKeyForSection(group)),
      isOpen: (group) => state.expandedGroups[group],
      isFocused: (group) => list.focus.key() === rowKeyForSection(group),
      containsFocus: (group) => list.focus.item()?.group === group,
      activate: (group) => activateRow(rowKeyForSection(group)),
      registerScrollRef: registerSectionScrollRef,
    },
  };

  return (
    <ChannelRailProvider value={railContext}>
      <aside
        aria-label="Chat navigation"
        class="flex size-full min-h-0 flex-col gap-3 bg-inset pt-2"
      >
        <ChannelsRailHeader />
        <div class="flex min-h-0 flex-1 flex-col">
          <div
            ref={(element) => {
              listRoot = element;
            }}
            role="tree"
            tabIndex={-1}
            aria-activedescendant={activeDescendant()}
            class={cn(
              'scrollbar-hidden min-h-0 flex-1 outline-none',
              state.tab === 'browse' ? 'overflow-hidden' : 'overflow-y-auto'
            )}
          >
            <Switch>
              <Match when={state.tab === 'browse'}>
                <ChannelsRailBrowse />
              </Match>
              <Match when={state.tab === 'recents'}>
                <ChannelsRailRecents />
              </Match>
            </Switch>
          </div>
          <Show when={props.mode === 'full' && state.tab === 'browse'}>
            <footer class="flex h-9 shrink-0 items-center justify-start gap-1 border-t border-edge-muted px-4 text-xxs text-ink-extra-muted">
              <span>Use</span>
              <Hotkey shortcut="[" theme="subtle" />
              <Hotkey shortcut="]" theme="subtle" />
              <span>to jump sections</span>
            </footer>
          </Show>
        </div>
      </aside>
    </ChannelRailProvider>
  );
}
