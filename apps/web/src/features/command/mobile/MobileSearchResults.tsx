import { useCrmContactDiscovery } from '@app/features/crm/record-adapter';
import { openEntityInSplitFromUnifiedList } from '@app/features/next-soup/utils';
import { projectRouteId } from '@app/features/projects/core/route';
import { createSoupRowStore } from '@app/features/soup/collection/row-store';
import { t } from '@app/lib/i18n';
import { MobileTopEdgeFade } from '@components/app/mobile/MobileEdgeFade';
import { MobileViewsRow } from '@components/app/mobile/MobileViewsRow';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { toast } from '@core/component/Toast/Toast';
import { useIsAuthenticated, useUserId } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { isTransientRequestError } from '@core/util/request-error';
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
import { useUniversalInputEnabled } from '../../universal-input/use-universal-input';
import { ItemDisplay } from '../CommandItem';
import { commandSearchResultKey } from '../contact-items';
import {
  type EntitySearchItem,
  useEntitySearch,
} from '../queries/entity-search';
import { createMobileFullTextSearch } from '../queries/mobile-full-text-search';
import { createMobileSearchEntry } from './create-mobile-search-entry';
import { createSearchPagination } from './create-search-pagination';
import { createSearchResultWindow } from './create-search-result-window';
import { createSearchScrollRestoration } from './create-search-scroll-restoration';
import type { MobileSearchSession } from './mobileSearchState';
import { useMobileSearchCategory } from './use-mobile-search-category';

function MobileNameResults(props: {
  session: MobileSearchSession;
  accountId: string;
}) {
  const state = props.session;
  const [virtualizer, setVirtualizer] = createSignal<VirtualizerHandle>();
  const [container, setContainer] = createSignal<HTMLDivElement>();
  const category = useMobileSearchCategory(state.category);
  const source = useEntitySearch(state.query, category, {
    enabled: () => true,
    contactDiscovery: useCrmContactDiscovery,
  });
  useDatabaseDiscoverySync(() => true);
  const incoming = createMemo(() =>
    source.rankItems(source.items(), state.query())
  );
  const itemKey = (item: EntitySearchItem) =>
    commandSearchResultKey(item, props.accountId);
  const results = createSearchResultWindow({
    key: 'mobileSearch.nameOrder',
    accountId: () => props.accountId,
    query: state.query,
    category,
    items: incoming,
    itemKey,
    discard: source.hasAuthoritativeError,
  });
  const items = results.items;
  const restoration = createSearchScrollRestoration({
    key: 'mobileSearch.nameScroll',
    accountId: () => props.accountId,
    query: state.query,
    category,
    items,
    ready: () => !!virtualizer() || items().length === 0,
    busy: () => source.isSettling() || source.pagination.isLoadingMore(),
    failed: source.hasError,
    hasMore: source.pagination.hasMore,
    loadMore: source.pagination.loadMore,
    read: () => {
      const handle = virtualizer();
      const offset = handle?.scrollOffset ?? 0;
      const index = handle?.findItemIndex(offset) ?? 0;
      const item = items()[index];
      return {
        id: item ? itemKey(item) : undefined,
        offset,
        within: offset - (handle?.getItemOffset(index) ?? 0),
      };
    },
    apply: (anchor) => {
      const handle = virtualizer();
      if (!handle) return !anchor.id && items().length === 0;
      if (!anchor.id) {
        handle.scrollTo(anchor.offset);
        return true;
      }
      const index = items().findIndex((item) => itemKey(item) === anchor.id);
      if (index < 0) return false;
      handle.scrollToIndex(index, { align: 'start', offset: anchor.within });
      return true;
    },
  });
  const loadMoreNearEnd = createSearchPagination({
    items: incoming,
    enabled: restoration.paginationAllowed,
    container,
    remaining: () => {
      const handle = virtualizer();
      return items().length === 0
        ? 0
        : handle
          ? handle.scrollSize - handle.scrollOffset - handle.viewportSize
          : undefined;
    },
    hasMore: source.pagination.hasMore,
    busy: () =>
      source.isSettling() ||
      source.pagination.isLoadingMore() ||
      source.hasError(),
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
        openWithSplit({
          type: 'component',
          id: projectRouteId({ id: item.id, section: 'overview' }),
        });
      } else if (item.kind === 'user') {
        const result = await directMessage.mutateAsync({
          recipient_id: item.id,
        });
        openWithSplit(
          { type: 'channel', id: result.channel_id },
          { reopen: 'latest' }
        );
      } else {
        await openEntityInSplitFromUnifiedList(item.data, {
          splitHandle: panel.handle,
        });
      }
    });
  };
  const select = async (item: EntitySearchItem) => {
    results.preserveOrder();
    try {
      await open(item);
    } catch {
      toast.failure(t('commandMenu.unableToOpenResult'));
    }
  };
  return (
    <div
      ref={setContainer}
      onWheel={restoration.cancel}
      onTouchStart={restoration.cancel}
      onPointerDown={restoration.cancel}
      class="flex h-full min-h-0 flex-col px-3 touch:pt-(--mobile-content-inset-top) touch:pb-(--mobile-content-inset-bottom)"
    >
      <Show when={state.query().trim() && category() !== 'projects'}>
        <div
          data-keep-keyboard
          onPointerDown={(event) => event.preventDefault()}
          onMouseDown={(event) => event.preventDefault()}
        >
          <CommandMenuListItem class="min-h-11" onClick={state.searchFullText}>
            <span class="truncate">
              {t('commandMenu.searchFullTextFor', {
                query: state.query().trim(),
              })}
            </span>
          </CommandMenuListItem>
        </div>
      </Show>
      <Show when={items().length > 0}>
        <VList
          ref={setVirtualizer}
          data={items()}
          role="region"
          aria-label={t('commandMenu.searchResults')}
          class="min-h-0 flex-1 overscroll-none"
          onScroll={loadMoreNearEnd}
        >
          {(item) => (
            <CommandMenuListItem
              class="min-h-11"
              onClick={() => fireAndForget(select(item), 'mobile-search')}
            >
              <ItemDisplay item={item} />
            </CommandMenuListItem>
          )}
        </VList>
      </Show>
      <Show when={source.isLoadingEntities() && items().length === 0}>
        <p role="status" class="p-3 text-ink-muted">
          {t('commandMenu.loading')}
        </p>
      </Show>
      <Show when={!source.isLoadingEntities() && items().length === 0}>
        <p class="p-3 text-ink-muted">{t('commandMenu.noResults')}</p>
      </Show>
    </div>
  );
}

