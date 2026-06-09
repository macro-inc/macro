import { useAnalytics } from '@app/component/analytics-context';
import { getSearchSplit } from '@app/component/next-soup/soup-view/search-controllers';
import { isListViewID } from '@app/constants/list-views';
import { globalSplitManager } from '@app/signal/splitLayout';
import { TabsInset } from '@core/component/TabsInset';
import { itemToBlockName } from '@core/constant/allBlocks';
import { getActiveCommandsFromScope } from '@core/hotkey/getCommands';
import type { RegisterHotkeyReturn } from '@core/hotkey/types';
import { runCommand } from '@core/hotkey/utils';
import { debouncedDependent } from '@core/util/debounce';
import { openExternalUrl } from '@core/util/url';
import { type EntityData, InlineEntity, isGithubPrEntity } from '@entity';
import Macro from '@icon/macro-logo.svg';
import ArrowLeft from '@phosphor/arrow-left.svg';
import { cn, Dialog, Hotkey, Panel } from '@ui';
import { registerHotkey, useHotkeyDOMScope } from 'core/hotkey/hotkeys';
import {
  createEffect,
  createMemo,
  createSelector,
  createSignal,
  For,
  Match,
  on,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { type VirtualizerHandle, VList } from 'virtua/solid';
import { useSplitLayout } from '../split-layout/layout';
import { CommandItem } from './CommandItem';
import { getCategorySearchFilters } from './category-search-filters';
import { trackCommandUsage } from './recency';
import { CommandState } from './state';
import type { CategoryFilter } from './types';
import {
  type CommandMenuItem,
  isCommandItem,
  isEntityItem,
  isSearchItem,
  useCommandItems,
} from './useCommandItems';

const CATEGORIES: { id: CategoryFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'channels', label: 'Channels' },
  { id: 'dms', label: 'DMs' },
  { id: 'documents', label: 'Documents' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'chats', label: 'Agents' },
  { id: 'projects', label: 'Folders' },
  { id: 'commands', label: 'Commands' },
];

