import { DialogWrapper } from '@core/component/DialogWrapper';
import {
  isCommandItem,
  isEntityItem,
  type CommandMenuItem,
} from './useCommandItems';
import { getActiveCommandsFromScope } from '@core/hotkey/getCommands';
import { runCommand } from '@core/hotkey/utils';
import { Dialog } from '@kobalte/core/dialog';
import { Tabs } from '@kobalte/core/tabs';
import { registerHotkey, useHotkeyDOMScope } from 'core/hotkey/hotkeys';
import type { BlockName, BlockAlias } from '@core/block';
import {
  createEffect,
  createMemo,
  createSelector,
  createSignal,
  For,
  on,
  onMount,
  Show,
} from 'solid-js';
import { type VirtualizerHandle, VList } from 'virtua/solid';
import { useSplitLayout } from '../split-layout/layout';
import { CommandItem } from './CommandItem';
import { CommandState } from './state';
import { useCommandItems } from './useCommandItems';
import type { CategoryFilter } from './types';
import { itemToBlockName } from '@core/constant/allBlocks';
import { cn } from '@ui/utils/classname';
import Macro from '@macro-icons/macro-logo.svg';
import ArrowLeft from '@icon/regular/arrow-left.svg';
import { debouncedDependent } from '@core/util/debounce';
import { Hotkey } from '@core/component/Hotkey';
import { InlineEntity, type EntityData } from '@entity';
import { globalSplitManager } from '@app/signal/splitLayout';
import { createIsActiveSplitContentMemo } from '../split-layout/layoutUtils';

const CATEGORIES: { id: CategoryFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'channels', label: 'Channels' },
  { id: 'dms', label: 'Dms' },
  { id: 'notes', label: 'Notes' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'documents', label: 'Docs' },
  { id: 'chats', label: 'Chats' },
  { id: 'projects', label: 'Projects' },
  { id: 'commands', label: 'Commands' },
];

const VIRTUAL_ITEM_HEIGHT = 40; // tailwind h-10
const MAX_LIST_HEIGHT = VIRTUAL_ITEM_HEIGHT * 8;
const EMPTY_STATE_HEIGHT = VIRTUAL_ITEM_HEIGHT * 1.5;

function getBlockNameForEntity(
  item: CommandMenuItem
): BlockName | BlockAlias | undefined {
  if (isEntityItem(item)) {
    return itemToBlockName(item.data);
  }
  return undefined; // no block for commands or users
}

export function CommandMenu() {
  const [commandMenuRef, setCommandMenuRef] = createSignal<HTMLDivElement>();
  const splitManager = globalSplitManager();
  const isListMode = splitManager
    ? createIsActiveSplitContentMemo(
        splitManager.activeSplit,
        'component',
        'unified-list'
      )
    : () => true; // assume list mode

  createEffect(() => {
    const open = CommandState.isOpen();
    if (!isListMode()) {
      CommandState.clearEntityActionEntities();
    }
    if (open) {
      CommandState.onMenuOpen();
    } else {
      CommandState.onMenuClose();
    }
  });

  return (
    <Dialog open={CommandState.isOpen()} onOpenChange={CommandState.setIsOpen}>
      <Dialog.Portal>
        <DialogWrapper contentRef={setCommandMenuRef}>
          <CommandMenuInner commandMenuRef={commandMenuRef} />
        </DialogWrapper>
      </Dialog.Portal>
    </Dialog>
  );
}

