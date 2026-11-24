import { DateGroupHeading } from '@app/features/next-soup/soup-view/date-group-heading';
import { dateBucket } from '@app/features/soup/collection/date-buckets';
import { createKeyedProjection } from '@app/lib/queries/soup/create-keyed-projection';
import { usePending } from '@app/observability/flow';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import {
  createEntityDraggable,
  type EntityData,
  EntityRowIcon,
  EntityRowTitle,
  ListEntity,
  ListEntityMetadataQueryProvider,
  ListLayoutProvider,
} from '@entity';
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
  CrmListRetry,
  CrmListSearchEmpty,
  CrmListSkeleton,
} from '../components/list-state';
import { useCrmContext } from '../context/crm-context';
import type { ItemListSource } from '../context/crm-sources';
import { useOptionalCrmWorkspace } from '../context/workspace-context';
import { recordItemMatchesSearch } from '../core/record-search';

/**
 * One of a CRM record's soup lists (emails, files, calls or references):
 * unified-list rows, or the information panel's compact rows with `panel`,
 * that open in a split, paging in as the end scrolls into view. A failed
 * request shows a retry instead of the empty state.
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
  /**
   * Rows for the information panel: the side panel's own item rows, like a
   * document's References, instead of the list's.
   */
  panel?: boolean;
  /** Property IDs to display as inline reference pills when needed. */
  referencePropertyIds?: readonly string[];
  /** Group the existing newest-first list by its last-updated date. */
  groupByDate?: boolean;
  /** Date field matching the list's server-side ordering. */
  dateField?: 'updated_at' | 'created_at' | 'viewed_at';
}) {
  const { openEntity } = useCrmContext().createNavigation();
  const workspace = useOptionalCrmWorkspace();
  const open = (entity: EntityData, event?: MouseEvent | KeyboardEvent) => {
    if (!workspace?.host.record.openItem(entity, event))
      openEntity(entity, { newSplit: event?.shiftKey });
  };
  // Reading `data` before the first page resolves would suspend the tab.
  const items = () =>
    props.source.isPending ? [] : (props.source.data?.entities ?? []);
  const rows = createKeyedProjection(
    items,
    (item) => `${item.type}:${item.id}`,
    (item) => item
  );
  const filteredItems = createMemo(() =>
    rows().filter((item) => recordItemMatchesSearch(item, props.search ?? ''))
  );
  const dateHeadings = createMemo(() => {
    if (!props.groupByDate) return [];
    const now = new Date();
    let previous: string | undefined;
    return filteredItems().map((entity) => {
      const date =
        props.dateField === 'created_at'
          ? entity.createdAt
          : props.dateField === 'viewed_at'
            ? entity.viewedAt
            : entity.updatedAt;
      const bucket = dateBucket(date ?? entity.createdAt, now);
      const label = bucket.key !== previous ? bucket.label : undefined;
      previous = bucket.key;
      return label;
    });
  });
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
  usePending('crm.items', () => Boolean(loading()));

  return (
    <div class="flex min-h-0 w-full flex-1 flex-col">
      <Switch>
        <Match when={loading()}>
          <CrmListSkeleton
            count={props.panel ? 2 : undefined}
            panel={props.panel}
          />
        </Match>
        <Match when={props.source.isError}>
          <Show
            when={!props.panel}
            fallback={
              <CrmListRetry
                message="Couldn't load this list."
                onRetry={() => props.source.refetch()}
                inline
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
                    when={!props.panel}
                    fallback={
                      <p class="text-xs text-ink-muted">
                        {props.empty ?? 'No items yet.'}
                      </p>
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
                <CrmListSkeleton
                  label="Searching more items"
                  count={2}
                  panel={props.panel}
                />
              }
            >
              <CrmListRetry
                message="Couldn't load more."
                onRetry={() => props.source.fetchNextPage()}
                inline={props.panel}
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
            <ListLayoutProvider ref={listRef}>
              <div
                ref={setListRef}
                class="flex flex-col"
                classList={{ 'min-h-0 flex-1': filteredItems().length === 0 }}
              >
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
                      <CrmListSkeleton
                        label="Searching more items"
                        count={2}
                        panel={props.panel}
                      />
                    </Show>
                  </Show>
                </Show>
                <For each={filteredItems()}>
                  {(entity, index) => (
                    <>
                      <Show when={dateHeadings()[index()]}>
                        {(label) => (
                          <DateGroupHeading
                            label={label()}
                            isFirst={index() === 0}
                          />
                        )}
                      </Show>
                      <Show
                        when={props.panel}
                        fallback={
                          <ListEntity
                            entity={entity}
                            hideCheckbox
                            timestamp={entity.updatedAt}
                            onClick={(event) => open(entity, event)}
                            referencePropertyIds={props.referencePropertyIds}
                          />
                        }
                      >
                        <PanelItemRow
                          entity={entity}
                          onOpen={(event) => open(entity, event)}
                        />
                      </Show>
                    </>
                  )}
                </For>
              </div>
            </ListLayoutProvider>
          </ListEntityMetadataQueryProvider>
          <Show
            when={!props.source.isFetchNextPageError}
            fallback={
              <CrmListRetry
                message="Couldn't load more."
                onRetry={() => props.source.fetchNextPage()}
                inline={props.panel}
              />
            }
          >
            <Show when={props.source.hasNextPage}>
              <div ref={setSentinelRef} class="h-px" />
            </Show>
            <Show when={props.source.isFetchingNextPage}>
              <CrmListSkeleton
                label="Loading more items"
                count={2}
                panel={props.panel}
              />
            </Show>
          </Show>
        </Match>
      </Switch>
    </div>
  );
}

/**
 * An item row shaped like a document's References row in its side panel:
 * 12px text in a 32px row that starts at the section's text edge, so the
 * information panel reads as one scale. Opens and drags like the list rows do.
 */
function PanelItemRow(props: {
  entity: EntityData;
  onOpen: (event: MouseEvent | KeyboardEvent) => void;
}) {
  const navigation = useSplitNavigationHandler<HTMLDivElement>((event) =>
    props.onOpen(event)
  );
  const draggable = createEntityDraggable({
    entity: props.entity,
    splitId: useSplitPanel()?.handle?.id,
  });
  return (
    <div
      ref={draggable}
      role="button"
      tabIndex={0}
      data-entity-id={props.entity.id}
      class="flex min-h-8 min-w-0 items-center gap-1.5 rounded-lg py-1 text-xs leading-5 text-ink hover:bg-hover/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      onMouseDown={navigation.onMouseDown}
      onClick={navigation.onClick}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        props.onOpen(event);
      }}
    >
      <span class="size-4 shrink-0">
        <EntityRowIcon
          entity={props.entity}
          suppressClick
          showTooltip={false}
        />
      </span>
      <span class="ph-no-capture flex min-w-0 truncate">
        <EntityRowTitle entity={props.entity} />
      </span>
    </div>
  );
}