const VIRTUAL_ITEM_HEIGHT = 40; // tailwind h-10
const LIST_PADDING = 16; // p-2 = 8px top + 8px bottom
const MAX_LIST_HEIGHT = VIRTUAL_ITEM_HEIGHT * 8 + LIST_PADDING;
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
    if (isSearchItem(item)) suppressCloseAutoFocus = true;
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
  depth?: 0 | 1 | 2 | 3 | 4 | 5;
}) {
  const [commandMenuRef, setCommandMenuRef] = createSignal<HTMLDivElement>();

  const analytics = useAnalytics();

  const { openWithSplit } = useSplitLayout();

  const canOpenInNewSplit = () =>
    globalSplitManager()?.canAppendSplit() ?? false;

  const [attachHotkeys, hotkeyScope] = useHotkeyDOMScope('command-menu');

  const query = debouncedDependent(CommandState.query, 60);

  const defaultFilteredItems = props.items
    ? undefined
    : useCommandItems(query, CommandState.categoryFilter);
  const filteredItems = props.items ?? defaultFilteredItems!;

  createEffect(() => {
    const items = filteredItems();
    const current = CommandState.selectedIndex();
    if (current >= items.length && items.length > 0) {
      CommandState.setSelectedIndex(items.length - 1);
    }
  });

  createEffect(
    on([query, CommandState.categoryFilter], () => {
      const items = filteredItems();
      const firstIsSearch = items[0] && isSearchItem(items[0]);
      CommandState.setSelectedIndex(firstIsSearch && items.length > 1 ? 1 : 0);
    })
  );

  const selectedItem = () => {
    const items = filteredItems();
    const index = CommandState.selectedIndex();
    return items[index];
  };

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
        CommandState.setSelectedIndex(0);
        return;
      }

      // Regular command - close and run
      CommandState.close();
      CommandState.setQuery('');
      runCommand(command);
      return;
    }

    // Handle entity items (documents, channels, chats, etc.)
    if (isEntityItem(item)) {
      // TODO(dev-rb/github): Route GitHub PRs to /pr.
      if (isGithubPrEntity(item.data)) {
        openExternalUrl(item.data.metadata.url);
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
            }
          );
        }
      }
      CommandState.close();
      CommandState.setQuery('');
      return;
    }

    if (isSearchItem(item)) {
      const overrides = getCategorySearchFilters(item.category);
      const filters = overrides?.filters ?? {};
      const clientFilters = overrides?.clientFilters ?? {};
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
      CommandState.setSelectedIndex((prev) => (prev + 1) % items.length);
      return true;
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
      CommandState.setSelectedIndex(
        (prev) => (prev - 1 + items.length) % items.length
      );
      return true;
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

  const [isKeyboardActive, setIsKeyboardActive] = createSignal(false);

  function handleMouseEnter(index: number) {
    if (isKeyboardActive()) return;
    CommandState.setSelectedIndex(index);
  }

  // Track keyboard activity to prevent mouse hover from interfering
  createEffect(() => {
    const handleKeyDown = () => setIsKeyboardActive(true);
    const handleMouseMove = () => setIsKeyboardActive(false);

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousemove', handleMouseMove);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousemove', handleMouseMove);
    };
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
    <Panel
      class={cn('max-h-[75vh] rounded-xl', props.class)}
      ref={setCommandMenuRef}
      depth={props.depth}
      active
    >
      <Panel.Header class="gap-2 px-2 bg-surface">
        <Show
          when={isInCommandScope()}
          fallback={
            <span class="pl-2 text-accent">
              <Macro class="size-3" />
            </span>
          }
        >
          <button
            class="pl-2 text-ink-muted hover:text-ink transition-colors"
            onClick={handleBack}
            title="Back (Esc)"
          >
            <ArrowLeft class="size-3" />
          </button>
        </Show>
        <input
          type="text"
          class="flex-1 bg-transparent border-0 outline-none focus:outline-none ring-0 focus:ring-0 text-ink-muted placeholder:text-ink-placeholder"
          placeholder={isEntityActionMode() ? 'Search actions...' : 'Search...'}
          value={CommandState.query()}
          onInput={(e) => CommandState.setQuery(e.currentTarget.value)}
          autofocus
        />
      </Panel.Header>

      <Show when={isEntityActionMode() || !isInCommandScope()}>
        <Panel.Toolbar
          class={cn(
            'bg-surface px-1.5 border-0',
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
        </Panel.Toolbar>
      </Show>

      <Panel.Body>
        <div
          class="bg-surface overflow-hidden transition-[height] duration-60 ease-out"
          style={{ height: `${resultsHeight()}px` }}
        >
          <Show
            when={filteredItems().length > 0}
            fallback={
              <div class="p-4 text-center text-ink-muted">No results found</div>
            }
          >
            <VirtualizedCommandList
              items={filteredItems()}
              selectedIndex={CommandState.selectedIndex()}
              onSelect={(item, openInNewSplit) =>
                handleItemAction(item, openInNewSplit)
              }
              onMouseEnter={handleMouseEnter}
            />
          </Show>
        </div>
      </Panel.Body>

      <Panel.Footer class="gap-4 px-4 bg-surface text-xs text-ink-extra-muted/80">
        <span class="flex items-center gap-1">
          <div class="flex gap-1">
            <div class="flex border border-edge-muted text-xxs rounded-xs items-center px-1.5 py-px font-normal">
              <Hotkey shortcut={navUpHotkey.hotkey()} class="space-x-1" />
            </div>
            <div class="flex border border-edge-muted text-xxs rounded-xs items-center px-1.5 py-px font-normal">
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
      </Panel.Footer>
    </Panel>
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
        <div class="text-muted-foreground text-xs px-2 py-1">
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
  onMouseEnter: (index: number) => void;
}) {
  let virtualizerHandle: VirtualizerHandle | undefined;

  createEffect(() => {
    const index = props.selectedIndex;
    if (index < 0 || index >= props.items.length || !virtualizerHandle) {
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
      class="scrollbar-hidden p-2"
    >
      {(item, index) => (
        <CommandItem
          item={item}
          index={index()}
          selected={selector(index())}
          onSelect={props.onSelect}
          onHover={props.onMouseEnter}
        />
      )}
    </VList>
  );
}

function HotkeyHint(props: { command: RegisterHotkeyReturn; label: string }) {
  return (
    <span class="flex items-center gap-1">
      <div class="flex border border-edge-muted text-xxs rounded-xs items-center px-1.5 py-px font-normal">
        <Hotkey shortcut={props.command.hotkey()} class="space-x-1" />
      </div>
      {props.label}
    </span>
  );
}
