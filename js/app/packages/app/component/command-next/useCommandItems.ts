import { useChannelsContext } from '@core/context/channels';
import { getActiveCommandsFromScope } from '@core/hotkey/getCommands';
import { activeScope } from '@core/hotkey/state';
import { createFreshSearch } from '@core/util/freshSort';
import { useHistoryQuery } from '@queries/history/history';
import { ChannelTypeEnum } from '@service-comms/client';
import type { ChannelWithParticipants } from '@core/user';
import { createMemo } from 'solid-js';
import {
  type CommandItem,
  getCommandItemName,
  getCommandItemTimestamp,
  type CategoryFilter,
} from './types';

/** Filter out deleted items and persistent chats */
function isValidHistoryItem(
  item: ReturnType<typeof useHistoryQuery>['data'] extends
    | (infer T)[]
    | undefined
    ? T
    : never
): boolean {
  if (item.deletedAt) return false;
  // Filter out persistent sidebar chats (they're all "New Chat" and not useful for search)
  if (item.type === 'chat' && item.isPersistent) return false;
  return true;
}

/** Hook to gather all items available for the command menu */
export function useCommandItems() {
  const historyQuery = useHistoryQuery();
  const channelsContext = useChannelsContext();
  const channels = channelsContext.channels;

  // Get active commands from current scope
  const activeCommands = getActiveCommandsFromScope(activeScope(), {
    sortByScopeLevel: false,
    hideShadowedCommands: false,
    hideCommandsWithoutHotkeys: false,
  });

  // Convert history items to CommandItem format
  const historyItems = createMemo((): CommandItem[] => {
    const data = historyQuery.data ?? [];
    return data.filter(isValidHistoryItem).map((item) => ({
      type: 'history' as const,
      data: {
        id: item.id,
        name: item.name,
        historyItem: item,
        fileType: item.type === 'document' ? item.fileType : undefined,
        subType: item.type === 'document' ? item.subType : undefined,
      },
    }));
  });

  // Convert channels to CommandItem format
  const channelItems = createMemo((): CommandItem[] => {
    return channels().map((channel) => ({
      type: 'channel' as const,
      data: {
        id: channel.id,
        name: channel.name ?? '',
        channelType: channel.channel_type,
        participants:
          channel.channel_type === ChannelTypeEnum.DirectMessage
            ? (channel as ChannelWithParticipants).participants
            : undefined,
        updatedAt: channel.updated_at,
      },
    }));
  });

  // Convert commands to CommandItem format
  const commandItems = createMemo((): CommandItem[] => {
    return activeCommands.map((command) => {
      const description =
        typeof command.description === 'function'
          ? command.description()
          : command.description;
      return {
        type: 'command' as const,
        data: {
          id: description.replaceAll(' ', '-'),
          name: description,
          command,
        },
      };
    });
  });

  // All items combined
  const allItems = createMemo((): CommandItem[] => {
    return [...historyItems(), ...channelItems(), ...commandItems()];
  });

  return {
    historyItems,
    channelItems,
    commandItems,
    allItems,
  };
}

/** Create search config based on whether there's a query */
function createSearchConfig(hasQuery: boolean) {
  return {
    useViewedAt: true,
    channelBoost: hasQuery ? 1.5 : 1.0,
    fuzzyWeight: hasQuery ? 0.7 : 0.1,
    timeWeight: hasQuery ? 0.3 : 0.9,
    minFuzzyThreshold: hasQuery ? 0.1 : 0,
    commaSeparatedChannelMatch: true,
  };
}

/** Hook to search and filter command items */
export function useFilteredCommandItems(
  items: () => CommandItem[],
  query: () => string,
  categoryFilter: () => CategoryFilter
) {
  // Create fresh search function
  const search = createMemo(() => {
    const q = query();
    const hasQuery = q.trim().length > 0;
    return createFreshSearch<CommandItem>(
      createSearchConfig(hasQuery),
      getCommandItemName,
      (item) => item.type === 'channel',
      getCommandItemTimestamp
    );
  });

  // Filter by category
  const categoryFiltered = createMemo(() => {
    const filter = categoryFilter();
    const all = items();

    if (filter === 'all') return all;

    return all.filter((item) => {
      switch (filter) {
        case 'documents':
          return (
            item.type === 'history' && item.data.historyItem.type === 'document'
          );
        case 'channels':
          return item.type === 'channel';
        case 'chats':
          return (
            item.type === 'history' && item.data.historyItem.type === 'chat'
          );
        case 'commands':
          return item.type === 'command';
        default:
          return true;
      }
    });
  });

  // Apply search
  const filteredItems = createMemo(() => {
    const q = query().trim();
    const itemsToSearch = categoryFiltered();

    if (!q) {
      // No query - just sort by recency
      return search()(itemsToSearch, '').map((result) => result.item);
    }

    // Apply fuzzy search
    return search()(itemsToSearch, q).map((result) => result.item);
  });

  return filteredItems;
}
