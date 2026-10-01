import {
  ListEntity,
  ListEntityMetadataQueryProvider,
  ListLayoutProvider,
} from '@entity';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { useInfiniteScrollSentinel } from '../../../lib/primitives/infinite-scroll-sentinel';
import { useCrmContext } from '../context/crm-context';
import type { ItemListSource } from '../context/crm-sources';

/**
 * One of a CRM record's soup lists (emails, files or calls): unified-list
 * rows that open in a split, paging in as the end scrolls into view.
 */
export function RecordItemList(props: {
  source: ItemListSource;
  /** Hold the loading state, e.g. while the record itself loads. */
  pending?: boolean;
  empty: JSX.Element;
}) {
  const { openEntity } = useCrmContext().createNavigation();
  // Reading `data` before the first page resolves would suspend the tab.
  const items = () =>
    props.source.isPending ? [] : (props.source.data?.entities ?? []);
  const [listRef, setListRef] = createSignal<HTMLElement>();
  const [sentinelRef, setSentinelRef] = createSignal<HTMLDivElement>();

  useInfiniteScrollSentinel({
    sentinel: sentinelRef,
    hasNextPage: () => props.source.hasNextPage ?? false,
    isFetchingNextPage: () => props.source.isFetchingNextPage,
    fetchNextPage: () => props.source.fetchNextPage(),
  });

  // An enabled query is loading until its first page is readable, including
  // paused requests; a disabled one shows the empty state instead.
  const loading = () =>
    props.pending || (props.source.isPending && props.source.isEnabled);

  return (
    <Show
      when={!loading()}
      fallback={
        <div class="p-6 text-center text-sm text-ink-muted">Loading…</div>
      }
    >
      <Show
        when={items().length > 0}
        fallback={
          <div class="rounded-lg border border-dashed border-edge-muted p-6 text-center text-sm text-ink-muted">
            {props.empty}
          </div>
        }
      >
        <ListEntityMetadataQueryProvider>
          <ListLayoutProvider ref={listRef}>
            <div ref={setListRef} class="flex flex-col">
              <For each={items()}>
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
        <Show when={props.source.hasNextPage}>
          <div ref={setSentinelRef} class="h-px" />
        </Show>
        <Show when={props.source.isFetchingNextPage}>
          <div class="p-3 text-center text-xs text-ink-muted">
            Loading more…
          </div>
        </Show>
      </Show>
    </Show>
  );
}
