import { ClippedPanel } from '@core/component/ClippedPanel';
import { DialogWrapper } from '@core/component/DialogWrapper';
import { Dialog } from '@kobalte/core/dialog';
import { registerHotkey, useHotkeyDOMScope } from 'core/hotkey/hotkeys';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onMount,
  Show,
} from 'solid-js';
import { beveledCorners } from '../../../block-theme/signals/themeSignals';
import { useSplitLayout } from '../split-layout/layout';
import { CommandItemRenderer } from './CommandItem';
import {
  isOpen,
  setIsOpen,
  query,
  setQuery,
  selectedIndex,
  setSelectedIndex,
  categoryFilter,
  setCategoryFilter,
  maybeResetState,
  onMenuClose,
  closeCommandMenu,
} from './state';
import { useCommandItems, useFilteredCommandItems } from './useCommandItems';
import type { CommandItem, CategoryFilter } from './types';
import { itemToBlockName } from '@core/constant/allBlocks';
import { runCommand } from '@core/hotkey/utils';

const MAX_VISIBLE_ITEMS = 12;

export function CommandMenu() {
  const [commandMenuRef, setCommandMenuRef] = createSignal<HTMLDivElement>();

  // Reset state when opening after delay
  createEffect(() => {
    const open = isOpen();
    if (open) {
      maybeResetState();
    } else {
      onMenuClose();
    }
  });

  return (
    <Dialog open={isOpen()} onOpenChange={setIsOpen}>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-modal bg-transparent" />
        <DialogWrapper>
          <div ref={setCommandMenuRef}>
            <Dialog.Content>
              <ClippedPanel tl={!beveledCorners()} active>
                <CommandMenuInner commandMenuRef={commandMenuRef} />
              </ClippedPanel>
            </Dialog.Content>
          </div>
        </DialogWrapper>
      </Dialog.Portal>
    </Dialog>
  );
}

