import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { isMutedItem } from '@entity/utils/notification';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { type Accessor, createMemo, createSignal, onCleanup } from 'solid-js';
import type { VirtualizerHandle } from 'virtua/solid';
import type { ChannelsSourceScope } from '../../../queries';
import type { ChannelsGroup, ChannelsQueryScope } from '../../../types';
import {
  type ChannelRailRow,
  domIdForRow,
  rowKeyForChannel,
  rowKeyForFavorite,
  rowKeyForLabel,
  rowKeyForSection,
  useChannelsRail,
} from '../ChannelsRailContext';

const LOAD_MORE_THRESHOLD = 300;

export function useChannelRailItemState(
  channelId: Accessor<string>,
  /** The row this item renders as; defaults to the channel's own row. */
  rowKey: Accessor<ChannelRailRow['id']> = () => rowKeyForChannel(channelId())
) {
  const rail = useChannelsRail();
  const notificationSource = useGlobalNotificationSource();

  return createMemo(() => {
    const id = channelId();
    const rowId = rowKey();

    return {
      domId: domIdForRow(rail.railId, rowId),
      selected: rail.selectedChannel()?.id === id,
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

export function useChannelRailFavoriteItemState(favorite: Accessor<Favorite>) {
  const rail = useChannelsRail();

  return createMemo(() => {
    const current = favorite();
    const rowId = rowKeyForFavorite(current);

    return {
      domId: domIdForRow(rail.railId, rowId),
      selected:
        current.entityType === 'channel' &&
        rail.selectedChannel()?.id === current.entityId,
      focused: rail.list.focus.key() === rowId,
    };
  });
}

export function useChannelRailFavoritesState() {
  const rail = useChannelsRail();

  return createMemo(() => {
    const rowId = rowKeyForSection('favorites');

    return {
      items: rail.favorites(),
      open: rail.isGroupOpen('favorites'),
      focused: rail.list.focus.key() === rowId,
      containsFocus: rail.list.focus.item()?.group === 'favorites',
      domId: domIdForRow(rail.railId, rowId),
    };
  });
}

export function useChannelRailScopeState(scope: Accessor<ChannelsQueryScope>) {
  const rail = useChannelsRail();

  return createMemo(() => {
    const currentScope = scope();
    const source = rail.sources[currentScope];
    const items = source.items();
    // The Channels section renders label headings between its channels, so
    // its virtualizer indexes come from those rows, not the source.
    const rows =
      currentScope === 'channels' ? rail.channelSectionRows() : undefined;
    const focusedRow = rail.list.focus.item();
    const focusedIndex =
      (focusedRow?.kind === 'conversation' &&
        focusedRow.scope === currentScope) ||
      (focusedRow?.kind === 'label' && currentScope === 'channels')
        ? focusedRow.localIndex
        : -1;
    const targetChannelId =
      currentScope === 'recents'
        ? undefined
        : rail.channelActivity.targetChannelId(currentScope);
    const activityIndex =
      targetChannelId === undefined
        ? -1
        : rows
          ? rows.findIndex(
              (row) =>
                row.kind === 'conversation' &&
                row.channel.id === targetChannelId
            )
          : items.findIndex((channel) => channel.id === targetChannelId);
    const keepMounted = [...new Set([focusedIndex, activityIndex])].filter(
      (index) => index >= 0
    );

    return {
      items,
      rows,
      source,
      focusedIndex,
      activityIndex,
      keepMounted: keepMounted.length > 0 ? keepMounted : undefined,
    };
  });
}

export function useChannelRailVirtualizer(
  scope: Accessor<ChannelsSourceScope>
) {
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

  return { state };
}

export function useChannelRailLabelState(label: Accessor<ChannelLabel>) {
  const rail = useChannelsRail();

  return createMemo(() => {
    const current = label();
    const rowId = rowKeyForLabel(current.id);
    const focusedRow = rail.list.focus.item();

    return {
      domId: domIdForRow(rail.railId, rowId),
      open: rail.isLabelOpen(current.id),
      focused: rail.list.focus.key() === rowId,
      containsFocus:
        focusedRow?.kind === 'conversation' &&
        focusedRow.labelId === current.id,
      unreadCount: rail.labelUnreadCount(current),
    };
  });
}
