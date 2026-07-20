import { GO_TO_COMMAND_SCOPE, GO_TO_LEADER_KEY } from '@app/constants/hotkeys';
import {
  type Bucket,
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
import { activeScope, hotkeyScopeTree } from '@core/hotkey/state';
import type { HotkeyCommand } from '@core/hotkey/types';
import {
  createFreshSearch,
  type FreshSortConfig,
  type TimestampedItem,
} from '@core/util/freshSort';
import { mergeSortedArrays } from '@core/util/list';
import { type Accessor, createMemo } from 'solid-js';
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
type CommandMenuItem = QuickAccessItem | CommandItem | SearchItem | AskAiItem;

export type PaginationControls = {
  hasMore: Accessor<boolean>;
  isLoadingMore: Accessor<boolean>;
  loadMore: () => Promise<void>;
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

/**
 * Entities shown in the no-query recency list. Unopened CRM companies (no
 * `viewedAt`) are excluded so the recency view sorts companies purely by when
 * the user last opened them — without this they'd fall back to `updatedAt` and
 * surface companies the user has never touched. They stay reachable via search.
 */
function showInRecencyList(item: CommandMenuItem): boolean {
  if (item.bucket === 'crm_company') {
    return item.timestamps.viewedAt != null;
  }
  return true;
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
    const scopeCommands = commandScopeCommands();
    if (scopeCommands.length > 0) {
      return commandsToItems(scopeCommands, {
        displayHotkeySequence: nestedCommandScopeDisplaySequence,
      });
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
    const surfacedNestedCommands = getSurfacedNestedCommands(capturedCommands);
    const surfacedHotkeySequences = new Map(
      surfacedNestedCommands.map((item) => [
        item.command,
        item.displayHotkeySequence,
      ])
    );

    return [
      ...commandsToItems(
        [
          ...capturedCommands,
          ...surfacedNestedCommands.map((item) => item.command),
        ],
        {
          displayHotkeySequence: (command) =>
            surfacedHotkeySequences.get(command),
        }
      ),
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

const QUICK_ACCESS_BUCKETS_BY_CATEGORY: Partial<
  Record<CategoryFilter, Bucket[]>
> = {
  all: exclude('person'),
  channels: ['channel'],
  dms: ['dm'],
  documents: ['note', 'document', 'snippet', 'project'],
  tasks: ['task'],
  chats: ['chat'],
  projects: ['project'],
  people: ['person'],
};

/** Creates only the Quick Access list needed by the active category. */
function useQuickAccessCategory(
  categoryFilter: Accessor<CategoryFilter>,
  commandScopeCommands: Accessor<CommandWithInfo[]>,
  searchTerm: Accessor<string>,
  enabled: Accessor<boolean>
) {
  const quickAccess = useQuickAccess();
  const commands = useCommandsList(commandScopeCommands);
  const activeList = createMemo(() => {
    if (
      commandScopeCommands().length > 0 ||
      CommandState.isEntityActionMode()
    ) {
      return undefined;
    }
    const buckets = QUICK_ACCESS_BUCKETS_BY_CATEGORY[categoryFilter()];
    return buckets
      ? quickAccess.useList({ buckets, searchTerm, enabled })
      : undefined;
  });
  const items = createMemo((): CommandMenuItem[] => {
    if (
      commandScopeCommands().length > 0 ||
      CommandState.isEntityActionMode() ||
      categoryFilter() === 'commands'
    ) {
      return commands();
    }

    const entities: CommandMenuItem[] = activeList()?.items() ?? [];
    if (categoryFilter() !== 'all') return entities;
    return mergeSortedArrays(
      entities,
      commands(),
      (a, b) => b.sortTimestamp - a.sortTimestamp
    );
  });

  return {
    items,
    pagination: {
      hasMore: () => activeList()?.hasMore() ?? false,
      isLoadingMore: () => activeList()?.isLoadingMore() ?? false,
      loadMore: async () => {
        await activeList()?.loadMore();
      },
    } satisfies PaginationControls,
  };
}

export function useCommandItems(
  query: () => string,
  categoryFilter: () => CategoryFilter,
  options?: {
    showSearchRow?: boolean;
    /**
     * Source of multi-stage command-scope commands. Defaults to the desktop
     * command menu state; mobile search passes its own scope state.
     */
    commandScopeCommands?: Accessor<CommandWithInfo[]>;
    /** Whether this menu should drive cache-backed Quick Access search. */
    searchActive?: Accessor<boolean>;
  }
) {
  const showSearchRow = options?.showSearchRow ?? true;
  const commandScopeCommands =
    options?.commandScopeCommands ?? CommandState.commandScopeCommands;
  const quickAccess = useQuickAccess();
  const searchActive = () => options?.searchActive?.() === true;
  const scopedSearchTerm = () => (searchActive() ? query() : '');
  const category = useQuickAccessCategory(
    categoryFilter,
    commandScopeCommands,
    scopedSearchTerm,
    searchActive
  );
  const categoryItems = category.items;

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

  const rankItems = (
    items: CommandMenuItem[],
    queryText: string
  ): CommandMenuItem[] => {
    if (!queryText.trim()) return items.filter(showInRecencyList);
    if (!quickAccess.usesRecordSelection()) {
      return search()(items, queryText).map((result) => result.item);
    }

    const entities = items.filter(isEntityItem);
    const localItems = items.filter((item) => !isEntityItem(item));
    const rankedLocalItems = search()(localItems, queryText).map(
      (result) => result.item
    );
    if (entities.length === 0) return rankedLocalItems;

    const topCommands = rankedLocalItems.filter(isCommandItem).slice(0, 3);
    const topCommandIds = new Set(topCommands.map((item) => item.id));
    return [
      ...topCommands,
      ...entities,
      ...rankedLocalItems.filter((item) => !topCommandIds.has(item.id)),
    ];
  };

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
    pagination: category.pagination,
  };
}

export type { AskAiItem, CommandMenuItem, SearchItem, UserItem };
export { isAskAiItem, isCommandItem, isEntityItem, isSearchItem, isUserItem };
