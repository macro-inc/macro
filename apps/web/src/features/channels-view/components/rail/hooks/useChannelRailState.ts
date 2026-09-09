import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { isMutedItem } from '@entity/utils/notification';
import { type Accessor, createMemo, createSignal, onCleanup } from 'solid-js';
import type { VirtualizerHandle } from 'virtua/solid';
import type { ChannelsGroup, ChannelsQueryScope } from '../../../types';
import {
  domIdForRow,
  rowKeyForChannel,
  rowKeyForSection,
  useChannelsRail,
} from '../ChannelsRailContext';

const LOAD_MORE_THRESHOLD = 300;

export function useChannelRailItemState(channelId: Accessor<string>) {
  const rail = useChannelsRail();
  const notificationSource = useGlobalNotificationSource();

  return createMemo(() => {
    const id = channelId();
    const rowId = rowKeyForChannel(id);

    return {
      domId: domIdForRow(rail.railId, rowId),
      selected: rail.selectedChannelId() === id,
      focused: rail.list.focus.key() === rowId,
      muted: isMutedItem(notificationSource.mutedEntities(), {
        item_id: id,
        item_type: 'channel',
      }),
      unread: rail.channelActivity.unreadChannelIds().has(id),
      callStatus: rail.channelActivity.callStatuses().get(id),
      incomingCallId: rail.channelActivity.incomingCallIds().get(id),
    };
  });
}

export function useChannelRailScopeState(scope: Accessor<ChannelsQueryScope>) {
  const rail = useChannelsRail();

  return createMemo(() => {
    const currentScope = scope();
    const source = rail.sources[currentScope];
    const items = source.items();
    const focusedRow = rail.list.focus.item();
    const focusedIndex =
      focusedRow?.kind === 'conversation' && focusedRow.scope === currentScope
        ? focusedRow.localIndex
        : -1;
    const targetChannelId =
      currentScope === 'recents'
        ? undefined
        : rail.channelActivity.targetChannelId(currentScope);
    const activityIndex =
      targetChannelId === undefined
        ? -1
        : items.findIndex((channel) => channel.id === targetChannelId);
    const keepMounted = [...new Set([focusedIndex, activityIndex])].filter(
      (index) => index >= 0
    );

    return {
      items,
      source,
      focusedIndex,
      activityIndex,
      keepMounted: keepMounted.length > 0 ? keepMounted : undefined,
    };
  });
}

export function useChannelRailVirtualizer(scope: Accessor<ChannelsQueryScope>) {
  const rail = useChannelsRail();
  const [virtualizer, setVirtualizer] = createSignal<VirtualizerHandle>();
  let unregister: (() => void) | undefined;

  const registerVirtualizer = (handle?: VirtualizerHandle) => {
    unregister?.();
    unregister = undefined;
    setVirtualizer(handle);

    if (handle) {
      unregister = rail.registerVirtualizer(scope(), handle);
    }
  };

  onCleanup(() => unregister?.());

  const loadMoreNearEnd = (offset?: number) => {
    const handle = virtualizer();
    if (!handle) return;

    const source = rail.sources[scope()];
    const distance =
      handle.scrollSize - handle.viewportSize - (offset ?? handle.scrollOffset);
    if (
      distance >= LOAD_MORE_THRESHOLD ||
      source.isLoadingMore() ||
      !source.hasMore()
    ) {
      return;
    }

    void source.loadMore();
  };

  return { registerVirtualizer, loadMoreNearEnd };
}

export function useChannelRailSectionState(group: Accessor<ChannelsGroup>) {
  const rail = useChannelsRail();
  const scope = useChannelRailScopeState(group);
  const state = createMemo(() => {
    const section = group();
    const rowId = rowKeyForSection(section);
    const targetChannelId = rail.channelActivity.targetChannelId(section);

    return {
      ...scope(),
      open: rail.isGroupOpen(section),
      fillAvailable:
        section === 'direct_messages' && !rail.isGroupOpen('channels'),
      focused: rail.list.focus.key() === rowId,
      containsFocus: rail.list.focus.item()?.group === section,
      domId: domIdForRow(rail.railId, rowId),
      unreadCount: rail.channelActivity.unreadCount(section),
      targetId:
        targetChannelId === undefined
          ? undefined
          : domIdForRow(rail.railId, rowKeyForChannel(targetChannelId)),
      label: rail.channelActivity.targetLabel(section),
    };
  });

  const clearVisibleActivity = (visibleTargetId: string) => {
    const section = group();
    const targetChannelId = rail.channelActivity.targetChannelId(section);
    if (
      targetChannelId === undefined ||
      domIdForRow(rail.railId, rowKeyForChannel(targetChannelId)) !==
        visibleTargetId
    ) {
      return;
    }

    rail.channelActivity.clearTarget(section, targetChannelId);
  };

  return { state, clearVisibleActivity };
}
