/** Mobile Search is based on Command Menu. */

import { openEntityInSplitFromUnifiedList } from '@app/component/next-soup/utils';
import { Tabs } from '@core/component/Tabs';
import { TailSpinner } from '@core/component/TailSpinner';
import { itemToBlockName } from '@core/constant/allBlocks';
import { getActiveCommandsFromScope } from '@core/hotkey/getCommands';
import { runCommand } from '@core/hotkey/utils';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { debouncedDependent } from '@core/util/debounce';
import { windowSearchMatch } from '@core/util/searchHighlight';
import { Entity, type EntityData, type WithSearch } from '@entity';
import { SearchContent } from '@entity/extractors-search/search-content';
import ArrowLeft from '@icon/regular/arrow-left.svg';
import { Dialog } from '@kobalte/core/dialog';
import SearchIcon from '@phosphor-icons/core/regular/magnifying-glass.svg?component-solid';
import { useFullTextSearch } from '@queries/soup/useFullTextSearch';
import { cn, Layer } from '@ui';
import {
  createSignal,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { VList } from 'virtua/solid';
import { CommandItem } from '../command/CommandItem';
import type { CategoryFilter } from '../command/types';
import {
  type CommandMenuItem,
  isCommandItem,
  isEntityItem,
  useCommandItems,
} from '../command/useCommandItems';
import { useSplitLayout } from '../split-layout/layout';
import { SearchState } from './mobileSearchState';

const CATEGORIES: { id: CategoryFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'channels', label: 'Channels' },
  { id: 'dms', label: 'DMs' },
  { id: 'documents', label: 'Documents' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'chats', label: 'Chats' },
  { id: 'projects', label: 'Folders' },
  { id: 'commands', label: 'Commands' },
];

export function MobileSearchOuter() {
  return (
    <Dialog open={SearchState.isOpen()} onOpenChange={SearchState.setIsOpen}>
      <Dialog.Portal>
        <Layer depth={2}>
          <Dialog.Content
            class={cn(
              'fixed inset-0 z-modal flex flex-col h-[calc(var(--dvh,1dvh)*100)] pt-(--safe-top) pl-(--safe-left) pr-(--safe-right)',
              {
                'pb-(--safe-bottom)': !virtualKeyboardVisible(),
              }
            )}
          >
            <MobileSearchInner />
          </Dialog.Content>
        </Layer>
      </Dialog.Portal>
    </Dialog>
  );
}

export function MobileSearchInner() {
  const { openWithSplit } = useSplitLayout();

  const query = debouncedDependent(SearchState.query, 60);

  const filteredItems = useCommandItems(query, SearchState.categoryFilter);
  const { results: fullTextResults, isLoading: isFullTextLoading } =
    useFullTextSearch(SearchState.query);

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
      SearchState.close();
      SearchState.setQuery('');
      return;
    }

    SearchState.close();
    SearchState.setQuery('');
  }

  function handleFullTextItemAction(entity: WithSearch<EntityData>) {
    const hitData = entity.search.contentHitData?.[0];
    const location =
      hitData && 'location' in hitData ? hitData.location : undefined;
    openEntityInSplitFromUnifiedList(entity, { location });
    SearchState.onMenuClose();
    SearchState.close();
  }

  const handleBack = () => {
    if (SearchState.isInCommandScope()) {
      SearchState.clearCommandScopeCommands();
    } else {
      SearchState.close();
    }
  };

  return (
    <div class="flex flex-col h-full bg-surface">
      <ResultsContainer
        nameMatchItems={filteredItems()}
        fullTextItems={fullTextResults()}
        onSelectNameMatch={(item, openInNewSplit) =>
          handleItemAction(item, openInNewSplit)
        }
        onSelectFullText={(entity) => handleFullTextItemAction(entity)}
        isLoading={() => SearchState.isFullTextMode() && isFullTextLoading()}
        onFullTextSearch={() => SearchState.enableFullTextMode()}
        query={SearchState.query}
      />
      <Show
        when={!SearchState.isInCommandScope() && !SearchState.isFullTextMode()}
      >
        <CategoryFilterTabs />
      </Show>
      {/* Search Input */}
      <div class="flex items-center gap-2 bg-surface px-2 border-t border-edge-muted">
        <button
          class="text-ink-muted flex flex-col items-center justify-center pl-2 pt-3 pb-2"
          onClick={handleBack}
          title="Back (Esc)"
        >
          <ArrowLeft class="size-6" />
        </button>
        <input
          id="mobile-search-input"
          type="text"
          class="pt-3 pb-2 flex-1 bg-transparent border-0 outline-none focus:outline-none ring-0 focus:ring-0 text-ink-muted placeholder:text-ink-placeholder"
          placeholder={'Search...'}
          value={SearchState.query()}
          onInput={(e) => SearchState.setQuery(e.currentTarget.value)}
        />
      </div>
    </div>
  );
}

