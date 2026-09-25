import '@entity/composed/ListEntity.css';
import {
  createListController,
  type ListActivation,
  listOwnedSlotName,
  useListInteractions,
} from '@app/components/list';
import { SearchBar } from '@app/components/view-shell';
import { LIST_VIEW_DOCS_URL } from '@app/constants/docs-links';
import {
  resolveEntityActionViewContext,
  toEntityActionListState,
  useEntityActionHotkeys,
} from '@app/features/next-soup/actions';
import { openEntityInSplitFromUnifiedList } from '@app/features/next-soup/utils';
import {
  MaybeSoupEntityActionDrawerManager,
  SoupEntityContextMenu,
  useSoupListNavigationHotkeys,
} from '@app/features/soup';
import { DEBUG_SETTING_KEYS, useDebugSetting } from '@app/lib/debugSettings';
import {
  useSplitPanelOrThrow,
  withSplitPanelOwner,
} from '@components/app/split-layout/layoutUtils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import EmptyStateCallsGraphic from '@design/empty-state-calls.svg';
import EmptyStateNoSearchMatchGraphic from '@design/empty-state-no-search-match.svg';
import {
  type EntityData,
  ListEntity,
  ListEntityMetadataQueryProvider,
  ListLayoutProvider,
} from '@entity';
import CaretDownIcon from '@phosphor/caret-down.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import { validateSearchServiceText } from '@queries/soup/search';
import { createElementSize } from '@solid-primitives/resize-observer';
import { Button, cn, EmptyStatePanel } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  Match,
  onCleanup,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import { Virtualizer, type VirtualizerHandle } from 'virtua/solid';
import {
  type ChannelCallsRow,
  useChannelCallsSource,
} from './use-channel-calls-source';

type ChannelCallsActivationMetadata = {
  event?: MouseEvent;
  newSplit?: boolean;
};

export function ChannelCallsTab(props: { channelId: string }) {
  return (
    <div class="relative flex h-full min-h-0 flex-1 justify-center overflow-hidden p-2 touch:pb-(--mobile-content-inset-bottom)">
      <div class="macro-message-width size-full min-h-0">
        <ListEntityMetadataQueryProvider>
          <ChannelCallsList channelId={props.channelId} />
        </ListEntityMetadataQueryProvider>
      </div>
    </div>
  );
}

