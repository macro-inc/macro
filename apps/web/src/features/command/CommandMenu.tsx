import { isListViewID } from '@app/constants/list-views';
import { openChatWithMessage } from '@app/features/chat/ChatWithAgentButton';
import { getViewPreset } from '@app/features/next-soup/sidebar/soup-filter-presets';
import { getSearchSplit } from '@app/features/next-soup/soup-view/search-controllers';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { globalSplitManager } from '@app/signal/splitLayout';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { TabsInset } from '@core/component/TabsInset';
import { itemToBlockName } from '@core/constant/allBlocks';
import { USE_MACRO_PR_SUMMARY_BLOCK } from '@core/constant/featureFlags';
import { getActiveCommandsFromScope } from '@core/hotkey/getCommands';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import {
  hotkeyScopeTree,
  setActiveScope,
  setPressedKeys,
} from '@core/hotkey/state';
import type { HotkeyCommand, RegisterHotkeyReturn } from '@core/hotkey/types';
import { runCommand } from '@core/hotkey/utils';
import { debouncedDependent } from '@core/util/debounce';
import { openExternalUrl } from '@core/util/url';
import { type EntityData, InlineEntity, isGithubPrEntity } from '@entity';
import Macro from '@icon/macro-logo.svg';
import ArrowLeft from '@phosphor/arrow-left.svg';
import {
  CommandMenuEmptyState,
  CommandMenuHotkeyHint,
  CommandMenuSearchInput,
  CommandMenuShell,
  cn,
  createCommandListController,
  Dialog,
  Hotkey,
} from '@ui';
import {
  createEffect,
  createMemo,
  createSelector,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { type VirtualizerHandle, VList } from 'virtua/solid';
import { CommandItem } from './CommandItem';
import { getCategorySearchFilters } from './category-search-filters';
import { trackCommandUsage } from './recency';
import { CommandState } from './state';
import type { CategoryFilter } from './types';
import {
  type CommandMenuItem,
  isAskAiItem,
  isCommandItem,
  isEntityItem,
  isSearchItem,
  type PaginationControls,
  useCommandItems,
} from './useCommandItems';

const CATEGORIES: { id: CategoryFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'commands', label: 'Command' },
  { id: 'chats', label: 'Agents' },
  { id: 'documents', label: 'Files' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'channels', label: 'Channels' },
  { id: 'dms', label: 'People' },
];

const VIRTUAL_ITEM_HEIGHT = 40; // tailwind h-10
const LIST_PADDING = 16; // p-2 = 8px top + 8px bottom
const MAX_LIST_HEIGHT = VIRTUAL_ITEM_HEIGHT * 8 + LIST_PADDING;
const LOAD_MORE_THRESHOLD = VIRTUAL_ITEM_HEIGHT * 3;
const EMPTY_STATE_HEIGHT = VIRTUAL_ITEM_HEIGHT * 1.5 + LIST_PADDING;

export function CommandMenu() {
  const splitManager = globalSplitManager();
  const isListMode = splitManager
    ? () => isListViewID(splitManager.activeSplit()?.content().id)
    : () => true; // assume list mode

  let suppressCloseAutoFocus = false;

  createEffect(() => {
    const open = CommandState.isOpen();
    if (!isListMode()) {
      CommandState.clearEntityActionEntities();
    }
    if (open) {
      CommandState.onMenuOpen();
      suppressCloseAutoFocus = false;
    } else {
      CommandState.onMenuClose();
    }
  });

  const handleSelect = (item: CommandMenuItem) => {
    if (isSearchItem(item) || isAskAiItem(item)) suppressCloseAutoFocus = true;
  };

  return (
    <Dialog
      onOpenChange={CommandState.setIsOpen}
      onCloseAutoFocus={(e) => {
        if (suppressCloseAutoFocus) {
          e.preventDefault();
          suppressCloseAutoFocus = false;
        }
      }}
      open={CommandState.isOpen()}
    >
      <CommandMenuInner depth={2} onSelect={handleSelect} />
    </Dialog>
  );
}

