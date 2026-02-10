import { useChannelsContext } from '@core/context/channels';
import { ClippedPanel } from '@core/component/ClippedPanel';
import { DialogWrapper } from '@core/component/DialogWrapper';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { ENABLE_SEARCH_PAGINATION } from '@core/constant/featureFlags';
import type { CommandWithInfo } from '@core/hotkey/getCommands';
import { createFreshSearch } from '@core/util/freshSort';
import { Dialog } from '@kobalte/core/dialog';
import { Command as CommandK, useCommandState } from 'cmdk-solid';
import { registerHotkey, useHotkeyDOMScope } from 'core/hotkey/hotkeys';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  For,
  onMount,
  Show,
  untrack,
} from 'solid-js';
import { VList } from 'virtua/solid';
import { beveledCorners } from '../../../block-theme/signals/themeSignals';
import { KonsoleFilter } from './KonsoleFilter';
import {
  type ChannelLookup,
  COMMAND_ITEM_HEIGHT,
  COMMAND_ITEM_MARGIN,
  COMMAND_ITEM_PADDING,
  CommandItemCard,
  filterItemByCategory,
  hydrateChannel,
  setCommandCategoryIndex,
  useCommandItemAction,
} from './KonsoleItem';
import {
  cleanQuery,
  createModeListenerEffects,
  currentKonsoleMode,
  debouncedLocalQuery,
  debouncedSearchServiceQuery,
  getModeConfig,
  konsoleOpen,
  lastCommandTime,
  rawQuery,
  setKonsoleOpen,
  setLastCommandTime,
  setRawQuery,
  toggleKonsoleVisibility,
} from './state';
import { useCommandItems } from './useCommandItems';
import { usePaginatedSearchItems } from './useSearchItems';

// equivalent to h-96
const MAX_CONTAINER_HEIGHT = 96 * 4;

export function KommandMenu() {
  const [commandKRef, setCommandKRef] = createSignal<HTMLDivElement>();

  // Clear search term and full text search after 3 seconds when menu closes
  createEffect(() => {
    const isOpen = konsoleOpen();
    const now = Date.now();
    const TIME_THRESHOLD = 5 * 1000;

    if (!isOpen) {
      setLastCommandTime(now);
    } else {
      if (now - lastCommandTime() >= TIME_THRESHOLD) {
        const mode = getModeConfig(untrack(currentKonsoleMode));
        // keep the sigil (e.g., '%' for FULL_TEXT_SEARCH) so mode doesn’t flip
        setRawQuery(mode.sigil);
        setCommandCategoryIndex(0);
      }
    }
  });

  return (
    <StaticMarkdownContext>
      <Dialog
        open={konsoleOpen()}
        onOpenChange={(_) => toggleKonsoleVisibility()}
      >
        <Dialog.Portal>
          <Dialog.Overlay class="fixed inset-0 z-modal bg-transparent" />
          <DialogWrapper>
            <div ref={setCommandKRef}>
              <Dialog.Content>
                <ClippedPanel tl={!beveledCorners()} active>
                  <KommandMenuInner commandKRef={commandKRef} />
                </ClippedPanel>
              </Dialog.Content>
            </div>
          </DialogWrapper>
        </Dialog.Portal>
      </Dialog>
    </StaticMarkdownContext>
  );
}

