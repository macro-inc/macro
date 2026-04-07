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
import { GO_TO_COMMAND_SCOPE, GO_TO_LEADER_KEY } from '@app/constants/hotkeys';
import type { HotkeySequenceStep } from '@core/component/Tooltip';

/** Command item type - local to command menu, not part of quickAccess */
type CommandItem = {
  id: string;
  kind: 'command';
  bucket: 'command';
  searchText: string;
  sortTimestamp: number;
  timestamps: Record<string, never>;
  data: HotkeyCommand;
  displayHotkey?: string;
  displayHotkeySequence?: HotkeySequenceStep[];
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

function createSearchConfig(hasQuery: boolean) {
  return {
    useViewedAt: true,
    dmBoost: hasQuery ? 1.8 : 1.0,
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
function commandsToItems(
  commands: CommandWithInfo[],
  options?: {
    displayHotkey?: (command: CommandWithInfo) => string | undefined;
    displayHotkeySequence?: (
      command: CommandWithInfo
    ) => HotkeySequenceStep[] | undefined;
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

  return dedupedCommands.map((command): CommandItem => {
    const description =
      typeof command.description === 'function'
        ? command.description()
        : command.description;
    const tags = command.tags?.join(' ') ?? '';

    return {
      id: `command-${description.replaceAll(' ', '-')}`,
      kind: 'command',
      bucket: 'command',
      searchText: [tags, description].filter(Boolean).join(' '),
      sortTimestamp: 0,
      timestamps: {},
      data: command,
      displayHotkey: options?.displayHotkey?.(command),
      displayHotkeySequence: options?.displayHotkeySequence?.(command),
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

  const allWithCommands = createMemo((): CommandMenuItem[] => {
    const entities = entitiesList();
    const commands = commandsList();
    return [...entities, ...commands];
  });

  return {
    all: allWithCommands,
    channels: quickAccess.useList('channel'),
    dms: quickAccess.useList('dm'),
    documents: quickAccess.useList('note', 'document'),
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
