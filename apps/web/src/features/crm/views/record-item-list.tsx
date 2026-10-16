import {
  ListEntity,
  ListEntityMetadataQueryProvider,
  ListLayoutProvider,
  type NarrowLayoutVariant,
} from '@entity';
import { Button } from '@ui';
import {
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { useInfiniteScrollSentinel } from '../../../lib/primitives/infinite-scroll-sentinel';
import { useCrmContext } from '../context/crm-context';
import type { ItemListSource } from '../context/crm-sources';
import { recordItemMatchesSearch } from '../core/record-search';

/**
 * One of a CRM record's soup lists (emails, files, calls or references):
 * unified-list rows that open in a split, paging in as the end scrolls into
 * view. A failed request shows a retry instead of the empty state.
 */
export function RecordItemList(props: {
  source: ItemListSource;
  /** Hold the loading state, e.g. while the record itself loads. */
  pending?: boolean;
  empty: JSX.Element;
  search?: string;
  /** Row layout when the list is narrow, e.g. in the information panel. */
  narrowLayout?: NarrowLayoutVariant;
}) {
  const { openEntity } = useCrmContext().createNavigation();
  // Reading `data` before the first page resolves would suspend the tab.
  const items = () =>
    props.source.isPending ? [] : (props.source.data?.entities ?? []);
  const filteredItems = createMemo(() =>
    items().filter((item) => recordItemMatchesSearch(item, props.search ?? ''))
  );
  const [listRef, setListRef] = createSignal<HTMLElement>();
  const [sentinelRef, setSentinelRef] = createSignal<HTMLDivElement>();

  useInfiniteScrollSentinel({
    sentinel: sentinelRef,
    hasNextPage: () =>
      (props.source.hasNextPage ?? false) && !props.source.isFetchNextPageError,
    isFetchingNextPage: () => props.source.isFetchingNextPage,
    fetchNextPage: () => props.source.fetchNextPage(),
  });

  // An enabled query is loading until its first page is readable, including
  // paused requests; a disabled one shows the empty state instead.
  const loading = () =>
    props.pending || (props.source.isPending && props.source.isEnabled);

  return (
    <Switch>
      <Match when={loading()}>
        <div class="p-6 text-center text-sm text-ink-muted">Loading…</div>
      </Match>
      <Match when={props.source.isError}>
        <RetryNotice
          message="Couldn't load this list."
          onRetry={() => props.source.refetch()}
        />
      </Match>
      <Match when={items().length === 0}>
        <div class="rounded-lg border border-dashed border-edge-muted p-6 text-center text-sm text-ink-muted">
          {props.empty}
        </div>
      </Match>
      <Match when={items().length > 0}>
        <ListEntityMetadataQueryProvider>
          <ListLayoutProvider ref={listRef} narrowLayout={props.narrowLayout}>
            <div ref={setListRef} class="flex flex-col">
              <Show when={filteredItems().length === 0}>
                <div class="p-6 text-center text-sm text-ink-muted">
                  {props.source.hasNextPage &&
                  !props.source.isFetchNextPageError
                    ? 'Searching more…'
                    : 'No matching items.'}
                </div>
              </Show>
              <For each={filteredItems()}>
                {(entity) => (
                  <ListEntity
                    entity={entity}
                    timestamp={entity.updatedAt}
                    onClick={() => openEntity(entity)}
                  />
                )}
              </For>
            </div>
          </ListLayoutProvider>
        </ListEntityMetadataQueryProvider>
        <Show
          when={!props.source.isFetchNextPageError}
          fallback={
            <RetryNotice
              message="Couldn't load more."
              onRetry={() => props.source.fetchNextPage()}
            />
          }
        >
          <Show when={props.source.hasNextPage}>
            <div ref={setSentinelRef} class="h-px" />
          </Show>
          <Show when={props.source.isFetchingNextPage}>
            <div class="p-3 text-center text-xs text-ink-muted">
              Loading more…
            </div>
          </Show>
        </Show>
      </Match>
    </Switch>
  );
}

/** A failed request, kept distinct from an empty list, with a retry. */
function RetryNotice(props: {
  message: string;
  onRetry: () => Promise<unknown>;
}) {
  return (
    <div class="flex items-center justify-center gap-2 p-3 text-center text-xs text-ink-muted">
      <span>{props.message}</span>
      <Button variant="ghost" size="sm" onClick={() => void props.onRetry()}>
        Retry
      </Button>
    </div>
  );
}
