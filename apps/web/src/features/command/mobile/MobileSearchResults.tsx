import { useCrmContactDiscovery } from '@app/features/crm/record-adapter';
import { openEntityInSplitFromUnifiedList } from '@app/features/next-soup/utils';
import { projectRouteId } from '@app/features/projects/core/route';
import { createSoupRowStore } from '@app/features/soup/collection/row-store';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { toast } from '@core/component/Toast/Toast';
import {
  type EntityData,
  ListEntity,
  ListEntityMetadataQueryProvider,
  ListLayoutProvider,
  type SearchLocation,
} from '@entity';
import { Telemetry } from '@macro-inc/observability';
import { useGetOrCreateDirectMessageMutation } from '@queries/channel/get-or-create-dm';
import { useDatabaseDiscoverySync } from '@queries/storage/databases';
import { Button, CommandMenuListItem } from '@ui';
import { createMemo, createSignal, For, Show, Suspense } from 'solid-js';
import { type VirtualizerHandle, VList } from 'virtua/solid';
import { ItemDisplay } from '../CommandItem';
import {
  type EntitySearchCategory,
  type EntitySearchItem,
  useEntitySearch,
} from '../queries/entity-search';
import { createMobileFullTextSearch } from '../queries/mobile-full-text-search';
import { createSearchPagination } from './create-search-pagination';
import { SearchState } from './mobileSearchState';
import { useMobileSearchCategory } from './use-mobile-search-category';

function MobileNameResults() {
  let virtualizer: VirtualizerHandle | undefined;
  const [container, setContainer] = createSignal<HTMLDivElement>();
  const category = useMobileSearchCategory();
  const source = useEntitySearch(SearchState.query, category, {
    enabled: SearchState.isOpen,
    contactDiscovery: useCrmContactDiscovery,
  });
  useDatabaseDiscoverySync(SearchState.isOpen);
  const items = createMemo(() =>
    source.rankItems(source.items(), SearchState.query())
  );
  const loadMoreNearEnd = createSearchPagination({
    items,
    container,
    remaining: () =>
      items().length === 0
        ? 0
        : virtualizer
          ? virtualizer.scrollSize -
            virtualizer.scrollOffset -
            virtualizer.viewportSize
          : undefined,
    hasMore: source.pagination.hasMore,
    busy: () => source.isLoadingEntities() || source.pagination.isLoadingMore(),
    loadMore: source.pagination.loadMore,
  });
  const { openWithSplit } = useSplitLayout();
  const panel = useSplitPanelOrThrow();
  const directMessage = useGetOrCreateDirectMessageMutation();
  const open = async (item: EntitySearchItem) => {
    await Telemetry.span('mobile.search.open', async (span) => {
      span.setAttr('entity.id', item.id);
      span.setAttr('entity.type', item.bucket);
      if (item.kind === 'initiative') {
        SearchState.close();
        openWithSplit({
          type: 'component',
          id: projectRouteId({ id: item.id, section: 'overview' }),
        });
      } else if (item.kind === 'user') {
        const result = await directMessage.mutateAsync({
          recipient_id: item.id,
        });
        SearchState.close();
        openWithSplit(
          { type: 'channel', id: result.channel_id },
          { reopen: 'latest' }
        );
      } else {
        SearchState.close();
        await openEntityInSplitFromUnifiedList(item.data, {
          splitHandle: panel.handle,
        });
      }
    });
  };
  const select = async (item: EntitySearchItem) => {
    try {
      await open(item);
    } catch {
      toast.failure('Unable to open result. Please try again.');
    }
  };
  return (
    <div
      ref={setContainer}
      class="flex h-full min-h-0 flex-col px-3 mobile:pt-(--mobile-content-inset-top) mobile:pb-(--mobile-content-inset-bottom)"
    >
      <Show when={SearchState.query().trim() && category() !== 'projects'}>
        <div
          data-keep-keyboard
          onPointerDown={(event) => event.preventDefault()}
          onMouseDown={(event) => event.preventDefault()}
        >
          <CommandMenuListItem
            class="min-h-11"
            onClick={SearchState.searchFullText}
          >
            <span class="truncate">
              Search full text for “{SearchState.query().trim()}”
            </span>
          </CommandMenuListItem>
        </div>
      </Show>
      <Show when={items().length > 0}>
        <VList
          ref={(handle) => {
            virtualizer = handle;
          }}
          data={items()}
          role="region"
          aria-label="Search results"
          class="min-h-0 flex-1 overscroll-none"
          onScroll={loadMoreNearEnd}
        >
          {(item) => (
            <CommandMenuListItem
              class="min-h-11"
              onClick={() => void select(item)}
            >
              <ItemDisplay item={item} />
            </CommandMenuListItem>
          )}
        </VList>
      </Show>
      <Show when={source.isLoadingEntities()}>
        <p role="status" class="p-3 text-ink-muted">
          Loading…
        </p>
      </Show>
      <Show when={!source.isLoadingEntities() && items().length === 0}>
        <p class="p-3 text-ink-muted">No results</p>
      </Show>
    </div>
  );
}