function ChannelCallsList(props: { channelId: string }) {
  const panel = useSplitPanelOrThrow();
  const forceEmptyState = useDebugSetting(
    DEBUG_SETTING_KEYS.FORCE_EMPTY_STATES
  );

  const [searchFor, setSearchFor] = createSignal({
    channelId: props.channelId,
    text: '',
  });
  const searchText = () =>
    searchFor().channelId === props.channelId ? searchFor().text : '';
  const setSearchText = (text: string) =>
    setSearchFor({ channelId: props.channelId, text });
  const source = withSplitPanelOwner(listOwnedSlotName('data-source'), () =>
    useChannelCallsSource(() => props.channelId, searchText)
  );

  const list = withSplitPanelOwner(listOwnedSlotName('controller'), () =>
    createListController<ChannelCallsRow, ChannelCallsActivationMetadata>({
      items: source.items,
      getKey: (row) => row.id,
      selection: {
        getKey: (row) => (row.kind === 'entity' ? row.entity.id : row.id),
      },
      isNavigable: (row) => row.kind === 'entity' || row.kind === 'load-more',
      isSelectable: (row) => row.kind === 'entity',
      onActivate,
    })
  );

  function openEntity(
    entity: EntityData,
    options: {
      openInNewSplit?: boolean;
      mergeHistory?: boolean;
    } = {}
  ) {
    void openEntityInSplitFromUnifiedList(entity, {
      splitHandle: panel.handle,
      referredFrom: 'calls',
      ...options,
    });
  }

  function onActivate({
    item,
    metadata,
  }: ListActivation<ChannelCallsRow, ChannelCallsActivationMetadata>) {
    if (item.kind === 'load-more') {
      if (!item.isLoading) void source.loadMore();
      return;
    }

    if (item.kind !== 'entity') return;

    const newSplit =
      metadata?.newSplit === true || metadata?.event?.shiftKey === true;

    openEntity(item.entity, {
      openInNewSplit: newSplit,
    });
  }

  withSplitPanelOwner(listOwnedSlotName('navigation-hotkeys'), () => {
    useSoupListNavigationHotkeys({
      splitHotkeyScope: panel.splitHotkeyScope,
      viewId: 'calls',
      dataSource: source,
      controller: list,
      handle: panel.handle,
      openEntityInSplit: (entity, options) => {
        void openEntityInSplitFromUnifiedList(entity, {
          splitHandle: panel.handle,
          ...options,
        });
      },
    });
  });

  const [viewport, setViewport] = createSignal<HTMLDivElement>();
  const [grid, setGrid] = createSignal<HTMLDivElement>();
  const [virtualizer, setVirtualizer] = createSignal<VirtualizerHandle>();
  const viewportSize = createElementSize(viewport);

  const selectedEntities = createMemo(() =>
    list.selection
      .items()
      .flatMap((row) => (row.kind === 'entity' ? [row.entity] : []))
  );

  const actionState = toEntityActionListState({
    controller: list,
    getEntity: (row) => (row.kind === 'entity' ? row.entity : undefined),
    onFocus: (target) => {
      if (target) {
        virtualizer()?.scrollToIndex(target.index, { align: 'nearest' });
      }
      grid()?.focus();
    },
  });

  const entityActionViewContext = () =>
    resolveEntityActionViewContext({
      activeListView: 'calls',
      activeTab: 'all',
    });

  useListInteractions({
    controller: list,
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    scrollHandle: virtualizer,
    navigation: {
      onNavigate: (event) => {
        if (event.kind !== 'move' || event.direction !== 1) return;
        if (source.error()) return;

        if (!event.result || list.items.count() - event.result.index <= 4) {
          void source.loadMore();
        }
      },
    },
    activation: {
      createMetadata: (intent) => ({ newSplit: intent === 'alternate' }),
      alternateDescription: 'Open in new split',
    },
  });

  useEntityActionHotkeys({
    scopeId: panel.splitHotkeyScope,
    list: actionState,
    selectedEntities,
    focusedEntity: () => {
      const item = list.focus.item();
      return item?.kind === 'entity' ? item.entity : undefined;
    },
    restoreFocus: () => grid()?.focus(),
    viewContext: entityActionViewContext,
    splitHandle: panel.handle,
    condition: panel.isPanelActive,
  });

  const checkNearEnd = () => {
    if (forceEmptyState() || source.error()) return;
    if (source.isLoading() || source.isFetching() || !source.hasMore()) return;

    const container = viewport();
    if (!container || container.clientHeight === 0) return;

    const distance =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distance < 300) void source.loadMore();
  };

  createEffect(() => {
    source.items();
    source.isFetching();
    viewportSize.height;

    const frame = requestAnimationFrame(checkNearEnd);
    onCleanup(() => cancelAnimationFrame(frame));
  });

  const rows = source.items;

  const searchQuery = () => searchText().trim();

  return (
    <MaybeSoupEntityActionDrawerManager>
      <div class="flex size-full min-h-0 min-w-0 flex-col">
        <div class="shrink-0 pb-2">
          <SearchBar
            label="Search calls"
            placeholder="Search calls"
            value={searchText()}
            onValueChange={setSearchText}
            onEscape={() => grid()?.focus()}
          />
        </div>
        <div
          ref={setGrid}
          role="grid"
          aria-label="Calls"
          aria-multiselectable="true"
          aria-activedescendant={list.focus.key()}
          tabIndex={0}
          class="soup-list relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden outline-none"
        >
          <ListLayoutProvider ref={grid}>
            <Switch>
              <Match
                when={
                  !forceEmptyState() &&
                  source.isLoading() &&
                  rows().length === 0
                }
              >
                <div class="grid min-h-0 flex-1 place-items-center text-ink-muted">
                  <SpinnerIcon
                    aria-label="Loading calls"
                    class="size-5 animate-spin"
                  />
                </div>
              </Match>

              <Match when={!forceEmptyState() && source.error()}>
                <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-sm text-ink-muted">
                  <span>
                    {searchQuery()
                      ? 'Search couldn’t be completed.'
                      : 'Calls couldn’t be loaded.'}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    class="rounded-lg"
                    onClick={() => void source.refresh()}
                  >
                    Try again
                  </Button>
                </div>
              </Match>

              <Match when={forceEmptyState() || rows().length === 0}>
                <div class="min-h-0 flex-1 overflow-y-auto">
                  <EmptyStatePanel
                    graphic={
                      searchQuery()
                        ? EmptyStateNoSearchMatchGraphic
                        : EmptyStateCallsGraphic
                    }
                    title={
                      !searchQuery()
                        ? 'No calls in this channel'
                        : validateSearchServiceText(searchQuery())
                          ? `No results for "${searchQuery()}"`
                          : 'Keep typing to search'
                    }
                    description={
                      !searchQuery()
                        ? 'Recordings, transcriptions, and summaries of calls in this channel will appear here.'
                        : validateSearchServiceText(searchQuery())
                          ? 'Search matches call names and transcripts in this channel.'
                          : 'Call search starts at 3 characters and matches names and transcripts.'
                    }
                    documentationUrl={LIST_VIEW_DOCS_URL.calls}
                  />
                </div>
              </Match>

              <Match when={true}>
                <div
                  ref={setViewport}
                  class="scrollbar-hidden min-h-0 flex-1 overflow-y-auto overscroll-none"
                  onScroll={checkNearEnd}
                >
                  <Suspense>
                    <Virtualizer
                      ref={setVirtualizer}
                      data={rows()}
                      scrollRef={viewport()}
                      bufferSize={500}
                      itemSize={44}
                      keepMounted={
                        list.focus.index() >= 0
                          ? [list.focus.index()]
                          : undefined
                      }
                      onScroll={checkNearEnd}
                    >
                      {(row) => (
                        <Switch>
                          <Match when={row.kind === 'entity' ? row : undefined}>
                            {(entityRow) => (
                              <SoupEntityContextMenu
                                entity={entityRow().entity}
                                list={actionState}
                                selectedEntities={selectedEntities}
                                viewContext={entityActionViewContext()}
                                onOpenChange={(open) => {
                                  if (!open) return;
                                  list.focus.set(entityRow().id, {
                                    reason: 'pointer',
                                    force: true,
                                  });
                                  list.selection.setAnchor(entityRow().id);
                                }}
                              >
                                <div
                                  id={entityRow().id}
                                  role="row"
                                  data-soup-entity
                                >
                                  <div role="gridcell">
                                    <ListEntity
                                      entity={entityRow().entity}
                                      hideCheckbox
                                      highlighted={
                                        !isTouchDevice() &&
                                        list.focus.key() === entityRow().id
                                      }
                                      onMouseMove={() =>
                                        list.focus.set(entityRow().id, {
                                          reason: 'hover',
                                        })
                                      }
                                      onClick={(event) => {
                                        list.activate.key(entityRow().id, {
                                          reason: 'pointer',
                                          metadata: { event },
                                        });
                                      }}
                                    />
                                  </div>
                                </div>
                              </SoupEntityContextMenu>
                            )}
                          </Match>
                          <Match
                            when={row.kind === 'load-more' ? row : undefined}
                          >
                            {(loadMore) => (
                              <div id={loadMore().id} role="row">
                                <div
                                  role="gridcell"
                                  aria-busy={loadMore().isLoading}
                                  class={cn(
                                    'my-1 flex min-h-12 items-center justify-center rounded-lg',
                                    !isTouchDevice() &&
                                      list.focus.key() === loadMore().id &&
                                      'bg-active/60'
                                  )}
                                  onMouseMove={() =>
                                    list.focus.set(loadMore().id, {
                                      reason: 'hover',
                                    })
                                  }
                                  onClick={() =>
                                    list.activate.key(loadMore().id, {
                                      reason: 'pointer',
                                    })
                                  }
                                >
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    depth={2}
                                    disabled={loadMore().isLoading}
                                    class="bg-surface"
                                  >
                                    <Show
                                      when={!loadMore().isLoading}
                                      fallback={
                                        <SpinnerIcon class="size-3 animate-spin" />
                                      }
                                    >
                                      <CaretDownIcon class="size-2.5" />
                                    </Show>
                                    {loadMore().isLoading
                                      ? 'Loading...'
                                      : 'Load More'}
                                  </Button>
                                </div>
                              </div>
                            )}
                          </Match>
                        </Switch>
                      )}
                    </Virtualizer>
                  </Suspense>
                </div>
              </Match>
            </Switch>
          </ListLayoutProvider>
        </div>
      </div>
    </MaybeSoupEntityActionDrawerManager>
  );
}