function CommandMenuInner(props: {
  commandMenuRef: () => HTMLDivElement | undefined;
}) {
  const { openWithSplit } = useSplitLayout();

  const [attachHotkeys, hotkeyScope] = useHotkeyDOMScope('command-menu');

  const query = debouncedDependent(CommandState.query, 60);

  const filteredItems = useCommandItems(query, CommandState.categoryFilter);

  createEffect(() => {
    const items = filteredItems();
    const current = CommandState.selectedIndex();
    if (current >= items.length && items.length > 0) {
      CommandState.setSelectedIndex(items.length - 1);
    }
  });

  createEffect(
    on(query, () => {
      CommandState.setSelectedIndex(0);
    })
  );

  const selectedItem = () => {
    const items = filteredItems();
    const index = CommandState.selectedIndex();
    return items[index];
  };

  function handleItemAction(item: CommandMenuItem, openInNewSplit = false) {
    if (!item) return;

    if (isCommandItem(item)) {
      const command = item.data;

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
      const blockName = getBlockNameForEntity(item);
      if (blockName) {
        openWithSplit(
          { type: blockName, id: item.id },
          {
            referredFrom: 'kommand-menu',
            preferNewSplit: openInNewSplit,
          }
        );
      }
      CommandState.close();
      CommandState.setQuery('');
      return;
    }

    CommandState.close();
    CommandState.setQuery('');
  }

  registerHotkey({
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

  registerHotkey({
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

  registerHotkey({
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

  registerHotkey({
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

  registerHotkey({
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
  registerHotkey({
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

  registerHotkey({
    hotkey: 'tab',
    scopeId: hotkeyScope,
    description: 'Next category',
    keyDownHandler: () => {
      const currentIndex = CATEGORIES.findIndex(
        (c) => c.id === CommandState.categoryFilter()
      );
      const nextIndex = (currentIndex + 1) % CATEGORIES.length;
      CommandState.setCategoryFilter(CATEGORIES[nextIndex].id);
      CommandState.setSelectedIndex(0);
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
      CommandState.setSelectedIndex(0);
      return true;
    },
    runWithInputFocused: true,
    hide: true,
  });

  onMount(() => {
    const element = props.commandMenuRef();
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

  const handleBackFromCommandScope = () => {
    CommandState.clearCommandScopeCommands();
    CommandState.setSelectedIndex(0);
  };

  // Show back button only in command scope (entity action mode just closes)
  const showBackButton = () => isInCommandScope();

  const handleBack = () => {
    if (isInCommandScope()) {
      handleBackFromCommandScope();
    }
  };

  return (
    <div class="flex flex-col">
      {/* Search Input */}
      <div class="flex items-center gap-2 bg-panel px-2 h-10 border-b border-edge-muted/50">
        <Show
          when={showBackButton()}
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
          class="flex-1 bg-transparent border-0 outline-none focus:outline-none ring-0 focus:ring-0 text-ink-muted placeholder:text-ink-placeholder/50"
          placeholder={isEntityActionMode() ? 'Search actions...' : 'Search...'}
          value={CommandState.query()}
          onInput={(e) => CommandState.setQuery(e.currentTarget.value)}
          autofocus
        />
      </div>

      {/* Entity Action Preview Row */}
      <Show when={isEntityActionMode()}>
        <EntityActionPreview entities={CommandState.entityActionEntities()} />
      </Show>

      <Show when={!isInCommandScope() && !isEntityActionMode()}>
        <CategoryFilterTabs />
      </Show>

      <ResultsContainer
        items={filteredItems()}
        selectedIndex={CommandState.selectedIndex()}
        onSelect={(item, openInNewSplit) =>
          handleItemAction(item, openInNewSplit)
        }
        onMouseEnter={handleMouseEnter}
      />

      <CommandMenuFooter
        selectedItem={selectedItem()}
        isInCommandScope={isInCommandScope()}
        isEntityActionMode={isEntityActionMode()}
      />
    </div>
  );
}

/** Preview row showing entities being acted upon in entity action mode */
function EntityActionPreview(props: { entities: EntityData[] }) {
  const displayEntities = () => props.entities.slice(0, 2);
  const remainingCount = () => Math.max(0, props.entities.length - 2);

  return (
    <div class="flex items-center gap-2 px-3 py-2 bg-panel border-b border-edge-muted/50">
      <For each={displayEntities()}>
        {(entity) => {
          return (
            <div
              class={cn('bg-edge/20 px-2 py-1 truncate text-xs rounded-xs', {
                'max-w-[50%]': props.entities.length === 2,
              })}
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
    </div>
  );
}

function ResultsContainer(props: {
  items: CommandMenuItem[];
  selectedIndex: number;
  onSelect: (item: CommandMenuItem, openInNewSplit: boolean) => void;
  onMouseEnter: (index: number) => void;
}) {
  const containerHeight = () => {
    const count = props.items.length;
    if (count === 0) return EMPTY_STATE_HEIGHT;
    const totalHeight = count * VIRTUAL_ITEM_HEIGHT;
    return Math.min(MAX_LIST_HEIGHT, totalHeight);
  };

  return (
    <div
      class="bg-panel overflow-hidden transition-[height] duration-60 ease-out"
      style={{ height: `${containerHeight()}px` }}
    >
      <Show
        when={props.items.length > 0}
        fallback={
          <div class="px-4 py-4 text-center text-ink-muted">
            No results found
          </div>
        }
      >
        <VirtualizedCommandList
          items={props.items}
          selectedIndex={props.selectedIndex}
          onSelect={props.onSelect}
          onMouseEnter={props.onMouseEnter}
        />
      </Show>
    </div>
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
    if (index >= 0 && index < props.items.length && virtualizerHandle) {
      virtualizerHandle.scrollToIndex(index, { align: 'nearest' });
    }
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

function HotkeyHint(props: { shortcut: string; label: string }) {
  return (
    <span class="flex items-center gap-1">
      <div class="flex border border-edge-muted text-[0.625rem] rounded-xs items-center px-1.5 py-0.25 font-normal">
        <Hotkey shortcut={props.shortcut} class="space-x-1" />
      </div>
      {props.label}
    </span>
  );
}

function CommandMenuFooter(props: {
  selectedItem: CommandMenuItem | undefined;
  isInCommandScope: boolean;
  isEntityActionMode?: boolean;
}) {
  const isCommand = () =>
    props.selectedItem && isCommandItem(props.selectedItem);
  const isEntity = () => props.selectedItem && isEntityItem(props.selectedItem);

  return (
    <div class="flex items-center gap-4 px-4 py-2 bg-panel border-t border-edge-muted text-xs text-ink-extra-muted/80">
      <span class="flex items-center gap-1">
        <div class="flex gap-1">
          <div class="flex border border-edge-muted text-[0.625rem] rounded-xs items-center px-1.5 py-0.25 font-normal">
            <Hotkey shortcut="arrowup" class="space-x-1" />
          </div>
          <div class="flex border border-edge-muted text-[0.625rem] rounded-xs items-center px-1.5 py-0.25 font-normal">
            <Hotkey shortcut="arrowdown" class="space-x-1" />
          </div>
        </div>
        Navigate
      </span>

      <Show
        when={props.isInCommandScope}
        fallback={
          <Show
            when={isCommand() || props.isEntityActionMode}
            fallback={
              <Show when={isEntity()}>
                <HotkeyHint shortcut="enter" label="Open" />
                <HotkeyHint shortcut="shift+enter" label="Open in new split" />
              </Show>
            }
          >
            <HotkeyHint shortcut="enter" label="Run action" />
          </Show>
        }
      >
        <HotkeyHint shortcut="enter" label="Run action" />
        <HotkeyHint shortcut="escape" label="Back" />
      </Show>

      <Show when={!props.isInCommandScope && !props.isEntityActionMode}>
        <HotkeyHint shortcut="tab" label="Category" />
      </Show>
      <Show
        when={props.isInCommandScope}
        fallback={<HotkeyHint shortcut="escape" label="Close" />}
      >
        <HotkeyHint shortcut="escape" label="Back" />
      </Show>
    </div>
  );
}

function CategoryFilterTabs() {
  return (
    <Tabs
      value={CommandState.categoryFilter()}
      onChange={(value) => {
        if (value) {
          CommandState.setCategoryFilter(value as CategoryFilter);
          CommandState.setSelectedIndex(0);
        }
      }}
      class="border-b border-edge-muted/50"
    >
      <Tabs.List class="flex items-center px-2 py-1.5">
        <For each={CATEGORIES}>
          {(category) => (
            <Tabs.Trigger
              value={category.id}
              class={cn(
                'px-2 py-1 text-xs border first:border-l-1 border-l-0 border-edge-muted/50 font-semibold',
                CommandState.categoryFilter() === category.id
                  ? 'text-ink pattern bg-edge-muted'
                  : 'text-ink-muted/70 hover:text-ink hover:bg-hover'
              )}
              tabIndex={-1}
            >
              {category.label}
            </Tabs.Trigger>
          )}
        </For>
      </Tabs.List>
    </Tabs>
  );
}
