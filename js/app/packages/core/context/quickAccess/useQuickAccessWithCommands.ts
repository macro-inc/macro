import type { Accessor } from 'solid-js';
import { createMemo } from 'solid-js';
import { useActiveCommands } from '@core/hotkey/getCommands';
import type { HotkeyCommand } from '@core/hotkey/types';
import { useQuickAccess } from './QuickAccessProvider';
import type { Bucket, CommandItem, QuickAccessItem } from './types';

export type CommandsOptions = {
  /** Include commands without hotkeys. Default: false */
  includeUnkeyed?: boolean;
  /** Hide commands shadowed by more specific scopes. Default: false */
  hideShadowed?: boolean;
  /** Limit to current scope only. Default: false */
  limitToCurrentScope?: boolean;
};

/**
 * Transforms a HotkeyCommand into a CommandItem for the QuickAccess system.
 */
function commandToItem(command: HotkeyCommand): CommandItem {
  const description =
    typeof command.description === 'function'
      ? command.description()
      : command.description;

  return {
    kind: 'command',
    id: `cmd-${description.replaceAll(' ', '-').toLowerCase()}`,
    bucket: 'command',
    searchText: description,
    // Commands don't have timestamps, always sort by relevance (to end when no query)
    sortTimestamp: 0,
    timestamps: {},
    data: command,
  };
}

/**
 * Hook that extends useQuickAccess with hotkey commands.
 *
 * Use this in components that need command palette functionality (like Konsole).
 * For components that don't need commands (like MentionsMenu), use useQuickAccess directly.
 *
 * Search is composed by consumers using the returned items and createFreshSearch.
 * Helper functions (getItemTimestamps, isChannelItem) are exported from types.
 *
 * @example
 * const quickAccess = useQuickAccessWithCommands();
 *
 * // Get all items including commands
 * const all = quickAccess.useList();
 *
 * // Compose your own search
 * const search = createFreshSearch(config, getItemSearchText, isChannelItem, getItemTimestamps);
 * const results = search(all(), query);
 */
export function useQuickAccessWithCommands(options: CommandsOptions = {}) {
  const baseContext = useQuickAccess();

  // Get active commands reactively
  const commands = useActiveCommands({
    hideCommandsWithoutHotkeys: !options.includeUnkeyed,
    hideShadowedCommands: options.hideShadowed,
    limitToCurrentScope: options.limitToCurrentScope,
  });

  // Transform commands into QuickAccessItems
  const commandItems = createMemo<CommandItem[]>(() => {
    return commands().map(commandToItem);
  });

  // Wrap useList to include commands
  const useList = <B extends Bucket>(
    ...buckets: B[]
  ): Accessor<QuickAccessItem[]> => {
    return createMemo(() => {
      const includeCommands =
        buckets.length === 0 || buckets.includes('command' as B);
      const otherBuckets = buckets.filter((b) => b !== 'command');

      // Get base items (excluding commands bucket since we handle it separately)
      const baseItems =
        otherBuckets.length > 0 || buckets.length === 0
          ? baseContext.useList(...(otherBuckets as Bucket[]))()
          : [];

      if (!includeCommands) {
        return baseItems;
      }

      // Combine with commands and re-sort by sortTimestamp
      // Note: commands have sortTimestamp=0 so they'll sort to the end when no query
      // This is intentional - consumers handle relevance sorting when there's a query
      const combined = [...baseItems, ...commandItems()];
      combined.sort((a, b) => b.sortTimestamp - a.sortTimestamp);
      return combined;
    });
  };

  return {
    useList,
    isLoading: baseContext.isLoading,
    refresh: baseContext.refresh,
    /** Direct access to command items (useful for command-only views) */
    commands: commandItems,
  };
}
