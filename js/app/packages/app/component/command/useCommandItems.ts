import {
  useQuickAccess,
  type QuickAccessItem,
  type Bucket,
  type EntityItem,
  type UserItem,
  exclude,
} from '@core/context/quickAccess';
import type { HotkeyCommand } from '@core/hotkey/types';
import { createFreshSearch } from '@core/util/freshSort';
import { createMemo } from 'solid-js';
import type { CategoryFilter } from './types';
import {
  getActiveCommandsFromScope,
  type CommandWithInfo,
} from '@core/hotkey/getCommands';
import { activeScope } from '@core/hotkey/state';
import { CommandState } from './state';
import { HotkeyTags } from '@core/hotkey/constants';

/** Command item type - local to command menu, not part of quickAccess */
type CommandItem = {
  id: string;
  kind: 'command';
  bucket: 'command';
  searchText: string;
  sortTimestamp: number;
  timestamps: Record<string, never>;
  data: HotkeyCommand;
};

/** Combined item type for command menu (quickAccess items + commands) */
type CommandMenuItem = QuickAccessItem | CommandItem;

function isCommandItem(item: CommandMenuItem): item is CommandItem {
  return item.kind === 'command';
}

function isEntityItem(item: CommandMenuItem): item is EntityItem {
  return item.kind === 'entity';
}

function isUserItem(item: CommandMenuItem): item is UserItem {
  return item.kind === 'user';
}

function isChannelItem(item: CommandMenuItem): boolean {
  // only dms get the "channel boost" in command menu
  return item.bucket === 'dm';
}

// tune-able freshSearch for query vs non-query sort
function createSearchConfig(hasQuery: boolean) {
  return {
    useViewedAt: true,
    channelBoost: hasQuery ? 1.8 : 1.0,
    fuzzyWeight: hasQuery ? 0.7 : 0.0,
    timeWeight: hasQuery ? 0.3 : 0.9,
    minFuzzyThreshold: hasQuery ? 0.1 : 0,
    commaSeparatedChannelMatch: true,
  };
}

/**
 * Helper to convert commands to CommandItem format.
 * Deduplicates commands by description since commands with multiple hotkeys
 * (e.g., ['delete', 'backspace']) appear multiple times in the command list.
 */
function commandsToItems(commands: CommandWithInfo[]): CommandItem[] {
  const seen = new Set<string>();
  const dedupedCommands = commands.filter((command) => {
    const description =
      typeof command.description === 'function'
        ? command.description()
        : command.description;
    const id = description.replaceAll(' ', '-');
    if (seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });

  return dedupedCommands.map((command): CommandItem => {
    const description =
      typeof command.description === 'function'
        ? command.description()
        : command.description;

    return {
      id: `command-${description.replaceAll(' ', '-')}`,
      kind: 'command',
      bucket: 'command',
      searchText: description,
      sortTimestamp: 0,
      timestamps: {},
      data: command,
    };
  });
}

/**
 * Convert active hotkey commands to QuickAccessItem format.
 *
 * IMPORTANT: We capture commands at call time (outside createMemo) to match
 * the old Konsole behavior. This ensures commands are captured from the
 * previous scope BEFORE the command menu's scope becomes active. Otherwise,
 * selection modification commands (delete, mark done, etc.) would be filtered
 * out because their conditions check the soup's selection state.
 */
function useCommandsList(): () => CommandItem[] {
  const scopeId = activeScope() ?? '';
  const capturedCommands = getActiveCommandsFromScope(scopeId, {
    sortByScopeLevel: false,
    hideShadowedCommands: false,
    hideCommandsWithoutHotkeys: false,
  });

  return createMemo(() => {
    // If we're in a command scope (multi-stage command), show those commands instead
    const scopeCommands = CommandState.commandScopeCommands();
    if (scopeCommands.length > 0) {
      return commandsToItems(scopeCommands);
    }

    // If in entity action mode, filter to only show selection modification commands
    if (CommandState.isEntityActionMode()) {
      const selectionCommands = capturedCommands.filter((command) =>
        command.tags?.includes(HotkeyTags.SelectionModification)
      );
      return commandsToItems(selectionCommands);
    }

    // Use the commands captured at mount time
    return commandsToItems(capturedCommands);
  });
}

/**
 * Hook to get items from QuickAccess organized by category.
 * Items are already sorted by recency from QuickAccess.
 */
function useQuickAccessBuckets(): Record<
  CategoryFilter,
  () => CommandMenuItem[]
> {
  const quickAccess = useQuickAccess();
  const commandsList = useCommandsList();
  const entitiesList = quickAccess.useList(...exclude('person'));

  const allWithCommands = createMemo((): CommandMenuItem[] => {
    const entities = entitiesList();
    const commands = commandsList();
    return [...entities, ...commands];
  });

  return {
    all: allWithCommands,
    channels: quickAccess.useList('channel'),
    dms: quickAccess.useList('dm'),
    notes: quickAccess.useList('note'),
    tasks: quickAccess.useList('task'),
    documents: quickAccess.useList('document'),
    chats: quickAccess.useList('chat'),
    projects: quickAccess.useList('project'),
    people: quickAccess.useList('person'),
    commands: commandsList,
  };
}

export function useCommandItems(
  query: () => string,
  categoryFilter: () => CategoryFilter
) {
  const buckets = useQuickAccessBuckets();

  // When in command scope or entity action mode, always show commands regardless of category filter
  const categoryItems = () => {
    if (CommandState.commandScopeCommands().length > 0) {
      return buckets.commands();
    }
    if (CommandState.isEntityActionMode()) {
      return buckets.commands();
    }
    return buckets[categoryFilter()]();
  };

  const search = createMemo(() => {
    const q = query();
    const hasQuery = q.trim().length > 0;
    return createFreshSearch<CommandMenuItem>(
      createSearchConfig(hasQuery),
      (item) => item.searchText,
      isChannelItem,
      (item) => item.timestamps
    );
  });

  const filteredItems = createMemo(() => {
    const q = query();
    const items = categoryItems();

    if (!q) {
      return items;
    }

    return search()(items, q).map((result) => result.item);
  });

  return filteredItems;
}

export { isEntityItem, isUserItem, isCommandItem };
export type { QuickAccessItem, CommandMenuItem, CommandItem, Bucket };
