import { GO_TO_COMMAND_SCOPE, GO_TO_LEADER_KEY } from '@app/constants/hotkeys';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableProjects } from '@core/constant/featureFlags';
import type {
  EntityItem,
  QuickAccessItem,
  UserItem,
} from '@core/context/quickAccess';
import { HotkeyTags } from '@core/hotkey/constants';
import {
  type CommandWithInfo,
  getActiveCommandsFromScope,
} from '@core/hotkey/getCommands';
import { activeScope, hotkeyScopeTree } from '@core/hotkey/state';
import { TOKENS } from '@core/hotkey/tokens';
import type { HotkeyCommand } from '@core/hotkey/types';
import type { TimestampedItem } from '@core/util/freshSort';
import { mergeSortedArrays } from '@core/util/list';
import type { CrmContactEntity } from '@entity';
import { type Accessor, createMemo } from 'solid-js';
import {
  type CreateProjectCommandItem,
  newProjectCommand,
  type ProjectCommandItem,
} from './project-items';
import { useEntitySearch } from './queries/entity-search';
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

/** Ask-AI item: opens a new AI chat seeded with the query */
type AskAiItem = {
  id: string;
  kind: 'ask-ai';
  bucket: 'ask-ai';
  searchText: string;
  sortTimestamp: number;
  timestamps: TimestampedItem;
  query: string;
};

/** Combined item type for command menu (quickAccess items + commands) */
type CommandMenuItem =
  | QuickAccessItem
  | CommandItem
  | SearchItem
  | AskAiItem
  | ProjectCommandItem
  | CreateProjectCommandItem;

export type PaginationControls = {
  hasMore: Accessor<boolean>;
  isLoadingMore: Accessor<boolean>;
  loadMore: () => Promise<void>;
};

/** CRM contacts matching a typed query, beyond those Quick Access holds. */
export type CommandContactSource = PaginationControls & {
  contacts: Accessor<CrmContactEntity[]>;
  isLoading: Accessor<boolean>;
};

function isCommandItem(item: CommandMenuItem): item is CommandItem {
  return item.kind === 'command';
}

function isEntityItem(item: CommandMenuItem): item is EntityItem {
  return item.kind === 'entity';
}

function isUserItem(item: CommandMenuItem): item is UserItem {
  return item.kind === 'user';
}

function isSearchItem(item: CommandMenuItem): item is SearchItem {
  return item.kind === 'search';
}

function isAskAiItem(item: CommandMenuItem): item is AskAiItem {
  return item.kind === 'ask-ai';
}