export function CommandMenuInner(props: {
  /** Override items source with custom data (e.g. sandbox entities for tutorial) */
  items?: () => CommandMenuItem[];
  /** Called when the user selects an item from the menu */
  onSelect?: (item: CommandMenuItem) => void;
  /**
   * When true, selecting an item only fires `onSelect` — no navigation,
   * command, or search is run. Used by the onboarding sandbox so selecting a
   * sandbox entity doesn't navigate the real app to a non-existent doc.
   */
  disableDefaultAction?: boolean;
  /** Optional class merged onto the Panel wrapper. */
  class?: string;
  /** Optional depth for the Panel wrapper. */
  depth?: 0 | 1 | 2 | 3 | 4;
}) {
  const [commandMenuRef, setCommandMenuRef] = createSignal<HTMLDivElement>();

  const analytics = useAnalytics();

  const { openWithSplit } = useSplitLayout();

  const canOpenInNewSplit = () =>
    globalSplitManager()?.canAppendSplit() ?? false;

  const [attachHotkeys, hotkeyScope] = useHotkeyDOMScope('command-menu');

  const query = debouncedDependent(CommandState.query, 60);

  const defaultCommandItems = props.items
    ? undefined
    : useCommandItems(query, CommandState.categoryFilter, {
        searchActive: CommandState.isOpen,
      });
  const filteredItems = props.items ?? defaultCommandItems!.items;
  const pagination = defaultCommandItems?.pagination;
  const listController = createCommandListController({
    items: filteredItems,
    selectedIndex: CommandState.selectedIndex,
    setSelectedIndex: CommandState.setSelectedIndex,
  });

  createEffect(() => {
    const items = filteredItems();
    const current = CommandState.selectedIndex();
    if (current >= items.length && items.length > 0) {
      listController.setSelectedIndex(items.length - 1);
    }
  });

  createEffect(
    on([query, CommandState.categoryFilter], () => {
      const items = filteredItems();
      const firstIsSearch = items[0] && isSearchItem(items[0]);
      // Skip past the search row only onto a real result — when the query has
      // no results the rows below are fallbacks (ask AI), and the search row
      // should stay the default.
      const secondIsResult = items[1] && !isAskAiItem(items[1]);
      listController.setSelectedIndex(firstIsSearch && secondIsResult ? 1 : 0);
    })
  );

  const selectedItem = () => {
    const items = filteredItems();
    const index = CommandState.selectedIndex();
    return items[index];
  };

  // Fire command highlight hooks (e.g. live theme preview) as the selection
  // moves via hover or arrow keys. The outgoing command's onHighlightEnd runs
  // before the incoming command's onHighlight; unmount (menu close) ends any
  // active highlight.
  let highlightedCommand: HotkeyCommand | undefined;
  const setHighlightedCommand = (command: HotkeyCommand | undefined) => {
    if (command === highlightedCommand) return;
    highlightedCommand?.onHighlightEnd?.();
    highlightedCommand = command;
    command?.onHighlight?.();
  };
  createEffect(() => {
    const item = selectedItem();
    setHighlightedCommand(item && isCommandItem(item) ? item.data : undefined);
  });
  onCleanup(() => setHighlightedCommand(undefined));

  const selectedIsCommand = () => {
    const item = selectedItem();
    return item && isCommandItem(item);
  };
  const selectedIsEntity = () => {
    const item = selectedItem();
    return item && isEntityItem(item);
  };
  const selectedIsSearch = () => {
    const item = selectedItem();
    return item && isSearchItem(item);
  };
  const selectedIsAskAi = () => {
    const item = selectedItem();
    return item && isAskAiItem(item);
  };

  function handleItemAction(item: CommandMenuItem, openInNewSplit = false) {
    if (!item) return;

    props.onSelect?.(item);
    if (props.disableDefaultAction) {
      // Close like a normal selection, just without navigating/running.
      CommandState.close();
      CommandState.setQuery('');
      return;
    }
    analytics.track('command_menu_use', { itemType: item.bucket });

    if (isCommandItem(item)) {
      const command = item.data;
      trackCommandUsage(item.id);

      // Check if this is a multi-stage command
      if (command.activateCommandScopeId) {
        const commandScope = hotkeyScopeTree.get(
          command.activateCommandScopeId
        );
        if (commandScope) {
          commandScope.parentScopeId = hotkeyScope;
          setPressedKeys(new Set<string>());
          setActiveScope(commandScope.scopeId);
        }

        // Get commands from the nested scope
        const nestedCommands = getActiveCommandsFromScope(
          command.activateCommandScopeId,
          {
            sortByScopeLevel: false,
            hideShadowedCommands: false,
            hideCommandsWithoutHotkeys: false,
            limitToCurrentScope: true,
          }
        );
        CommandState.setQuery('');
        CommandState.setCommandScopeCommands(nestedCommands);
        CommandState.activateCommandScopePlaceholder(
          command.activateCommandScopeId
        );
        CommandState.setSelectedIndex(0);
        return;
      }

      // Regular command - close and run
      if (CommandState.commandScopeCommands().length > 0) {
        setActiveScope(hotkeyScope);
      }
      CommandState.close();
      CommandState.setQuery('');
      runCommand(command);
      return;
    }

    // Handle entity items (documents, channels, chats, etc.)
    if (isEntityItem(item)) {
      if (isGithubPrEntity(item.data)) {
        if (USE_MACRO_PR_SUMMARY_BLOCK) {
          openWithSplit(
            { type: 'pr', id: item.data.id },
            { referredFrom: 'kommand-menu', preferNewSplit: openInNewSplit }
          );
        } else {
          openExternalUrl(item.data.metadata.url);
        }
        CommandState.close();
        CommandState.setQuery('');
        return;
      }

      if (item.data.type !== 'foreign') {
        const blockName = itemToBlockName(item.data);
        if (blockName) {
          openWithSplit(
            { type: blockName, id: item.id },
            {
              referredFrom: 'kommand-menu',
              preferNewSplit: openInNewSplit,
              reopen: blockName === 'channel' ? 'latest' : undefined,
            }
          );
        }
      }
      CommandState.close();
      CommandState.setQuery('');
      return;
    }

    if (isAskAiItem(item)) {
      // Opens a new chat split and sends the query immediately.
      openChatWithMessage(item.query);
      CommandState.close();
      CommandState.setQuery('');
      return;
    }

    if (isSearchItem(item)) {
      // Fall back to the search preset (not `{}`) so uncategorized searches
      // keep the search view's baseline exclusions (foreign entities, CRM).
      const preset = getViewPreset('search');
      const overrides = getCategorySearchFilters(item.category);
      const filters = overrides?.filters ?? preset?.filters ?? {};
      const clientFilters =
        overrides?.clientFilters ?? preset?.clientFilters ?? {};
      const splitManager = globalSplitManager();
      const active = splitManager?.activeSplit();
      const activeContent = active?.content();
      const activeIsSearch =
        activeContent?.type === 'component' && activeContent.id === 'search';

      if (!openInNewSplit && activeIsSearch && active) {
        const controller = getSearchSplit(active.id);
        if (controller) {
          controller.applyOverrides({
            query: item.query,
            filters,
            clientFilters,
          });
          active.activate();
          CommandState.close();
          CommandState.setQuery('');
          return;
        }
      }

      openWithSplit(
        {
          type: 'component',
          id: 'search',
          // Opening search into an existing split otherwise drops these params
          // and the field mounts empty. Entry state still wins on back/forward.
          preserveParams: true,
          params: {
            initialQuery: item.query,
            initialFilters: filters,
            initialClientFilters: clientFilters,
          },
        },
        {
          referredFrom: 'kommand-menu',
          preferNewSplit: openInNewSplit,
          allowDuplicate: true,
        }
      );
      CommandState.close();
      CommandState.setQuery('');
      return;
    }

    CommandState.close();
    CommandState.setQuery('');
  }

  const navDownHotkey = registerHotkey({
    hotkey: ['arrowdown', 'ctrl+j'],
    scopeId: hotkeyScope,
    description: 'Move selection down',
    keyDownHandler: () => {
      const items = filteredItems();
      if (items.length === 0) return false;
      if (
        CommandState.selectedIndex() >= items.length - 1 &&
        (pagination?.hasMore() || pagination?.isLoadingMore())
      ) {
        if (!pagination?.isLoadingMore()) void pagination?.loadMore();
        return true;
      }
      return listController.selectNext();
    },
    runWithInputFocused: true,
    hide: true,
  });

  const navUpHotkey = registerHotkey({
    hotkey: ['arrowup', 'ctrl+k'],
    scopeId: hotkeyScope,
    description: 'Move selection up',
    keyDownHandler: () => {
      const items = filteredItems();
      if (items.length === 0) return false;
      return listController.selectPrevious();
    },
    runWithInputFocused: true,
    hide: true,
  });

  const confirmHotkey = registerHotkey({
    hotkey: 'enter',
    scopeId: hotkeyScope,
    description: 'Select item',
    keyDownHandler: () => {
      const item = selectedItem();
      if (item) {
        handleItemAction(item, false);
        return true;
      }
      return false;
    },
    runWithInputFocused: true,
  });

  const confirmSplitHotkey = registerHotkey({
    hotkey: 'shift+enter',
    scopeId: hotkeyScope,
    description: 'Open in new split',
    keyDownHandler: () => {
      const item = selectedItem();
      if (item) {
        handleItemAction(item, true);
        return true;
      }
      return false;
    },
    runWithInputFocused: true,
  });

  const escapeHotkey = registerHotkey({
    hotkey: 'escape',
    scopeId: hotkeyScope,
    description: 'Close command menu',
    keyDownHandler: () => {
      // If in command scope, go back to main menu
      if (CommandState.commandScopeCommands().length > 0) {
        CommandState.clearCommandScopeCommands();
        CommandState.setSelectedIndex(0);
        setActiveScope(hotkeyScope);
        return true;
      }
      // Entity action mode and normal mode both close the menu
      CommandState.close();
      return true;
    },
    runWithInputFocused: true,
    hide: true,
  });

  // Backspace when query is empty goes back from command scope
  const backspaceHotkey = registerHotkey({
    hotkey: 'backspace',
    scopeId: hotkeyScope,
    description: 'Go back',
    keyDownHandler: () => {
      // Only handle if query is empty
      if (CommandState.query() !== '') {
        return false;
      }
      // If in command scope, go back
      if (CommandState.commandScopeCommands().length > 0) {
        CommandState.clearCommandScopeCommands();
        CommandState.setSelectedIndex(0);
        setActiveScope(hotkeyScope);
        return true;
      }
      // Entity action mode doesn't have "back" - just close with escape
      return false;
    },
    runWithInputFocused: true,
    hide: true,
  });

  const tabHotkey = registerHotkey({
    hotkey: 'tab',
    scopeId: hotkeyScope,
    description: 'Next category',
    keyDownHandler: () => {
      const currentIndex = CATEGORIES.findIndex(
        (c) => c.id === CommandState.categoryFilter()
      );
      const nextIndex = (currentIndex + 1) % CATEGORIES.length;
      CommandState.setCategoryFilter(CATEGORIES[nextIndex].id);
      return true;
    },
    runWithInputFocused: true,
    hide: true,
  });

  registerHotkey({
    hotkey: 'shift+tab',
    scopeId: hotkeyScope,
    description: 'Previous category',
    keyDownHandler: () => {
      const currentIndex = CATEGORIES.findIndex(
        (c) => c.id === CommandState.categoryFilter()
      );
      const prevIndex =
        (currentIndex - 1 + CATEGORIES.length) % CATEGORIES.length;
      CommandState.setCategoryFilter(CATEGORIES[prevIndex].id);
      return true;
    },
    runWithInputFocused: true,
    hide: true,
  });

  onMount(() => {
    const element = commandMenuRef();
    if (element) {
      attachHotkeys(element);
    }
  });

  const isInCommandScope = createMemo(
    () => CommandState.commandScopeCommands().length > 0
  );

  const isEntityActionMode = createMemo(() =>
    CommandState.isEntityActionMode()
  );

  // Back is only available in command scope (entity action mode just closes).
  const handleBack = () => {
    if (!isInCommandScope()) return;
    CommandState.clearCommandScopeCommands();
    CommandState.setSelectedIndex(0);
    // Match the Escape/Backspace handlers: restore the menu's hotkey scope.
    // Clicking the back button doesn't focus it in some browsers, so without
    // this the sub-view's command scope stays active and stray keypresses
    // (e.g. digits) would be routed to it.
    setActiveScope(hotkeyScope);
  };

  const resultsHeight = () => {
    const count = filteredItems().length;
    if (count === 0) return EMPTY_STATE_HEIGHT;
    return Math.min(
      MAX_LIST_HEIGHT,
      count * VIRTUAL_ITEM_HEIGHT + LIST_PADDING
    );
  };

  const categoryTabs = CATEGORIES.map((c) => ({
    value: c.id,
    label: c.label,
  }));

  return (
    <CommandMenuShell
      class={cn('max-h-[75vh] rounded-xl', props.class)}
      ref={setCommandMenuRef}
      depth={props.depth}
    >
      <CommandMenuShell.Header>
        <Show
          when={isInCommandScope()}
          fallback={
            <span class="flex size-5 shrink-0 items-center justify-center text-accent">
              <Macro class="size-3" />
            </span>
          }
        >
          <button
            class="flex size-5 shrink-0 items-center justify-center text-ink-muted hover:text-ink transition-colors"
            onClick={handleBack}
            title="Back (Esc)"
          >
            <ArrowLeft class="size-3" />
          </button>
        </Show>
        <CommandMenuSearchInput
          type="text"
          placeholder={
            CommandState.commandScopePlaceholder() ??
            (isEntityActionMode() ? 'Search actions...' : 'Search...')
          }
          value={CommandState.query()}
          onInput={(e) => CommandState.setQuery(e.currentTarget.value)}
          autofocus
        />
      </CommandMenuShell.Header>

      <Show when={isEntityActionMode() || !isInCommandScope()}>
        <CommandMenuShell.Toolbar
          class={cn(
            'pl-2.5 pr-1.5 pt-2 border-0',
            isEntityActionMode() && 'gap-1.5'
          )}
        >
          <Show
            when={isEntityActionMode()}
            fallback={
              <TabsInset
                depth={1}
                list={categoryTabs}
                value={CommandState.categoryFilter()}
                onChange={(value) => {
                  if (value) {
                    CommandState.setCategoryFilter(value as CategoryFilter);
                  }
                }}
              />
            }
          >
            <EntityActionPreview
              entities={CommandState.entityActionEntities()}
            />
          </Show>
        </CommandMenuShell.Toolbar>
      </Show>

      <CommandMenuShell.Body>
        <div
          class="overflow-hidden transition-[height] duration-60 ease-out p-2"
          style={{ height: `${resultsHeight()}px` }}
        >
          <Show
            when={filteredItems().length > 0}
            fallback={
              <CommandMenuEmptyState>No results found</CommandMenuEmptyState>
            }
          >
            <VirtualizedCommandList
              items={filteredItems()}
              selectedIndex={CommandState.selectedIndex()}
              onSelect={(item, openInNewSplit) =>
                handleItemAction(item, openInNewSplit)
              }
              onItemMouseMove={listController.setSelectedIndexFromPointer}
              scrollSelectedIntoView={listController.shouldScrollSelectedIntoView()}
              pagination={pagination}
            />
          </Show>
        </div>
      </CommandMenuShell.Body>

      <CommandMenuShell.Footer>
        <span class="flex items-center gap-1">
          <div class="flex gap-1">
            <div class="flex border border-edge-muted text-xxs rounded-md items-center px-1.5 py-px font-normal">
              <Hotkey shortcut={navUpHotkey.hotkey()} class="space-x-1" />
            </div>
            <div class="flex border border-edge-muted text-xxs rounded-md items-center px-1.5 py-px font-normal">
              <Hotkey shortcut={navDownHotkey.hotkey()} class="space-x-1" />
            </div>
          </div>
          Navigate
        </span>

        <Switch>
          <Match when={isInCommandScope()}>
            <HotkeyHint command={confirmHotkey} label="Run action" />
            <HotkeyHint command={backspaceHotkey} label="Back" />
          </Match>
          <Match when={selectedIsCommand() || isEntityActionMode()}>
            <HotkeyHint command={confirmHotkey} label="Run action" />
          </Match>
          <Match when={selectedIsSearch()}>
            <HotkeyHint command={confirmHotkey} label="Search" />
            <Show when={canOpenInNewSplit()}>
              <HotkeyHint
                command={confirmSplitHotkey}
                label="Search in new split"
              />
            </Show>
          </Match>
          <Match when={selectedIsAskAi()}>
            <HotkeyHint command={confirmHotkey} label="Ask AI" />
          </Match>
          <Match when={selectedIsEntity()}>
            <HotkeyHint command={confirmHotkey} label="Open" />
            <Show when={canOpenInNewSplit()}>
              <HotkeyHint
                command={confirmSplitHotkey}
                label="Open in new split"
              />
            </Show>
          </Match>
        </Switch>

        <Show when={!isInCommandScope() && !isEntityActionMode()}>
          <HotkeyHint command={tabHotkey} label="Category" />
        </Show>
        <Show
          when={isInCommandScope()}
          fallback={<HotkeyHint command={escapeHotkey} label="Close" />}
        >
          <HotkeyHint command={escapeHotkey} label="Back" />
        </Show>
      </CommandMenuShell.Footer>
    </CommandMenuShell>
  );
}

