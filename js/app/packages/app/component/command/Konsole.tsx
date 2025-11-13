import { useChannelsContext } from '@core/component/ChannelsProvider';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { ENABLE_SEARCH_PAGINATION } from '@core/constant/featureFlags';
import type { CommandWithInfo } from '@core/hotkey/getCommands';
import { cornerClip } from '@core/util/clipPath';
import { createFreshSearch } from '@core/util/freshSort';
import { Popover } from '@kobalte/core';
import { Command as CommandK, useCommandState } from 'cmdk-solid';
import {
  registerHotkey,
  runCommand,
  useHotkeyDOMScope,
} from 'core/hotkey/hotkeys';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSXElement,
  onMount,
  Show,
  untrack,
} from 'solid-js';
import { VList } from 'virtua/solid';
import FullTextModeToggle from './FullTextModeToggle';
import { KonsoleFilter } from './KonsoleFilter';
import {
  COMMAND_ITEM_HEIGHT,
  COMMAND_ITEM_MARGIN,
  COMMAND_ITEM_PADDING,
  CommandItemCard,
  createChannelLookup,
  filterItemByCategory,
  hydrateChannel,
  setCommandCategoryIndex,
  useCommandItemAction,
} from './KonsoleItem';
import {
  cleanQuery,
  createModeListenerEffects,
  currentKonsoleMode,
  getModeConfig,
  immediatelySetRawQuery,
  konsoleOpen,
  lastCommandTime,
  rawQuery,
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
        immediatelySetRawQuery(mode.sigil);
        setCommandCategoryIndex(0);
      }
    }
  });

  const CommandWindow = (props: { children?: JSXElement }) => {
    return (
      <div
        class="z-50 fixed inset-0 flex flex-row justify-center items-center bg-modal-overlay-konsole"
        ref={setCommandKRef}
      >
        {props.children}
      </div>
    );
  };

  return (
    <StaticMarkdownContext>
      <Popover.Root
        open={konsoleOpen()}
        onOpenChange={(_) => toggleKonsoleVisibility()}
      >
        <Popover.Anchor />
        <Popover.Portal>
          <CommandWindow>
            <Popover.Content>
              <div class="bg-dialog mt-[25vh] border-2 border-accent w-6xl max-w-[90vw] max-h-[75vh] overflow-hidden">
                <div
                  class="left-0 absolute bg-accent py-1.5 pr-10 pl-2 font-mono font-black text-menu text-xs -translate-y-full"
                  style={{ 'clip-path': cornerClip(0, '1.5rem', 0, 0) }}
                >
                  <svg
                    fill="none"
                    viewBox="0 0 127 16"
                    xmlns="http://www.w3.org/2000/svg"
                    xmlns:xlink="http://www.w3.org/1999/xlink"
                    class="h-2"
                  >
                    <clipPath id="a">
                      <path d="m.599609 0h125.8v16h-125.8z" />
                    </clipPath>
                    <g clip-path="url(#a)" fill="currentColor">
                      <path d="m108.249 0c-2.397 0-4.381 1.94809-4.381 4.30241v7.37539c0 2.3543 1.984 4.3024 4.381 4.3024h13.769c2.398 0 4.382-1.9481 4.382-4.3024v-7.37539c0-2.35432-1.984-4.30241-4.382-4.30241zm0 3.68767h13.769c.368 0 .626.25328.626.61455v7.37538c0 .3612-.258.6145-.626.6145h-13.769c-.368 0-.626-.2533-.626-.6145v-7.37519c0-.36126.258-.61474.626-.61474z" />
                      <path d="m78.8333 0v15.98h3.7552v-4.917h11.6697l2.5034 4.917h4.1994l-2.6237-5.1522c1.7427-.5698 3.0277-2.1784 3.0277-4.067v-2.45839c0-2.35432-1.984-4.30241-4.3815-4.30241zm3.7552 3.68767h14.395c.3679 0 .6258.25328.6258.61455v2.45838c0 .36127-.2579.61455-.6258.61455h-14.395z" />
                      <path d="m58.1792 0c-2.3972 0-4.381 1.94809-4.381 4.30241v7.37539c0 2.3543 1.9838 4.3024 4.381 4.3024h18.1505v-3.6877h-18.1505c-.3679 0-.6258-.2533-.6258-.6145v-7.37559c0-.36126.2579-.61454.6258-.61454h18.1505v-3.68787z" />
                      <path d="m33.1443.0200268c-2.3974 0-4.381 1.9480932-4.381 4.3024132v11.67776h3.7552v-4.9374h15.0209v4.9374h3.7552v-11.67776c0-2.35432-1.9836-4.3024132-4.381-4.3024132zm0 3.6876732h13.7693c.3678 0 .6258.25328.6258.61454v3.05271h-15.0209v-3.05271c0-.36126.2579-.61454.6258-.61454z" />
                      <path d="m.599609 0v15.98h3.755211v-12.29233h2.35626c.19253 0 .38028.05969.53603.17082.15595.11093.27211.26761.33189.44746l3.8762 11.67425h3.9495l3.888-11.70783c.0564-.16983.1659-.31787.3131-.42291.1473-.10505.3245-.16159.5064-.16159h2.3931v12.29233h3.7552v-15.9802h-8.873c-.1819 0-.3591.0567425-.5064.161588-.1472.105043-.2568.253084-.3131.422918l-3.138 9.447894-3.1379-9.447894c-.0563-.169834-.1659-.317875-.31326-.422918-.14715-.1050419-.3245-.161588-.50644-.161588z" />
                    </g>
                  </svg>
                </div>

                <KommandMenuInner commandKRef={commandKRef} />
              </div>
            </Popover.Content>
          </CommandWindow>
        </Popover.Portal>
      </Popover.Root>
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
            hotkeys: command.hotkeys ?? [],
            handler: () => {
              runCommand({
                keyDownHandler: command.keyDownHandler,
                activateCommandScopeId: command.activateCommandScopeId,
              });
              setCommandScopeCommands([]);
              return true;
            },
            activateCommandScopeId: command.activateCommandScopeId,
          },
        };
      });
    }
    return Array.from(allItemMap().values());
  });
  const channelsContext = useChannelsContext();

  const freshSearch = createFreshSearch<CommandItemCard>({}, (item) => {
    return item.data.name;
  });

  const searchItems = createMemo(() => {
    let actionItems: CommandItemCard[] = [];
    const otherItems = freshSearch(allItems(), rawQuery())
      .map((result) => result.item)
      .filter((item) => {
        if (item.type === 'command') {
          actionItems.push(item);
          return false;
        }
        return true;
      });
    return [...actionItems, ...otherItems];
  });

  createModeListenerEffects();

  // Prevent unnecessary ftsearches
  const fullTextQueryOrBlank = () => {
    if (currentKonsoleMode() !== 'FULL_TEXT_SEARCH') return '';
    return cleanQuery();
  };
  const paginatedSearch = usePaginatedSearchItems(fullTextQueryOrBlank);
  const channelLookup = createChannelLookup(channelsContext);

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
    if (currentKonsoleMode() === 'FULL_TEXT_SEARCH')
      return ([] as CommandItemCard[])
        .concat(paginatedSearch.items())
        .concat(loadMoreItem())
        .map((item: CommandItemCard) => hydrateChannel(item, channelLookup()))
        .filter((item: CommandItemCard) => {
          return filterItemByCategory(item);
        });
    return searchItems().filter((item: CommandItemCard) => {
      return filterItemByCategory(item);
    });
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
    hotkey: 'opt+enter',
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
      class="flex flex-col gap-px bg-accent w-full"
      value={currentValue()}
      shouldFilter={false}
      onValueChange={(value) => {
        if (isLoadingMore()) return;
        setCurrentValue(value);
      }}
    >
      <div
        class="flex items-center gap-2 bg-menu p-3"
        style={{ 'clip-path': cornerClip(0, 0, '0.25rem', '0.25rem') }}
      >
        <span class="text-accent">❯</span>
        <CommandK.Input
          value={rawQuery()}
          placeholder="Search files..."
          class="flex-1 border-0 outline-none! focus:outline-none ring-0! focus:ring-0 font-mono placeholder:text-edge text-accent-270"
          onValueChange={setRawQuery}
        />
        <FullTextModeToggle
          checked={currentKonsoleMode() === 'FULL_TEXT_SEARCH'}
        />
      </div>
      <div
        class="bg-menu"
        style={{ 'clip-path': cornerClip('0.25rem', '0.25rem', 0, 0) }}
      >
        <KonsoleFilter />
        <CommandK.List class="scrollbar-hidden">
          <CommandK.Empty>
            <div class="px-2 pb-2 text-ink-muted">
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
                class="scrollbar-hidden pb-2 bg-dialog"
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