/** Categories that surface a "Search for [query]" row in the command menu */
const SEARCHABLE_CATEGORIES: ReadonlySet<CategoryFilter> = new Set([
  'all',
  'channels',
  'dms',
  'documents',
  'tasks',
  'chats',
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

function makeAskAiItem(query: string): AskAiItem {
  return {
    id: `ask-ai:${query}`,
    kind: 'ask-ai',
    bucket: 'ask-ai',
    searchText: query,
    sortTimestamp: 0,
    timestamps: { viewedAt: undefined, updatedAt: undefined },
    query,
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
    const keywords = command.keywords?.join(' ') ?? '';
    const id = `command-${description.replaceAll(' ', '-')}`;
    const lastUsedAt = getCommandLastUsedAt(id);

    return {
      id,
      kind: 'command',
      bucket: 'command',
      searchText: [tags, keywords, description].filter(Boolean).join(' '),
      sortTimestamp: lastUsedAt?.getTime() ?? 0,
      timestamps: { viewedAt: lastUsedAt, updatedAt: lastUsedAt },
      data: command,
      displayHotkey: options?.displayHotkey?.(command),
      displayHotkeySequence: options?.displayHotkeySequence?.(command),
    };
  });

  return items.sort((a, b) => b.sortTimestamp - a.sortTimestamp);
}

function commandDisplayStep(
  command: CommandWithInfo
): DisplayHotkeyStep | null {
  if (command.hotkeyToken) return { token: command.hotkeyToken };
  const hotkey = command.hotkeys?.[0];
  return hotkey ? { shortcut: hotkey } : null;
}

function nestedCommandScopeDisplaySequence(command: CommandWithInfo) {
  const scope = hotkeyScopeTree.get(command.scopeId);
  const activationKey =
    scope?.type === 'command' ? scope.activationKeys?.[0] : undefined;
  const childStep = commandDisplayStep(command);

  if (!activationKey || !childStep) return undefined;

  return [{ shortcut: activationKey }, childStep];
}

function getSurfacedNestedCommands(commands: CommandWithInfo[]) {
  return commands.flatMap((command) => {
    if (!command.surfaceNestedCommands || !command.activateCommandScopeId) {
      return [];
    }

    const parentStep = commandDisplayStep(command);
    if (!parentStep) return [];

    return getActiveCommandsFromScope(command.activateCommandScopeId, {
      sortByScopeLevel: false,
      hideShadowedCommands: false,
      hideCommandsWithoutHotkeys: false,
      limitToCurrentScope: true,
      ignoreInputFocused: true,
    }).map((nestedCommand) => ({
      command: nestedCommand,
      displayHotkeySequence: [
        parentStep,
        commandDisplayStep(nestedCommand),
      ].filter((step): step is DisplayHotkeyStep => step !== null),
    }));
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
function useCommandsList(
  commandScopeCommands: Accessor<CommandWithInfo[]>
): () => CommandItem[] {
  const projectsFlag = useFeatureFlag(enableProjects);
  const availableItems = (
    commands: CommandWithInfo[],
    options?: Parameters<typeof commandsToItems>[1]
  ) =>
    commandsToItems(
      commands.filter(
        (command) =>
          command.hotkeyToken !== TOKENS.create.initiative ||
          projectsFlag().enabled
      ),
      options
    );
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
    projectsFlag();
    // If we're in a command scope (multi-stage command), show those commands instead
    const scopeCommands = commandScopeCommands();
    if (scopeCommands.length > 0) {
      return availableItems(scopeCommands, {
        displayHotkeySequence: nestedCommandScopeDisplaySequence,
      });
    }

    // If in entity action mode, filter to only show selection modification commands
    if (CommandState.isEntityActionMode()) {
      const selectionCommands = capturedCommands.filter((command) =>
        command.tags?.includes(HotkeyTags.SelectionModification)
      );
      return availableItems(selectionCommands);
    }

    // Include sidebar go-to commands in the main command menu with their
    // leader-key sequence rendered as a display-only shortcut.
    const surfacedNestedCommands = getSurfacedNestedCommands(capturedCommands);
    const surfacedHotkeySequences = new Map(
      surfacedNestedCommands.map((item) => [
        item.command,
        item.displayHotkeySequence,
      ])
    );

    return [
      ...availableItems(
        [
          ...capturedCommands,
          ...surfacedNestedCommands.map((item) => item.command),
        ],
        {
          displayHotkeySequence: (command) =>
            surfacedHotkeySequences.get(command),
        }
      ),
      ...availableItems(goToCommands, {
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

export function useCommandItems(
  query: () => string,
  categoryFilter: () => CategoryFilter,
  options?: {
    showSearchRow?: boolean;
    /**
     * Source of multi-stage command-scope commands. Defaults to the desktop
     * command menu state.
     */
    commandScopeCommands?: Accessor<CommandWithInfo[]>;
    /** Whether this menu should drive cache-backed Quick Access search. */
    searchActive?: Accessor<boolean>;
    /** Finds CRM contacts for typed People and All queries. */
    contactDiscovery?: (
      search: Accessor<string>,
      active: Accessor<boolean>
    ) => CommandContactSource;
  }
) {
  const showSearchRow = options?.showSearchRow ?? true;
  const commandScopeCommands =
    options?.commandScopeCommands ?? CommandState.commandScopeCommands;
  const commands = useCommandsList(commandScopeCommands);
  const entityEnabled = () =>
    options?.searchActive?.() === true &&
    commandScopeCommands().length === 0 &&
    !CommandState.isEntityActionMode();
  const entities = useEntitySearch(query, categoryFilter, {
    enabled: entityEnabled,
    excludeEmails: true,
    contactDiscovery: options?.contactDiscovery,
  });
  const categoryItems = (): CommandMenuItem[] => {
    if (
      commandScopeCommands().length > 0 ||
      CommandState.isEntityActionMode() ||
      categoryFilter() === 'commands'
    )
      return commands();
    if (categoryFilter() === 'all')
      return entities.withDiscovery(
        mergeSortedArrays<CommandMenuItem>(
          entities.cachedItems(),
          commands(),
          (a, b) => b.sortTimestamp - a.sortTimestamp
        )
      );
    const items = entities.items();
    return [
      ...items,
      ...(entities.projectsEnabled() && categoryFilter() === 'projects'
        ? [newProjectCommand]
        : []),
    ];
  };
  const rankItems = entities.rankItems;

  const shouldShowSearchRow = (q: string) => {
    if (!showSearchRow) return false;
    if (!q.trim()) return false;
    if (commandScopeCommands().length > 0) return false;
    if (CommandState.isEntityActionMode()) return false;
    return SEARCHABLE_CATEGORIES.has(categoryFilter());
  };

  const filteredItems = createMemo(() => {
    const q = query();
    const items = categoryItems();

    if (
      q.trim().length <= 3 &&
      categoryFilter() === 'all' &&
      commandScopeCommands().length === 0 &&
      !CommandState.isEntityActionMode()
    ) {
      const trimmedQuery = q.trim();
      const ranked = rankItems(items, q);
      const topCommands = ranked.filter(isCommandItem).slice(0, 3);

      if (!trimmedQuery || topCommands.length > 0) {
        const topCommandIds = new Set(topCommands.map((item) => item.id));
        const rest = ranked.filter((item) => !topCommandIds.has(item.id));

        return [
          ...(trimmedQuery && showSearchRow
            ? [makeSearchItem(q, categoryFilter())]
            : []),
          ...topCommands,
          ...rest,
        ];
      }
    }

    const ranked = rankItems(items, q);

    if (shouldShowSearchRow(q)) {
      // With no direct results the menu would only offer search, so also
      // offer handing the query to AI.
      if (ranked.length === 0) {
        return [makeSearchItem(q, categoryFilter()), makeAskAiItem(q)];
      }
      return [makeSearchItem(q, categoryFilter()), ...ranked];
    }

    return ranked;
  });

  return {
    items: filteredItems,
    isLoadingEntities: entities.isLoadingEntities,
    pagination: entities.pagination,
  };
}

export type { AskAiItem, CommandMenuItem, SearchItem, UserItem };
export { isAskAiItem, isCommandItem, isEntityItem, isSearchItem, isUserItem };
