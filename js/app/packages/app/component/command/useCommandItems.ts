import { GO_TO_COMMAND_SCOPE, GO_TO_LEADER_KEY } from '@app/constants/hotkeys';
import {
  type EntityItem,
  exclude,
  type QuickAccessItem,
  type UserItem,
  useQuickAccess,
} from '@core/context/quickAccess';
import { HotkeyTags } from '@core/hotkey/constants';
import {
  type CommandWithInfo,
  getActiveCommandsFromScope,
} from '@core/hotkey/getCommands';
import { activeScope } from '@core/hotkey/state';
import type { HotkeyCommand } from '@core/hotkey/types';
import {
  createFreshSearch,
  type FreshSortConfig,
  type TimestampedItem,
} from '@core/util/freshSort';
import { mergeSortedArrays } from '@core/util/list';
import { createMemo } from 'solid-js';
import { getCommandLastUsedAt } from './recency';
import { CommandState } from './state';
import type { CategoryFilter, DisplayHotkeyStep } from './types';

/** Command item type - local to command menu, not part of quickAccess */
type CommandItem = {
  id: string;
  kind: 'command';
  bucket: 'command';
  searchText: string;
  sortTimestamp: number;
  timestamps: TimestampedItem;
  data: HotkeyCommand;
  displayHotkey?: string;
  displayHotkeySequence?: DisplayHotkeyStep[];
};

/** Search item: triggers full-text search in the sidebar Search view */
type SearchItem = {
  id: string;
  kind: 'search';
  bucket: 'search';
  searchText: string;
  sortTimestamp: number;
  timestamps: TimestampedItem;
  query: string;
  category: CategoryFilter;
};

/** Combined item type for command menu (quickAccess items + commands) */
type CommandMenuItem = QuickAccessItem | CommandItem | SearchItem;

function isCommandItem(item: CommandMenuItem): item is CommandItem {
  return item.kind === 'command';
}

function isEntityItem(item: CommandMenuItem): item is EntityItem {
  return item.kind === 'entity';
}

function _isUserItem(item: CommandMenuItem): item is UserItem {
  return item.kind === 'user';
}

function isSearchItem(item: CommandMenuItem): item is SearchItem {
  return item.kind === 'search';
}

/** Categories that surface a "Search for [query]" row in the command menu */
const SEARCHABLE_CATEGORIES: ReadonlySet<CategoryFilter> = new Set([
  'all',
  'channels',
  'dms',
  'documents',
  'tasks',
  'chats',
  'projects',
]);

function makeSearchItem(query: string, category: CategoryFilter): SearchItem {
  return {
    id: `search:${category}:${query}`,
    kind: 'search',
    bucket: 'search',
    searchText: query,
    sortTimestamp: 0,
    timestamps: { viewedAt: undefined, updatedAt: undefined },
    query,
    category,
  };
}

function createSearchConfig(hasQuery: boolean): FreshSortConfig {
  return {
    useViewedAt: true,
    dmBoost: hasQuery ? 1.8 : 1.0,
    fuzzyWeight: hasQuery ? 0.7 : 0.0,
    timeWeight: hasQuery ? 0.7 : 0.9,
    minFuzzyThreshold: hasQuery ? 0.1 : 0,
    commaSeparatedChannelMatch: true,
  };
}

/**
 * Helper to convert commands to CommandItem format.
 * Deduplicates commands by description since commands with multiple hotkeys
 * (e.g., ['delete', 'backspace']) appear multiple times in the command list.
 */
function commandsToItems(
  commands: CommandWithInfo[],
  options?: {
    displayHotkey?: (command: CommandWithInfo) => string | undefined;
    displayHotkeySequence?: (
      command: CommandWithInfo
    ) => DisplayHotkeyStep[] | undefined;
  }
): CommandItem[] {
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

  const items = dedupedCommands.map((command): CommandItem => {
    const description =
      typeof command.description === 'function'
        ? command.description()
        : command.description;
    const tags = command.tags?.join(' ') ?? '';
    const id = `command-${description.replaceAll(' ', '-')}`;
    const lastUsedAt = getCommandLastUsedAt(id);

    return {
      id,
      kind: 'command',
      bucket: 'command',
      searchText: [tags, description].filter(Boolean).join(' '),
      sortTimestamp: lastUsedAt?.getTime() ?? 0,
      timestamps: { viewedAt: lastUsedAt, updatedAt: lastUsedAt },
      data: command,
      displayHotkey: options?.displayHotkey?.(command),
      displayHotkeySequence: options?.displayHotkeySequence?.(command),
    };
  });

  return items.sort((a, b) => b.sortTimestamp - a.sortTimestamp);
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
    ignoreInputFocused: true,
  });
  const goToCommands = getActiveCommandsFromScope(GO_TO_COMMAND_SCOPE, {
    sortByScopeLevel: false,
    hideShadowedCommands: false,
    hideCommandsWithoutHotkeys: false,
    limitToCurrentScope: true,
    ignoreInputFocused: true,
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

    // Include sidebar go-to commands in the main command menu with their
    // leader-key sequence rendered as a display-only shortcut.
    return [
      ...commandsToItems(capturedCommands),
      ...commandsToItems(goToCommands, {
        displayHotkeySequence: (command) => {
          const hotkey = command.hotkeys?.[0];
          return hotkey
            ? [{ shortcut: GO_TO_LEADER_KEY }, { shortcut: hotkey }]
            : undefined;
        },
      }),
    ];
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

  const allWithCommands = createMemo((): CommandMenuItem[] =>
    mergeSortedArrays(
      entitiesList(),
      commandsList(),
      (a, b) => b.sortTimestamp - a.sortTimestamp
    )
  );

  return {
    all: allWithCommands,
    channels: quickAccess.useList('channel'),
    dms: quickAccess.useList('dm'),
    documents: quickAccess.useList('note', 'document', 'snippet'),
    tasks: quickAccess.useList('task'),
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
    return createFreshSearch<CommandMenuItem>({
      config: createSearchConfig(hasQuery),
      getName: (item) => item.searchText,
      isDmItem: (item) => item.bucket === 'dm',
      getTimestamp: (item) => item.timestamps,
    });
  });

  const shouldShowSearchRow = (q: string) => {
    if (!q.trim()) return false;
    if (CommandState.commandScopeCommands().length > 0) return false;
    if (CommandState.isEntityActionMode()) return false;
    return SEARCHABLE_CATEGORIES.has(categoryFilter());
  };

  const filteredItems = createMemo(() => {
    const q = query();
    const items = categoryItems();

    const ranked = q ? search()(items, q).map((result) => result.item) : items;

    if (shouldShowSearchRow(q)) {
      return [makeSearchItem(q, categoryFilter()), ...ranked];
    }

    return ranked;
  });

  return filteredItems;
}

export type { CommandMenuItem, SearchItem };
export { isCommandItem, isEntityItem, isSearchItem };
