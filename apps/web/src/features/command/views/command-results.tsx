import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import { createSteadyFlag } from '@core/util/steady-flag';
import { CommandMenuEmptyState } from '@ui';
import { createEffect, createSelector, createSignal, on, Show } from 'solid-js';
import { type VirtualizerHandle, VList } from 'virtua/solid';
import { CommandItem } from '../CommandItem';
import type { CommandMenuItem, PaginationControls } from '../useCommandItems';

const VIRTUAL_ITEM_HEIGHT = 40;
const LIST_PADDING = 16;
const MAX_LIST_HEIGHT = VIRTUAL_ITEM_HEIGHT * 8 + LIST_PADDING;
const LOAD_MORE_THRESHOLD = VIRTUAL_ITEM_HEIGHT * 3;
const EMPTY_STATE_HEIGHT = VIRTUAL_ITEM_HEIGHT * 1.5 + LIST_PADDING;
const SEARCHING_ROW_HEIGHT = 28;

type CommandResultsProps = {
  items: CommandMenuItem[];
  selectedIndex: number;
  onSelect: (item: CommandMenuItem, openInNewSplit: boolean) => void;
  onItemMouseMove: (index: number) => void;
  scrollSelectedIntoView: boolean;
  pagination?: PaginationControls;
  loading?: boolean;
  label?: string;
};

/** The same result rows, virtualization, and pagination in the menu and embedded search. */
export function CommandResults(props: CommandResultsProps) {
  // Rows from faster sources can be listed while the search is still running;
  // a slow one says so below them instead of leaving the list looking final.
  const searchingShown = createSteadyFlag(() => props.loading ?? false);
  const stillSearching = () => searchingShown() && props.items.length > 0;
  const height = () => {
    if (!props.items.length) return EMPTY_STATE_HEIGHT;

    const rows = Math.min(
      MAX_LIST_HEIGHT,
      props.items.length * VIRTUAL_ITEM_HEIGHT + LIST_PADDING
    );
    return stillSearching() ? rows + SEARCHING_ROW_HEIGHT : rows;
  };
  return (
    <div
      role="listbox"
      aria-label={props.label ?? t('commandMenu.searchResults')}
      aria-busy={props.loading || undefined}
      class="flex flex-col overflow-hidden transition-[height] duration-60 ease-out p-2"
      style={{ height: `${height()}px` }}
    >
      <Show
        when={props.items.length}
        fallback={
          <CommandMenuEmptyState>
            <span role="status">
              {props.loading
                ? t('commandMenu.searching')
                : t('commandMenu.noResultsFound')}
            </span>
          </CommandMenuEmptyState>
        }
      >
        <div class="min-h-0 flex-1">
          <VirtualizedCommandList {...props} />
        </div>
        <Show when={stillSearching()}>
          <p
            role="status"
            class="flex h-7 shrink-0 items-center px-2 text-xs text-ink-muted"
          >
            {t('commandMenu.searching')}
          </p>
        </Show>
      </Show>
    </div>
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
  const [virtualizerHandle, setVirtualizerHandle] =
    createSignal<VirtualizerHandle>();

  const loadMoreNearEnd = () => {
    const pagination = props.pagination;
    const handle = virtualizerHandle();
    if (!handle || !pagination?.hasMore() || pagination.isLoadingMore()) return;
    const remaining =
      handle.scrollSize - handle.scrollOffset - handle.viewportSize;
    if (remaining <= LOAD_MORE_THRESHOLD)
      fireAndForget(pagination.loadMore(), 'command-menu');
  };

  createEffect(
    on(
      () => [
        virtualizerHandle(),
        props.items.length,
        props.pagination?.hasMore(),
        props.pagination?.isLoadingMore(),
      ],
      loadMoreNearEnd
    )
  );

  createEffect(() => {
    const index = props.selectedIndex;
    const handle = virtualizerHandle();
    if (
      !props.scrollSelectedIntoView ||
      index < 0 ||
      index >= props.items.length ||
      !handle
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
    handle.scrollToIndex(index, { align: 'nearest' });
  });

  const selector = createSelector(
    () => props.selectedIndex,
    (ndx, selected) => ndx === selected
  );

  return (
    <VList
      ref={setVirtualizerHandle}
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
