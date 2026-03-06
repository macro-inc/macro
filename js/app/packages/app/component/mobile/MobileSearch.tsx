/** Mobile Search is based on Command Menu. */
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
import { cn } from '@ui/utils/classname';
import Macro from '@macro-icons/macro-logo.svg';
import ArrowLeft from '@icon/regular/arrow-left.svg';
import { debouncedDependent } from '@core/util/debounce';
import { Hotkey } from '@core/component/Hotkey';
import { InlineEntity, type EntityData } from '@entity';
import { globalSplitManager } from '@app/signal/splitLayout';
import { isListViewID } from '@app/constants/list-views';
import { isMobile } from '@core/mobile/isMobile';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { CategoryFilter } from '../command/types';
import {
  CommandMenuItem,
  isCommandItem,
  isEntityItem,
  useCommandItems,
} from '../command/useCommandItems';
import { SearchState } from './mobileSearchState';
import { CommandItem } from '../command/CommandItem';
import { getBlockNameForEntity } from '../command/CommandMenu';

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

export function MobileSearchOuter() {
  return (
    <Dialog open={SearchState.isOpen()} onOpenChange={SearchState.setIsOpen}>
      <Dialog.Portal>
        <Dialog.Content
          class={cn(
            'fixed inset-0 z-modal flex flex-col h-[calc(var(--dvh,1dvh)*100)] pt-[var(--safe-top)] pl-[var(--safe-left)] pr-[var(--safe-right)]',
            {
              'pb-[var(--safe-bottom)]': !virtualKeyboardVisible(),
            }
          )}
        >
          <MobileSearchInner />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}

export function MobileSearchInner(props: {
  commandMenuRef?: () => HTMLDivElement | undefined;
}) {
  const { openWithSplit } = useSplitLayout();

  const query = debouncedDependent(SearchState.query, 60);

  const filteredItems = useCommandItems(query, SearchState.categoryFilter);

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
        SearchState.setQuery('');
        SearchState.setCommandScopeCommands(nestedCommands);
        return;
      }

      // Regular command - close and run
      SearchState.close();
      SearchState.setQuery('');
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
      SearchState.close();
      SearchState.setQuery('');
      return;
    }

    SearchState.close();
    SearchState.setQuery('');
  }

  const isInCommandScope = createMemo(
    () => SearchState.commandScopeCommands().length > 0
  );

  const handleBackFromCommandScope = () => {
    SearchState.clearCommandScopeCommands();
  };

  // Show back button only in command scope (entity action mode just closes)
  const showBackButton = () => isInCommandScope() || isMobile();

  const handleBack = () => {
    if (isInCommandScope()) {
      handleBackFromCommandScope();
    } else {
      SearchState.close();
    }
  };

  return (
    <div class="flex flex-col mobile:h-full bg-panel">
      {/* Search Input */}
      <div class="mobile:order-last flex items-center gap-2 bg-panel mobile:bg-page px-2 mobile:px-0 h-10 mobile:h-auto border-b mobile:border-b-0 mobile:border-t border-edge-muted/50 mobile:border-edge-muted">
        <Show
          when={showBackButton()}
          fallback={
            <span class="pl-2 text-accent">
              <Macro class="size-3" />
            </span>
          }
        >
          <button
            class="pl-2 mobile:pl-0 text-ink-muted mobile:text-ink hover:text-ink transition-colors flex flex-col items-center justify-center mobile:w-[20%] mobile:pt-3"
            onClick={handleBack}
            title="Back (Esc)"
          >
            <ArrowLeft class="mobile:size-6 size-3" />
            <Show when={isMobile()}>
              <div class="text-xs">Back</div>
            </Show>
          </button>
        </Show>
        <input
          type="text"
          class="flex-1 bg-transparent border-0 outline-none focus:outline-none ring-0 focus:ring-0 text-ink-muted placeholder:text-ink-placeholder/50"
          placeholder={'Search...'}
          value={SearchState.query()}
          onInput={(e) => SearchState.setQuery(e.currentTarget.value)}
          autofocus
        />
      </div>

      <Show when={!isInCommandScope()}>
        <CategoryFilterTabs />
      </Show>

      <ResultsContainer
        items={filteredItems()}
        onSelect={(item, openInNewSplit) =>
          handleItemAction(item, openInNewSplit)
        }
      />
    </div>
  );
}

function ResultsContainer(props: {
  items: CommandMenuItem[];
  onSelect: (item: CommandMenuItem, openInNewSplit: boolean) => void;
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
      style={{ height: isMobile() ? '100%' : `${containerHeight()}px` }}
    >
      <Show
        when={props.items.length > 0}
        fallback={
          <div class="px-4 py-4 text-center text-ink-muted">
            No results found
          </div>
        }
      >
        <VirtualizedCommandList items={props.items} onSelect={props.onSelect} />
      </Show>
    </div>
  );
}

/** Virtualized command list component */
function VirtualizedCommandList(props: {
  items: CommandMenuItem[];
  onSelect: (item: CommandMenuItem, openInNewSplit: boolean) => void;
}) {
  let virtualizerHandle: VirtualizerHandle | undefined;

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
          selected={false}
          onSelect={props.onSelect}
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

function CategoryFilterTabs() {
  return (
    <Tabs
      value={SearchState.categoryFilter()}
      onChange={(value) => {
        if (value) {
          SearchState.setCategoryFilter(value as CategoryFilter);
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
                SearchState.categoryFilter() === category.id
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