function MobileFullTextResults(props: {
  session: MobileSearchSession;
  accountId: string;
}) {
  const state = props.session;
  const category = useMobileSearchCategory(state.category);
  const search = createMobileFullTextSearch(state.query, category);
  const hasAuthoritativeError = () =>
    !!search.error() && !isTransientRequestError(search.error());
  const panel = useSplitPanelOrThrow();
  const [container, setContainer] = createSignal<HTMLDivElement>();
  const [layoutReady, setLayoutReady] = createSignal(false);
  const incoming = createMemo(() => (search.isSettling() ? [] : search.data()));
  const results = createSearchResultWindow({
    key: 'mobileSearch.fullTextOrder',
    accountId: () => props.accountId,
    query: state.query,
    category,
    items: incoming,
    discard: hasAuthoritativeError,
  });
  // Page selection rematerializes entities; retain row identity as pages append.
  const rows = createSoupRowStore(results.items);
  const restoration = createSearchScrollRestoration({
    key: 'mobileSearch.fullTextScroll',
    accountId: () => props.accountId,
    query: state.query,
    category,
    items: results.items,
    ready: layoutReady,
    busy: () => search.isSettling() || search.isFetchingNextPage(),
    failed: () => !!search.error(),
    hasMore: search.hasNextPage,
    loadMore: search.fetchNextPage,
    read: () => {
      const list = container();
      const top = list?.getBoundingClientRect().top ?? 0;
      const row = Array.from(
        list?.querySelectorAll<HTMLElement>('[data-mobile-search-id]') ?? []
      ).find((element) => element.getBoundingClientRect().bottom > top);
      return {
        id: row?.dataset.mobileSearchId,
        offset: list?.scrollTop ?? 0,
        within: row ? top - row.getBoundingClientRect().top : 0,
      };
    },
    apply: (anchor) => {
      const list = container();
      if (!list) return false;
      if (!anchor.id) {
        list.scrollTop = anchor.offset;
        return true;
      }
      const row = Array.from(
        list.querySelectorAll<HTMLElement>('[data-mobile-search-id]')
      ).find((element) => element.dataset.mobileSearchId === anchor.id);
      if (!row) return false;
      list.scrollTop +=
        row.getBoundingClientRect().top -
        list.getBoundingClientRect().top +
        anchor.within;
      return true;
    },
  });
  const loadMoreNearEnd = createSearchPagination({
    items: incoming,
    enabled: restoration.paginationAllowed,
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
    results.preserveOrder();
    try {
      await Telemetry.span('mobile.search.open', async (span) => {
        span.setAttr('entity.id', entity.id);
        span.setAttr('entity.type', entity.type);
        span.setAttr('search.content_hit', !!location);
        await openEntityInSplitFromUnifiedList(entity, {
          splitHandle: panel.handle,
          location,
        });
      });
    } catch {
      toast.failure(t('commandMenu.unableToOpenResult'));
    }
  };
  return (
    <div
      ref={setContainer}
      role="region"
      aria-label={t('commandMenu.searchResults')}
      onScroll={loadMoreNearEnd}
      onWheel={restoration.cancel}
      onTouchStart={restoration.cancel}
      onPointerDown={restoration.cancel}
      class="soup-list h-full overflow-y-auto overscroll-none [overflow-anchor:none] touch:pt-(--mobile-content-inset-top) touch:pb-(--mobile-content-inset-bottom)"
    >
      <ListEntityMetadataQueryProvider>
        <ListLayoutProvider
          ref={container}
          onMeasured={() => setLayoutReady(true)}
        >
          <StaticMarkdownContext>
            <For each={rows()}>
              {(entity) => (
                <ListEntity
                  entity={entity}
                  ref={(element) => {
                    element.dataset.mobileSearchId = entity.id;
                  }}
                  hideCheckbox
                  hideContentHits={false}
                  onClick={() => fireAndForget(open(entity), 'mobile-search')}
                  onContentHitClick={(event, location) => {
                    event.stopPropagation();
                    fireAndForget(open(entity, location), 'mobile-search');
                  }}
                />
              )}
            </For>
          </StaticMarkdownContext>
        </ListLayoutProvider>
      </ListEntityMetadataQueryProvider>
      <Show when={search.isSettling() && results.items().length === 0}>
        <p role="status" class="p-3 text-ink-muted">
          {t('commandMenu.searching')}
        </p>
      </Show>
      <Show when={search.error()}>
        <p role="alert" class="p-3 text-ink-muted">
          {t('commandMenu.searchFailed')}
        </p>
        <Button
          variant="ghost"
          onClick={() => fireAndForget(search.refetch(), 'mobile-search')}
        >
          {t('commandMenu.retry')}
        </Button>
      </Show>
      <Show
        when={
          !search.isSettling() &&
          !search.error() &&
          results.items().length === 0
        }
      >
        <p class="p-3 text-ink-muted">{t('commandMenu.noResults')}</p>
      </Show>
    </div>
  );
}

/**
 * The dock owns the input; only the result subtree changes search modes.
 * Persistent prompts wait while results are presented, so they never cover
 * the last rows above the search bar.
 */
export function MobileSearchResults() {
  const session = createMobileSearchEntry();
  const universalInputEnabled = useUniversalInputEnabled();
  const accountId = useUserId();
  const authenticated = useIsAuthenticated();
  return (
    <div
      class="relative size-full min-h-0 min-w-0"
      data-holds-prompts
      style={{
        '--mobile-content-inset-top': 'calc(var(--safe-top, 0px) + 3.75rem)',
      }}
    >
      <Show when={!universalInputEnabled() || !session.universalInputActive()}>
        <MobileViewsRow session={session} />
        <Show when={authenticated() === true ? accountId() : undefined} keyed>
          {(id) => (
            <Suspense
              fallback={
                <p
                  role="status"
                  class="px-3 touch:pt-(--mobile-content-inset-top)"
                >
                  {t('commandMenu.loading')}
                </p>
              }
            >
              <Show
                when={session.mode() === 'full-text'}
                fallback={
                  <MobileNameResults session={session} accountId={id} />
                }
              >
                <MobileFullTextResults session={session} accountId={id} />
              </Show>
            </Suspense>
          )}
        </Show>
        <MobileTopEdgeFade />
      </Show>
    </div>
  );
}