function ResultsContainer(props: {
  nameMatchItems: CommandMenuItem[];
  fullTextItems: WithSearch<EntityData>[];
  onSelectNameMatch: (item: CommandMenuItem, openInNewSplit: boolean) => void;
  onSelectFullText: (entity: WithSearch<EntityData>) => void;
  isLoading?: () => boolean;
  onFullTextSearch: () => void;
  query: () => string;
}) {
  let ref: HTMLDivElement | undefined;
  const [availableHeight, setAvailableHeight] = createSignal(0);

  onMount(() => {
    if (!ref) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setAvailableHeight(entry.contentRect.height);
    });
    observer.observe(ref);
    onCleanup(() => observer.disconnect());
  });

  const [rowHeight, setRowHeight] = createSignal(0);
  const heightOfNameMatchList = () => props.nameMatchItems.length * rowHeight();
  const showFullTextSearchButton = () => {
    if (SearchState.isFullTextMode()) return false;
    // Always show when there are no name matches (rowHeight stays 0 since list isn't rendered)
    if (props.nameMatchItems.length === 0) return true;
    const rh = rowHeight();
    return rh > 0 && availableHeight() - heightOfNameMatchList() > rh;
  };

  return (
    <div class="flex-1 min-h-0 bg-surface" ref={ref}>
      <Switch>
        <Match when={props.isLoading?.()}>
          <div class="flex items-center gap-2 text-ink-muted h-10 px-2">
            <TailSpinner width={16} height={16} />
            Searching...
          </div>
        </Match>
        <Match
          when={
            SearchState.isFullTextMode() &&
            SearchState.query().trim().length < 3
          }
        >
          <div class="flex items-center gap-2 text-ink-muted h-10 px-2">
            At least 3 characters required for search.
          </div>
        </Match>
        <Match
          when={SearchState.isFullTextMode() && props.fullTextItems.length > 0}
        >
          <div class="h-full overflow-hidden">
            <FullTextResultList
              items={props.fullTextItems}
              onSelect={props.onSelectFullText}
            />
          </div>
        </Match>
        <Match
          when={
            !SearchState.isFullTextMode() && props.nameMatchItems.length > 0
          }
        >
          <div
            class="overflow-hidden shrink-0"
            style={{
              height:
                heightOfNameMatchList() < availableHeight()
                  ? `${heightOfNameMatchList()}px`
                  : `100%`,
            }}
          >
            <VirtualizedCommandList
              items={props.nameMatchItems}
              onSelect={props.onSelectNameMatch}
              onRowHeightMeasured={setRowHeight}
            />
          </div>
        </Match>
        <Match when={true}>
          <div class="flex items-center text-ink-extra-muted text-sm h-10 px-2">
            No matches
          </div>
        </Match>
      </Switch>

      <Show when={showFullTextSearchButton()}>
        <button
          onClick={props.onFullTextSearch}
          class="flex items-center px-2 text-sm gap-2 h-10"
        >
          <SearchIcon class="size-5 p-0.5" />
          {`Full-text search for${props.query() ? ` "${props.query()}"` : ''}`}
        </button>
      </Show>
    </div>
  );
}

/** Virtualized command list for name-match results */
function VirtualizedCommandList(props: {
  items: CommandMenuItem[];
  onSelect: (item: CommandMenuItem, openInNewSplit: boolean) => void;
  onRowHeightMeasured?: (height: number) => void;
}) {
  return (
    <VList
      data={props.items}
      style={{ height: '100%' }}
      class="scrollbar-hidden overscroll-none"
    >
      {(item, index) => (
        <div
          ref={(el) => {
            if (index() !== 0) return;
            const onMeasured = props.onRowHeightMeasured;
            if (!onMeasured) return;
            const ro = new ResizeObserver(([entry]) => {
              if (entry) onMeasured(entry.contentRect.height);
            });
            ro.observe(el);
            onCleanup(() => ro.disconnect());
          }}
        >
          <CommandItem
            item={item}
            index={index()}
            selected={false}
            onSelect={props.onSelect}
          />
        </div>
      )}
    </VList>
  );
}

/** Virtualized list for full-text search results */
function FullTextResultList(props: {
  items: WithSearch<EntityData>[];
  onSelect: (entity: WithSearch<EntityData>) => void;
}) {
  return (
    <VList
      data={props.items}
      style={{ height: '100%' }}
      class="scrollbar-hidden"
    >
      {(entity) => (
        <FullTextResultItem entity={entity} onSelect={props.onSelect} />
      )}
    </VList>
  );
}

/** Single full-text search result: entity header + first content snippet */
function FullTextResultItem(props: {
  entity: WithSearch<EntityData>;
  onSelect: (entity: WithSearch<EntityData>) => void;
}) {
  const hit = () => {
    const hitData = props.entity.search.contentHitData?.[0];
    return hitData
      ? // The char length for windowSearchMatch below is a magic number to keep the highlighted result in approximately the first two lines of the search content snippet. In the future it would be nice to handle this more robustly.
        { ...hitData, content: windowSearchMatch(hitData.content, 50) }
      : null;
  };

  return (
    <div
      class="p-2 text-sm font-semibold"
      onClick={() => props.onSelect(props.entity)}
    >
      <div class="flex items-center gap-2 min-w-0">
        <div class="size-5 p-0.5 flex items-center justify-center text-ink-muted shrink-0">
          <Entity.Icon entity={props.entity} />
        </div>
        <Entity.Title entity={props.entity} />
      </div>
      <Show when={hit()}>
        {(h) => (
          <div class="ml-7 mt-1 border-l-2 border-edge-muted pl-2 text-xs font-normal text-ink-muted">
            <SearchContent twoLineClamp hit={h()} />
          </div>
        )}
      </Show>
    </div>
  );
}

function CategoryFilterTabs() {
  return (
    <div class="bg-surface border-t border-edge-muted h-11 px-1 overflow-x-auto scrollbar-hidden">
      <Tabs
        list={CATEGORIES.map((c) => ({ value: c.id, label: c.label }))}
        value={SearchState.categoryFilter()}
        onChange={(value) => {
          if (value) SearchState.setCategoryFilter(value as CategoryFilter);
        }}
        indicatorPosition="top"
        class="w-max **:data-indicator:h-0.75"
      />
    </div>
  );
}