export function KommandMenuInner(props: {
  commandKRef: Accessor<HTMLDivElement | undefined>;
}) {
  const [commandScopeCommands, setCommandScopeCommands] = createSignal<
    CommandWithInfo[]
  >([]);
  const [attachHotkeys, konsoleHotkeyScopeId] = useHotkeyDOMScope('konsole');
  const allItemMap = useCommandItems();
  const allItems = createMemo(() => {
    if (commandScopeCommands().length > 0) {
      return commandScopeCommands().map((command) => {
        const description =
          typeof command.description === 'function'
            ? command.description()
            : command.description;
        return {
          type: 'command' as const,
          data: {
            id: description.replaceAll(' ', '-'),
            name: description,
            command: command,
          },
        };
      });
    }
    return Array.from(allItemMap().values());
  });
  const channelsContext = useChannelsContext();

  const freshSearchConfig = createMemo(() => {
    const query = debouncedLocalQuery();
    const hasQuery = query && query.trim().length > 0;
    return {
      useViewedAt: true,
      channelBoost: hasQuery ? 1.5 : 1.0,
      fuzzyWeight: hasQuery ? 0.7 : 0.1,
      timeWeight: hasQuery ? 0.3 : 0.9,
      minFuzzyThreshold: hasQuery ? 0.1 : 0,
      commaSeparatedChannelMatch: true,
    };
  });

  const searchItems = createMemo(() => {
    const freshSearch = createFreshSearch<CommandItemCard>(
      freshSearchConfig(),
      (item) => item.data.name,
      (item) => item.type === 'channel',
      (_item) => ({})
    );
    return freshSearch(allItems(), debouncedLocalQuery()).map(
      (result) => result.item
    );
  });

  createModeListenerEffects();

  const isFullTextSearch = createMemo(
    () => currentKonsoleMode() === 'FULL_TEXT_SEARCH'
  );

  // Prevent unnecessary ftsearches
  const fullTextQueryOrBlank = createMemo(() => {
    if (!isFullTextSearch()) return '';
    return cleanQuery(debouncedSearchServiceQuery());
  });

  const paginatedSearch = usePaginatedSearchItems(fullTextQueryOrBlank);
  const channelLookup = () => channelsContext!.channelsById() as ChannelLookup;

  const handleLoadMore = async () => {
    const loadMoreIndex = filteredItems().length - 1; // Position of "Load More" button
    setIsLoadingMore(true);
    try {
      await paginatedSearch.loadMore();
      // Set selection to first new item (where "Load More" was)
      const newItems = filteredItems();
      if (newItems.length > loadMoreIndex) {
        const newValue = `${loadMoreIndex}-${newItems[loadMoreIndex]?.data.id}`;
        setCurrentValue(newValue);
      }
    } finally {
      setIsLoadingMore(false);
    }
  };

  const loadMoreItem = () => {
    if (!ENABLE_SEARCH_PAGINATION) return [];
    if (paginatedSearch.items().length === 0 || !paginatedSearch.hasMore()) {
      return [];
    }

    return [
      {
        type: 'loadmore',
        data: {
          id: 'load-more',
          name: paginatedSearch.isLoading() ? 'Loading...' : 'Load More',
        },
        loadMoreCallback: handleLoadMore,
      } as CommandItemCard,
    ];
  };

  // choose which items to display, based on which menu is open
  const filteredItems = createMemo(() => {
    if (isFullTextSearch()) {
      return [...paginatedSearch.items(), ...loadMoreItem()]
        .map((item) => hydrateChannel(item, channelLookup()))
        .filter(filterItemByCategory);
    }

    return searchItems().filter(filterItemByCategory);
  });

  const itemAction = useCommandItemAction({ setCommandScopeCommands });
  const [currentValue, setCurrentValue] = createSignal('');
  const [isLoadingMore, setIsLoadingMore] = createSignal(false);

  const getSelectedItem = createMemo(() => {
    if (!currentValue()) return undefined;
    const [indexStr] = currentValue().split('|');
    const index = parseInt(indexStr);
    return filteredItems()[index];
  });

  registerHotkey({
    hotkey: 'enter',
    scopeId: konsoleHotkeyScopeId,
    description: 'Open in current split',
    keyDownHandler: () => {
      const selectedItem = getSelectedItem();
      if (selectedItem) {
        itemAction(selectedItem, 'open');
        return false;
      }
      return false;
    },
    runWithInputFocused: true,
  });

  registerHotkey({
    hotkey: 'shift+enter',
    scopeId: konsoleHotkeyScopeId,
    description: 'Open in new split',
    keyDownHandler: () => {
      const selectedItem = getSelectedItem();
      if (selectedItem) {
        itemAction(selectedItem, 'new-split');
        return true;
      }
      return false;
    },
    runWithInputFocused: true,
  });

  registerHotkey({
    hotkey: 'escape',
    scopeId: konsoleHotkeyScopeId,
    description: 'Close command menu',
    keyDownHandler: () => {
      setKonsoleOpen(false);
      return true;
    },
    runWithInputFocused: true,
    hide: true,
  });

  const CommandKItemWrapper = (props: {
    index: number;
    item: CommandItemCard;
  }) => {
    const value = () => {
      return `${props.index}|${props.item.data.id}`;
    };
    const selected = useCommandState((state) => value() === state.value);

    return (
      <CommandK.Item value={value()}>
        <CommandItemCard
          item={props.item}
          index={props.index}
          selected={selected()}
          itemAction={itemAction}
          mouseEnter={() => {}}
        />
      </CommandK.Item>
    );
  };

  // HACK: the height of the container is dynamic, based on the elements
  // but we need a specific height to virtualize the list
  const containerHeight = createMemo(() => {
    // Full text search always uses max height for consistency
    if (currentKonsoleMode() === 'FULL_TEXT_SEARCH')
      return `${MAX_CONTAINER_HEIGHT}px`;
    const length = filteredItems().length;
    if (length === 0) return 0;
    let height = 0;
    const count = filteredItems().length;
    for (let i = 0; i < count; i++) {
      if (height >= MAX_CONTAINER_HEIGHT) break;
      height +=
        COMMAND_ITEM_HEIGHT +
        2 * COMMAND_ITEM_PADDING +
        2 * COMMAND_ITEM_MARGIN;
    }
    height += COMMAND_ITEM_PADDING;
    return `${Math.min(MAX_CONTAINER_HEIGHT, height)}px`;
  });

  // Attach hotkey scope when element is available
  onMount(() => {
    const element = props.commandKRef();
    if (element) {
      attachHotkeys(element);
    }
  });

  return (
    <CommandK
      label="Global CommandK Menu"
      class="flex flex-col gap-px w-full"
      value={currentValue()}
      shouldFilter={false}
      onValueChange={(value) => {
        if (isLoadingMore()) return;
        setCurrentValue(value);
      }}
    >
      <div class="flex items-center gap-2 bg-panel px-2 h-[40px] border-b border-edge-muted">
        <span class="pl-2 pointer-events-none">❯</span>
        <CommandK.Input
          class="flex-1 border-0 outline-none! focus:outline-none ring-0! focus:ring-0"
          onValueChange={setRawQuery}
          placeholder="Search"
          value={rawQuery()}
          autofocus
        />
      </div>
      <div class="bg-panel">
        <KonsoleFilter />
        <CommandK.List class="scrollbar-hidden">
          <CommandK.Empty>
            <div class="px-2 text-ink-muted min-h-[40px]">
              {currentKonsoleMode() === 'FULL_TEXT_SEARCH' &&
              cleanQuery().length < 3
                ? 'Enter 3 or more characters to search all documents.'
                : 'No results found.'}
            </div>
          </CommandK.Empty>
          <Show
            when={currentKonsoleMode() === 'FULL_TEXT_SEARCH'}
            fallback={
              <VList
                data={filteredItems()}
                style={{ height: containerHeight() }}
                class="scrollbar-hidden pb-2 bg-panel"
              >
                {(item, index) => (
                  <CommandKItemWrapper index={index()} item={item} />
                )}
              </VList>
            }
          >
            <For each={filteredItems()}>
              {(item, index) => (
                <CommandKItemWrapper index={index()} item={item} />
              )}
            </For>
          </Show>
        </CommandK.List>
      </div>
    </CommandK>
  );
}
