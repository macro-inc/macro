import { fireAndForget } from '@core/util/fireAndForget';
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
import {
  CrmListEmpty,
  CrmListError,
  CrmListSearchEmpty,
  CrmListSkeleton,
} from '../components/list-state';
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
  empty?: JSX.Element;
  /** A complete empty panel; `empty` remains a short description. */
  emptyContent?: JSX.Element;
  /** Clear the search when this list has its own search control. */
  onClearSearch?: () => void;
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
    <div class="flex min-h-0 w-full flex-1 flex-col">
      <Switch>
        <Match when={loading()}>
          <CrmListSkeleton
            count={props.narrowLayout === 'condensed' ? 2 : undefined}
          />
        </Match>
        <Match when={props.source.isError}>
          <Show
            when={props.narrowLayout !== 'condensed'}
            fallback={
              <RetryNotice
                message="Couldn't load this list."
                onRetry={() => props.source.refetch()}
              />
            }
          >
            <CrmListError onRetry={() => props.source.refetch()} />
          </Show>
        </Match>
        <Match when={items().length === 0}>
          <Show
            when={
              props.source.hasNextPage ||
              props.source.isFetchingNextPage ||
              props.source.isFetchNextPageError
            }
            fallback={
              <Show
                when={props.search?.trim()}
                fallback={
                  <Show
                    when={props.narrowLayout !== 'condensed'}
                    fallback={
                      <div class="p-3 text-xs text-ink-muted">
                        {props.empty ?? 'No items yet.'}
                      </div>
                    }
                  >
                    {props.emptyContent ?? (
                      <CrmListEmpty
                        title="No items yet"
                        description={props.empty}
                      />
                    )}
                  </Show>
                }
              >
                <CrmListSearchEmpty
                  title="No matching items"
                  onClearSearch={props.onClearSearch}
                />
              </Show>
            }
          >
            <Show
              when={props.source.isFetchNextPageError}
              fallback={
                <CrmListSkeleton label="Searching more items" count={2} />
              }
            >
              <RetryNotice
                message="Couldn't load more."
                onRetry={() => props.source.fetchNextPage()}
              />
            </Show>
            <Show
              when={
                props.source.hasNextPage && !props.source.isFetchNextPageError
              }
            >
              <div ref={setSentinelRef} class="h-px" />
            </Show>
          </Show>
        </Match>
        <Match when={items().length > 0}>
          <ListEntityMetadataQueryProvider>
            <ListLayoutProvider ref={listRef} narrowLayout={props.narrowLayout}>
              <div ref={setListRef} class="flex min-h-0 flex-1 flex-col">
                <Show when={filteredItems().length === 0}>
                  <Show
                    when={
                      props.source.hasNextPage ||
                      props.source.isFetchingNextPage
                    }
                    fallback={
                      <CrmListSearchEmpty
                        title="No matching items."
                        onClearSearch={props.onClearSearch}
                      />
                    }
                  >
                    <Show when={!props.source.isFetchNextPageError}>
                      <CrmListSkeleton label="Searching more items" count={2} />
                    </Show>
                  </Show>
                </Show>
                <For each={filteredItems()}>
                  {(entity) => (
                    <ListEntity
                      entity={entity}
                      hideCheckbox
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
              <CrmListSkeleton label="Loading more items" count={2} />
            </Show>
          </Show>
        </Match>
      </Switch>
    </div>
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
      <Button
        variant="ghost"
        size="sm"
        onClick={() => fireAndForget(props.onRetry(), 'crm')}
      >
        Retry
      </Button>
    </div>
  );
}