/** Preview row showing entities being acted upon in entity action mode */
function EntityActionPreview(props: { entities: EntityData[] }) {
  const displayEntities = () => props.entities.slice(0, 2);
  const remainingCount = () => Math.max(0, props.entities.length - 2);

  return (
    <>
      <For each={displayEntities()}>
        {(entity) => {
          return (
            <div
              class={cn(
                'bg-active border border-edge-muted px-2 py-1 truncate text-xs rounded',
                {
                  'max-w-[50%]': props.entities.length === 2,
                }
              )}
            >
              <InlineEntity entity={entity} />
            </div>
          );
        }}
      </For>
      <Show when={remainingCount() > 0}>
        <div class="text-ink-muted text-xs px-2 py-1">
          +{remainingCount()} more
        </div>
      </Show>
    </>
  );
}

/** Virtualized command list component */
function VirtualizedCommandList(props: {
  items: CommandMenuItem[];
  selectedIndex: number;
  onSelect: (item: CommandMenuItem, openInNewSplit: boolean) => void;
  onItemMouseMove: (index: number) => void;
  scrollSelectedIntoView: boolean;
  pagination?: PaginationControls;
}) {
  let virtualizerHandle: VirtualizerHandle | undefined;

  const loadMoreNearEnd = () => {
    const pagination = props.pagination;
    if (
      !virtualizerHandle ||
      !pagination?.hasMore() ||
      pagination.isLoadingMore()
    )
      return;
    const remaining =
      virtualizerHandle.scrollSize -
      virtualizerHandle.scrollOffset -
      virtualizerHandle.viewportSize;
    if (remaining <= LOAD_MORE_THRESHOLD) void pagination.loadMore();
  };

  createEffect(() => {
    const index = props.selectedIndex;
    if (
      !props.scrollSelectedIntoView ||
      index < 0 ||
      index >= props.items.length ||
      !virtualizerHandle
    ) {
      return;
    }
    // Skip when all items fit: scrolling would be a no-op at the final
    // container size, but during the height transition the container is
    // briefly clipped and scrollToIndex shifts scrollTop, hiding the search
    // row across category switches.
    if (props.items.length * VIRTUAL_ITEM_HEIGHT <= MAX_LIST_HEIGHT) {
      return;
    }
    virtualizerHandle.scrollToIndex(index, { align: 'nearest' });
  });

  const selector = createSelector(
    () => props.selectedIndex,
    (ndx, selected) => ndx === selected
  );

  return (
    <VList
      ref={(handle) => {
        virtualizerHandle = handle;
      }}
      data={props.items}
      style={{ height: '100%' }}
      class="scrollbar-hidden"
      onScroll={loadMoreNearEnd}
    >
      {(item, index) => (
        <CommandItem
          item={item}
          index={index()}
          selected={selector(index())}
          onSelect={props.onSelect}
          onMouseMove={props.onItemMouseMove}
        />
      )}
    </VList>
  );
}

function HotkeyHint(props: { command: RegisterHotkeyReturn; label: string }) {
  return (
    <CommandMenuHotkeyHint
      hotkey={<Hotkey shortcut={props.command.hotkey()} class="space-x-1" />}
      label={props.label}
    />
  );
}
