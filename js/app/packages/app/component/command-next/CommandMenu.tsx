import { ClippedPanel } from '@core/component/ClippedPanel';
import { DialogWrapper } from '@core/component/DialogWrapper';
import {
  type QuickAccessItem,
  isEntityItem,
  isCommandItem,
} from '@core/context/quickAccess';
import { runCommand } from '@core/hotkey/utils';
import { Dialog } from '@kobalte/core/dialog';
import { registerHotkey, useHotkeyDOMScope } from 'core/hotkey/hotkeys';
import type { DocumentEntity } from '@entity';
import type { BlockName, BlockAlias } from '@core/block';
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
import { useFilteredItems } from './useCommandItems';
import type { CategoryFilter } from './types';

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

/** Get block name for opening an entity item */
function getBlockNameForEntity(
  item: QuickAccessItem
): BlockName | BlockAlias | undefined {
  if (!isEntityItem(item)) return undefined;

  const data = item.data;

  switch (data.type) {
    case 'channel':
      return 'channel';
    case 'chat':
      return 'chat';
    case 'project':
      return 'project';
    case 'document': {
      const doc = data as DocumentEntity;
      if (doc.subType?.type === 'task') return 'task';
      if (doc.fileType === 'md') return 'md';
      if (doc.fileType === 'pdf') return 'pdf';
      if (doc.fileType === 'canvas') return 'canvas';
      return 'md';
    }
    default:
      return undefined;
  }
}

function CommandMenuInner(props: {
  commandMenuRef: () => HTMLDivElement | undefined;
}) {
  const [attachHotkeys, hotkeyScope] = useHotkeyDOMScope('command-menu');
  const { openWithSplit } = useSplitLayout();

  // Get filtered items based on query and category using QuickAccess
  const filteredItems = useFilteredItems(query, categoryFilter);

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
  function handleItemAction(item: QuickAccessItem, openInNewSplit = false) {
    if (!item) return;

    // Handle command items
    if (isCommandItem(item)) {
      closeCommandMenu();
      setQuery('');
      runCommand(item.data);
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
      closeCommandMenu();
      setQuery('');
      return;
    }

    // Handle user items - open DM or profile
    // For now, just close the menu
    closeCommandMenu();
    setQuery('');
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
    { id: 'people', label: 'People' },
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
