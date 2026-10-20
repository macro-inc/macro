import { useCrmContactDiscovery } from '@app/features/crm/record-adapter';
import { openEntityInSplitFromUnifiedList } from '@app/features/next-soup/utils';
import { projectRouteId } from '@app/features/projects/core/route';
import { createSoupRowStore } from '@app/features/soup/collection/row-store';
import { t } from '@app/lib/i18n';
import { useEntryState } from '@components/app/split-layout/entry-state';
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
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  Show,
  Suspense,
  untrack,
} from 'solid-js';
import { type VirtualizerHandle, VList } from 'virtua/solid';
import { ItemDisplay } from '../CommandItem';
import {
  type EntitySearchCategory,
  type EntitySearchItem,
  useEntitySearch,
} from '../queries/entity-search';
import { createMobileFullTextSearch } from '../queries/mobile-full-text-search';
import { createMobileSearchEntry } from './create-mobile-search-entry';
import { createSearchPagination } from './create-search-pagination';
import { createSearchResultWindow } from './create-search-result-window';
import type { MobileSearchSession } from './mobileSearchState';
import { useMobileSearchCategory } from './use-mobile-search-category';

type SearchScrollState = {
  accountId: string;
  query: string;
  category: EntitySearchCategory;
  offset: number;
  cache?: VirtualizerHandle['cache'];
};

function MobileNameResults(props: {
  session: MobileSearchSession;
  accountId: string;
}) {
  const state = props.session;
  const [virtualizer, setVirtualizer] = createSignal<VirtualizerHandle>();
  const [container, setContainer] = createSignal<HTMLDivElement>();
  const category = useMobileSearchCategory(state.category);
  const [scroll, setScroll] = useEntryState<SearchScrollState | undefined>(
    'mobileSearch.nameScroll',
    { default: undefined }
  );
  const initialScroll = untrack(() => scroll());
  let restore =
    initialScroll?.accountId === props.accountId &&
    initialScroll.query === state.query() &&
    initialScroll.category === category()
      ? initialScroll
      : undefined;
  const source = useEntitySearch(state.query, category, {
    enabled: () => true,
    contactDiscovery: useCrmContactDiscovery,
  });
  useDatabaseDiscoverySync(() => true);
  const incoming = createMemo(() =>
    source.rankItems(source.items(), state.query())
  );
  const results = createSearchResultWindow({
    key: 'mobileSearch.nameResults',
    accountId: () => props.accountId,
    query: state.query,
    category,
    items: incoming,
    pending: () =>
      source.isSettling() ||
      source.pagination.isLoadingMore() ||
      source.hasError(),
    discard: source.hasAuthoritativeError,
    hasMore: source.pagination.hasMore,
  });
  const items = results.items;
  const loadMoreNearEnd = createSearchPagination({
    items: incoming,
    container,
    remaining: () => {
      const handle = virtualizer();
      return results.needsMore() || items().length === 0
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
  createEffect(
    on([items, virtualizer, source.hasAuthoritativeError], () => {
      if (source.hasAuthoritativeError()) restore = undefined;
      const handle = virtualizer();
      if (!restore || !handle || items().length === 0) return;
      if (restore.query !== state.query() || restore.category !== category()) {
        restore = undefined;
        return;
      }
      handle.scrollTo(restore.offset);
      // The saved window is already mounted; later pages must not move the user.
      restore = undefined;
    })
  );
  const onScroll = () => {
    const handle = virtualizer();
    if (handle && !restore)
      setScroll({
        accountId: props.accountId,
        query: state.query(),
        category: category(),
        offset: handle.scrollOffset,
        cache: handle.cache,
      });
    loadMoreNearEnd();
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
      class="flex h-full min-h-0 flex-col px-3 mobile:pt-(--mobile-content-inset-top) mobile:pb-(--mobile-content-inset-bottom)"
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
          cache={restore?.cache}
          role="region"
          aria-label={t('commandMenu.searchResults')}
          class="min-h-0 flex-1 overscroll-none"
          onScroll={onScroll}
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
  const [scroll, setScroll] = useEntryState<SearchScrollState | undefined>(
    'mobileSearch.fullTextScroll',
    { default: undefined }
  );
  const initialScroll = untrack(() => scroll());
  let restore =
    initialScroll?.accountId === props.accountId ? initialScroll : undefined;
  const incoming = createMemo(() => (search.isSettling() ? [] : search.data()));
  const results = createSearchResultWindow({
    key: 'mobileSearch.fullTextResults',
    accountId: () => props.accountId,
    query: state.query,
    category,
    items: incoming,
    pending: () =>
      search.isSettling() || search.isFetchingNextPage() || !!search.error(),
    discard: hasAuthoritativeError,
    hasMore: search.hasNextPage,
  });
  // Page selection rematerializes entities; retain row identity as pages append.
  const rows = createSoupRowStore(results.items);
  let restoreQueued = false;
  createEffect(
    on([results.items, container, layoutReady, hasAuthoritativeError], () => {
      if (hasAuthoritativeError()) restore = undefined;
      const list = container();
      if (
        !restore ||
        !list ||
        !layoutReady() ||
        !results.items().length ||
        restoreQueued
      )
        return;
      restoreQueued = true;
      // ResizeObserver selects narrow/wide rows; let that DOM update commit
      // before assigning an offset that the temporary wide layout could clamp.
      queueMicrotask(() => {
        restoreQueued = false;
        if (!restore || !list.isConnected || list !== container()) return;
        if (
          restore.query !== state.query() ||
          restore.category !== category()
        ) {
          restore = undefined;
          return;
        }
        list.scrollTop = restore.offset;
        restore = undefined;
      });
    })
  );
  const loadMoreNearEnd = createSearchPagination({
    items: incoming,
    container,
    remaining: () => {
      if (results.needsMore()) return 0;
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
      onScroll={(event) => {
        if (!restore)
          setScroll({
            accountId: props.accountId,
            query: state.query(),
            category: category(),
            offset: event.currentTarget.scrollTop,
          });
        loadMoreNearEnd();
      }}
      class="soup-list h-full overflow-y-auto overscroll-none [overflow-anchor:none] mobile:pt-(--mobile-content-inset-top) mobile:pb-(--mobile-content-inset-bottom)"
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

/** The dock owns the input; only the result subtree changes search modes. */
export function MobileSearchResults() {
  const session = createMobileSearchEntry();
  const accountId = useUserId();
  const authenticated = useIsAuthenticated();
  return (
    <Show when={authenticated() === true ? accountId() : undefined} keyed>
      {(id) => (
        <Suspense fallback={<p role="status">{t('commandMenu.loading')}</p>}>
          <Show
            when={session.mode() === 'full-text'}
            fallback={<MobileNameResults session={session} accountId={id} />}
          >
            <MobileFullTextResults session={session} accountId={id} />
          </Show>
        </Suspense>
      )}
    </Show>
  );
}