function CommandMenuInner(props: {
  commandMenuRef: () => HTMLDivElement | undefined;
}) {
  const [attachHotkeys, hotkeyScope] = useHotkeyDOMScope('command-menu');
  const { openWithSplit } = useSplitLayout();

  // Get all items
  const { allItems } = useCommandItems();

  // Get filtered items based on query and category
  const filteredItems = useFilteredCommandItems(
    allItems,
    query,
    categoryFilter
  );

  // Clamp selected index when items change
  createEffect(() => {
    const items = filteredItems();
    const current = selectedIndex();
    if (current >= items.length && items.length > 0) {
      setSelectedIndex(items.length - 1);
    }
  });

  // Reset selected index when query changes
  createEffect(() => {
    query(); // Track query changes
    setSelectedIndex(0);
  });

  // Get the currently selected item
  const selectedItem = createMemo(() => {
    const items = filteredItems();
    const index = selectedIndex();
    return items[index];
  });

  // Handle item selection/action
  function handleItemAction(item: CommandItem, openInNewSplit = false) {
    if (!item) return;

    switch (item.type) {
      case 'history': {
        const blockName = itemToBlockName(item.data.historyItem);
        if (blockName) {
          openWithSplit(
            { type: blockName, id: item.data.id },
            {
              referredFrom: 'kommand-menu',
              preferNewSplit: openInNewSplit,
            }
          );
        }
        closeCommandMenu();
        setQuery('');
        break;
      }

      case 'channel': {
        openWithSplit(
          { type: 'channel', id: item.data.id },
          {
            referredFrom: 'kommand-menu',
            preferNewSplit: openInNewSplit,
          }
        );
        closeCommandMenu();
        setQuery('');
        break;
      }

      case 'command': {
        closeCommandMenu();
        setQuery('');
        runCommand(item.data.command);
        break;
      }
    }
  }

  // Keyboard navigation
  registerHotkey({
    hotkey: 'arrowdown',
    scopeId: hotkeyScope,
    description: 'Move selection down',
    keyDownHandler: () => {
      const items = filteredItems();
      if (items.length === 0) return false;
      setSelectedIndex((prev) => (prev + 1) % items.length);
      return true;
    },
    runWithInputFocused: true,
    hide: true,
  });

  registerHotkey({
    hotkey: 'arrowup',
    scopeId: hotkeyScope,
    description: 'Move selection up',
    keyDownHandler: () => {
      const items = filteredItems();
      if (items.length === 0) return false;
      setSelectedIndex((prev) => (prev - 1 + items.length) % items.length);
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
      closeCommandMenu();
      return true;
    },
    runWithInputFocused: true,
    hide: true,
  });

  // Attach hotkey scope on mount
  onMount(() => {
    const element = props.commandMenuRef();
    if (element) {
      attachHotkeys(element);
    }
  });

  // Handle mouse enter (for keyboard/mouse interaction)
  const [isKeyboardActive, setIsKeyboardActive] = createSignal(false);

  function handleMouseEnter(index: number) {
    if (isKeyboardActive()) return;
    setSelectedIndex(index);
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

  return (
    <div class="flex flex-col w-[500px] max-w-[90vw]">
      {/* Search Input */}
      <div class="flex items-center gap-2 bg-panel px-2 h-[44px] border-b border-edge-muted">
        <span class="pl-2 text-ink-muted">❯</span>
        <input
          type="text"
          class="flex-1 bg-transparent border-0 outline-none focus:outline-none ring-0 focus:ring-0 text-ink placeholder:text-ink-muted"
          placeholder="Search..."
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
          autofocus
        />
      </div>

      {/* Category Filter */}
      <CategoryFilterBar />

      {/* Results List */}
      <div class="bg-panel max-h-[384px] overflow-y-auto scrollbar-hidden">
        <Show
          when={filteredItems().length > 0}
          fallback={
            <div class="px-4 py-8 text-center text-ink-muted">
              No results found
            </div>
          }
        >
          <div class="py-1">
            <For each={filteredItems().slice(0, MAX_VISIBLE_ITEMS)}>
              {(item, index) => (
                <CommandItemRenderer
                  item={item}
                  index={index()}
                  selected={selectedIndex() === index()}
                  onSelect={(item) => handleItemAction(item, false)}
                  onMouseEnter={handleMouseEnter}
                />
              )}
            </For>
          </div>
          <Show when={filteredItems().length > MAX_VISIBLE_ITEMS}>
            <div class="px-4 py-2 text-xs text-ink-muted border-t border-edge-muted">
              {filteredItems().length - MAX_VISIBLE_ITEMS} more items...
            </div>
          </Show>
        </Show>
      </div>

      {/* Footer with hints */}
      <div class="flex items-center gap-4 px-4 py-2 bg-panel border-t border-edge-muted text-xs text-ink-muted">
        <span>
          <kbd class="px-1 py-0.5 bg-panel-hover rounded">↑↓</kbd> Navigate
        </span>
        <span>
          <kbd class="px-1 py-0.5 bg-panel-hover rounded">Enter</kbd> Open
        </span>
        <span>
          <kbd class="px-1 py-0.5 bg-panel-hover rounded">⇧Enter</kbd> New Split
        </span>
        <span>
          <kbd class="px-1 py-0.5 bg-panel-hover rounded">Esc</kbd> Close
        </span>
      </div>
    </div>
  );
}

/** Category filter bar component */
function CategoryFilterBar() {
  const categories: { id: CategoryFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'documents', label: 'Docs' },
    { id: 'channels', label: 'Channels' },
    { id: 'chats', label: 'Chats' },
    { id: 'commands', label: 'Commands' },
  ];

  return (
    <div class="flex items-center gap-1 px-2 py-1.5 bg-panel border-b border-edge-muted">
      <For each={categories}>
        {(category) => (
          <button
            type="button"
            class="px-2 py-1 text-xs rounded transition-colors"
            classList={{
              'bg-active text-ink font-medium':
                categoryFilter() === category.id,
              'text-ink-muted hover:text-ink hover:bg-panel-hover':
                categoryFilter() !== category.id,
            }}
            onClick={() => {
              setCategoryFilter(category.id);
              setSelectedIndex(0);
            }}
          >
            {category.label}
          </button>
        )}
      </For>
    </div>
  );
}