function MobileFullTextResults() {
  const category = useMobileSearchCategory();
  const search = createMobileFullTextSearch(SearchState.query, category);
  const panel = useSplitPanelOrThrow();
  const [container, setContainer] = createSignal<HTMLDivElement>();
  // A same-query refresh must not collapse the scroller between pages.
  const results = createMemo<{
    query: string;
    category: EntitySearchCategory;
    items: EntityData[];
  }>((previous) => {
    const query = SearchState.query().trim();
    const scope = category();
    const items = search.data();
    if (search.isSettling()) {
      if (previous?.query === query && previous.category === scope)
        return previous;
      return { query, category: scope, items: [] };
    }
    return { query, category: scope, items };
  });
  // Page selection rematerializes entities; retain row identity as pages append.
  const rows = createSoupRowStore(() => results().items);
  const loadMoreNearEnd = createSearchPagination({
    items: () => results().items,
    container,
    remaining: () => {
      const list = container();
      return list
        ? list.scrollHeight - list.scrollTop - list.clientHeight
        : undefined;
    },
    hasMore: search.hasNextPage,
    busy: () =>
      search.isSettling() || search.isFetchingNextPage() || !!search.error(),
    loadMore: search.fetchNextPage,
  });
  const open = async (entity: EntityData, location?: SearchLocation) => {
    try {
      await Telemetry.span('mobile.search.open', async (span) => {
        span.setAttr('entity.id', entity.id);
        span.setAttr('entity.type', entity.type);
        span.setAttr('search.content_hit', !!location);
        SearchState.close();
        await openEntityInSplitFromUnifiedList(entity, {
          splitHandle: panel.handle,
          location,
        });
      });
    } catch {
      toast.failure('Unable to open result. Please try again.');
    }
  };
  return (
    <div
      ref={setContainer}
      role="region"
      aria-label="Search results"
      onScroll={loadMoreNearEnd}
      class="soup-list h-full overflow-y-auto overscroll-none mobile:pt-(--mobile-content-inset-top) mobile:pb-(--mobile-content-inset-bottom)"
    >
      <ListEntityMetadataQueryProvider>
        <ListLayoutProvider ref={container}>
          <StaticMarkdownContext>
            <For each={rows()}>
              {(entity) => (
                <ListEntity
                  entity={entity}
                  hideCheckbox
                  hideContentHits={false}
                  onClick={() => void open(entity)}
                  onContentHitClick={(event, location) => {
                    event.stopPropagation();
                    void open(entity, location);
                  }}
                />
              )}
            </For>
          </StaticMarkdownContext>
        </ListLayoutProvider>
      </ListEntityMetadataQueryProvider>
      <Show when={search.isSettling() && results().items.length === 0}>
        <p role="status" class="p-3 text-ink-muted">
          Searching…
        </p>
      </Show>
      <Show when={search.error()}>
        <p role="alert" class="p-3 text-ink-muted">
          Search failed. Please try again.
        </p>
        <Button onClick={() => void search.refetch()}>Retry</Button>
      </Show>
      <Show
        when={
          !search.isSettling() &&
          !search.error() &&
          results().items.length === 0
        }
      >
        <p class="p-3 text-ink-muted">No results</p>
      </Show>
    </div>
  );
}

/** The dock owns the input; only the result subtree changes search modes. */
export function MobileSearchResults() {
  return (
    <Suspense fallback={<p role="status">Loading…</p>}>
      <Show
        when={SearchState.mode() === 'full-text'}
        fallback={<MobileNameResults />}
      >
        <MobileFullTextResults />
      </Show>
    </Suspense>
  );
}
