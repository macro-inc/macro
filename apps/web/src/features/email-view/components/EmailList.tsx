import '@entity/composed/ListEntity.css';
import {
  createListController,
  type ListActivation,
  listOwnedSlotName,
  useListInteractions,
} from '@app/components/list';
import {
  resolveEntityActionViewContext,
  toEntityActionListState,
  useEntityActionHotkeys,
} from '@app/features/next-soup/actions';
import {
  createSoupEntityActions,
  MaybeSoupEntityActionDrawerManager,
  SoupEntityContextMenu,
  useSoupListNavigationHotkeys,
  viewedProjectIdFromContent,
} from '@app/features/soup';
import { DEBUG_SETTING_KEYS, useDebugSetting } from '@app/lib/debugSettings';
import { makePersistedState } from '@app/lib/persistence';
import { PullToRefresh } from '@components/app/mobile/PullToRefresh';
import { SwipableRowProvider } from '@components/app/mobile/SwipableRow';
import {
  useSplitPanelOrThrow,
  withSplitPanelOwner,
} from '@components/app/split-layout/layoutUtils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import {
  type EntityData,
  EntitySelectionToolbar,
  ListEntity,
  ListLayoutProvider,
  type WithNotification,
} from '@entity';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import { useTagSets, useTagSetsReady } from '@property/tags/tag-sets-context';
import { createElementSize } from '@solid-primitives/resize-observer';
import { debounce } from '@solid-primitives/scheduled';
import { Button, cn } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  Match,
  onCleanup,
  type Setter,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import { Virtualizer, type VirtualizerHandle } from 'virtua/solid';
import {
  persistSoupNavigationTouchHighlight,
  soupNavigationTouchHighlight,
} from '../../next-soup/soup-view/soup-navigation-touch-highlight';
import { openEntityInSplitFromUnifiedList } from '../../next-soup/utils';
import { useEmailView } from '../email-view-context';
import {
  createEmailListEntryStorage,
  DEFAULT_EMAIL_LIST_STATE,
  type EmailListStateSnapshot,
} from '../persistence';
import {
  type EmailDataSourceItem,
  useEmailDataSource,
} from '../queries/use-email-query';
import { useEmailListHotkeys } from '../use-email-list-hotkeys';
import { EmailDateGroupHeader } from './EmailDateGroupHeader';
import { EmailEmptyState } from './EmailEmptyState';

type EmailActionRow = {
  entity: WithNotification<EntityData>;
  rowId: string;
};

type EmailListActivationMetadata = {
  event?: MouseEvent;
  newSplit?: boolean;
};

export type EmailListProps = {
  /** The focusable list root, for callers that hand keyboard focus back. */
  ref?: (element: HTMLDivElement) => void;
};

export function EmailList(props: EmailListProps) {
  const { state, setOpenThreadId } = useEmailView();
  const panel = useSplitPanelOrThrow();

  const tagSets = useTagSets();
  const tagSetsReady = useTagSetsReady();
  const source = withSplitPanelOwner(listOwnedSlotName('data-source'), () =>
    useEmailDataSource(state, { tagSets, tagSetsReady })
  );

  function openEntity(
    entity: EntityData,
    options: {
      event?: MouseEvent;
      openInNewSplit?: boolean;
      replacePreview?: boolean;
      mergeHistory?: boolean;
    } = {}
  ) {
    if (entity.type === 'email') setOpenThreadId(entity.id);

    const finishTouchHighlight = options.event
      ? persistSoupNavigationTouchHighlight(options.event)
      : undefined;

    void openEntityInSplitFromUnifiedList(entity, {
      splitHandle: panel.handle,
      referredFrom: 'mail',
      openInNewSplit: options.openInNewSplit,
      replacePreview: options.replacePreview,
      mergeHistory: options.mergeHistory,
    }).finally(() => finishTouchHighlight?.());
  }

  const previewAfterNavigation = debounce(
    (entity: EntityData) => openEntity(entity, { mergeHistory: true }),
    150
  );
  onCleanup(() => previewAfterNavigation.clear());

  function onActivate({
    item,
    metadata,
  }: ListActivation<EmailDataSourceItem, EmailListActivationMetadata>) {
    if (item.kind === 'load-more') {
      if (!item.isLoading) void source.loadMore();

      return;
    }

    if (item.kind !== 'entity') return;

    const sourceRow = source.items().find((row) => row.id === item.id);

    if (sourceRow?.kind !== 'entity') return;

    previewAfterNavigation.clear();

    const newSplit =
      metadata?.newSplit === true || metadata?.event?.shiftKey === true;

    openEntity(sourceRow.entity, {
      event: metadata?.event,
      openInNewSplit: newSplit,
      replacePreview: metadata?.event?.altKey === true && !newSplit,
    });
  }

  const list = withSplitPanelOwner(listOwnedSlotName('controller'), () =>
    createListController<EmailDataSourceItem, EmailListActivationMetadata>({
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

  withSplitPanelOwner(listOwnedSlotName('navigation-hotkeys'), () => {
    useSoupListNavigationHotkeys({
      splitHotkeyScope: panel.splitHotkeyScope,
      viewId: 'mail',
      dataSource: source,
      controller: list,
      handle: panel.handle,
      openEntityInSplit: (entity, options) => {
        openEntity(entity, { mergeHistory: options.mergeHistory });
      },
    });
  });

  const { buildActionGroups } = createSoupEntityActions();
  const entityActionViewContext = () =>
    resolveEntityActionViewContext({
      activeListView: panel.handle.content().id,
      activeTab: state.tab,
    });

  const [viewport, setViewport] = createSignal<HTMLDivElement>();
  const [topSpacer, setTopSpacer] = createSignal<HTMLDivElement>();
  const topSpacerSize = createElementSize(topSpacer);
  const [emptyViewport, setEmptyViewport] = createSignal<HTMLDivElement>();
  const [grid, setGrid] = createSignal<HTMLDivElement>();
  const [virtualizer, setVirtualizer] = createSignal<VirtualizerHandle>();
  const [isPullRefreshing, setIsPullRefreshing] = createSignal(false);
  const forceEmptyState = useDebugSetting(
    DEBUG_SETTING_KEYS.FORCE_EMPTY_STATES
  );

  let scrollOffset = DEFAULT_EMAIL_LIST_STATE.scrollOffset;
  const readListState = (): EmailListStateSnapshot => ({
    focusKey: list.focus.requestedKey(),
    scrollOffset: virtualizer()?.scrollOffset ?? scrollOffset,
  });

  const applyListState: Setter<EmailListStateSnapshot> = (next) => {
    const current = readListState();
    const value = typeof next === 'function' ? next(current) : next;

    if (value.focusKey !== current.focusKey) {
      list.focus.restore(value.focusKey, { reason: 'restore' });
    }

    scrollOffset = value.scrollOffset;
    if (value.scrollOffset !== current.scrollOffset) {
      virtualizer()?.scrollTo(value.scrollOffset);
    }

    return value;
  };
  const [, setPersistedListState] = makePersistedState(
    [readListState, applyListState],
    { storages: createEmailListEntryStorage(panel.handle) }
  );

  const rows = source.items;

  const swipeRowsByEntityId = createMemo(() => {
    const entities = new Map<string, EmailActionRow>();

    for (const row of rows()) {
      if (row.kind !== 'entity') continue;

      entities.set(row.entity.id, { entity: row.entity, rowId: row.id });
    }

    return entities;
  });

  const selectedEntities = createMemo(() =>
    list.selection
      .items()
      .flatMap((row) => (row.kind === 'entity' ? [row.entity] : []))
  );

  const focusedEntity = () => {
    const row = list.focus.result()?.item;
    return row?.kind === 'entity' ? row.entity : undefined;
  };

  const [collapseEntity, setCollapseEntity] =
    createSignal<(entityId: string) => Promise<void>>();

  const actionState = toEntityActionListState({
    controller: list,
    getEntity: (row) => (row.kind === 'entity' ? row.entity : undefined),
    collapse: {
      // Signal and Noise remove archived threads; finish the row animation first.
      enabled: () =>
        isTouchDevice() && (state.tab === 'important' || state.tab === 'noise'),
      run: async (entityId) => {
        await collapseEntity()?.(entityId);
      },
    },
    onFocus: (target) => {
      if (target) {
        virtualizer()?.scrollToIndex(target.index, { align: 'nearest' });
      }

      grid()?.focus();
    },
  });

  const listInteractions = useListInteractions({
    controller: list,
    scopeId: panel.splitHotkeyScope,
    scrollHandle: virtualizer,
    enabled: panel.isPanelActive,
    navigation: {
      onNavigate: (event) => {
        previewAfterNavigation.clear();

        const row = event.result?.item;
        if (row?.kind === 'entity' && panel.handle.isControllerSplit()) {
          previewAfterNavigation(row.entity);
        }

        if (event.kind !== 'move' || event.direction !== 1) return;
        if (source.isLoadingMore() || !source.hasMore()) return;

        const distanceFromEnd = event.result
          ? list.items.count() - event.result.index - 1
          : 0;

        if (distanceFromEnd > 3) return;

        void source.loadMore();
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
    focusedEntity,
    restoreFocus: () => grid()?.focus(),
    viewContext: entityActionViewContext,
    splitHandle: panel.handle,
    condition: panel.isPanelActive,
  });

  useEmailListHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    selectedEntities,
    clearSelection: listInteractions.selection.clear,
  });

  function actionGroupsFor(row: EmailActionRow) {
    const content = panel.handle.content();

    return buildActionGroups(actionState, [row.entity], {
      viewContext: entityActionViewContext(),
      viewedProjectId: viewedProjectIdFromContent(content),
      splitHandle: panel.handle,
    });
  }

  const markDoneActionFor = (row: EmailActionRow) =>
    actionGroupsFor(row)
      .flatMap((group) => group.items)
      .find((action) => action.id === 'mark-done');

  function focusActionRow(row: EmailActionRow) {
    list.focus.set(row.rowId, { reason: 'pointer', force: true });
    list.selection.setAnchor(row.rowId);
  }

  let restoredScroll = false;
  function registerVirtualizer(handle?: VirtualizerHandle) {
    setVirtualizer(handle);
    if (!handle || restoredScroll) return;

    handle.scrollTo(scrollOffset);
    restoredScroll = true;
  }

  function showsEmptyViewport() {
    return (
      forceEmptyState() ||
      (!source.isLoading() && (Boolean(source.error()) || rows().length === 0))
    );
  }

  function pullScrollContainer() {
    return showsEmptyViewport() ? emptyViewport() : viewport();
  }

  async function pullRefresh() {
    setIsPullRefreshing(true);

    try {
      await source.refresh();
    } finally {
      setIsPullRefreshing(false);
    }
  }

  // Switching tab or inbox scope is a new list: drop focus, selection, and
  // the preview, and start from the top.
  const listScope = () =>
    `${state.tab}|${state.inboxIds === undefined ? '*' : state.inboxIds.join(',')}`;
  let activeScope = listScope();
  createEffect(() => {
    const nextScope = listScope();
    if (nextScope === activeScope) return;

    activeScope = nextScope;
    previewAfterNavigation.clear();
    listInteractions.selection.clear();
    list.focus.clear({ reason: 'programmatic' });
    panel.handle.resetPreview();
    setPersistedListState((current) => ({ ...current, scrollOffset: 0 }));
  });

  createEffect(() => {
    rows();
    if (source.isLoading()) return;

    if (list.focus.result()) return;

    const restored = list.focus.restore(list.focus.requestedKey(), {
      retainUnavailable: false,
    });
    if (restored) return;
    if (isTouchDevice()) return;
    if (panel.handle.isControllerSplit()) {
      panel.handle.resetPreview();
      return;
    }

    list.focus.first({
      isNavigable: (row) => row.kind === 'entity',
      reason: 'restore',
    });
  });

  function checkNearEnd() {
    const handle = virtualizer();
    if (!handle) return;

    if (!source.hasMore()) return;

    const distance =
      handle.scrollSize - handle.scrollOffset - handle.viewportSize;
    if (distance < 300 && !source.isLoadingMore()) {
      void source.loadMore();
    }
  }

  return (
    <MaybeSoupEntityActionDrawerManager>
      <div
        ref={(element: HTMLDivElement) => {
          setGrid(element);
          props.ref?.(element);
        }}
        role="grid"
        aria-label="Email"
        aria-multiselectable="true"
        aria-activedescendant={list.focus.key()}
        tabIndex={0}
        class="soup-list relative flex size-full min-h-0 min-w-0 flex-col overflow-hidden outline-none"
      >
        <PullToRefresh
          scrollContainer={pullScrollContainer}
          onRefresh={pullRefresh}
        />

        <ListLayoutProvider ref={grid}>
          <SwipableRowProvider
            container={viewport}
            setCollapseEntity={setCollapseEntity}
            canSwipeLeft={(entityId) => {
              const row = swipeRowsByEntityId().get(entityId);
              return row ? markDoneActionFor(row) !== undefined : false;
            }}
            onSwipeLeft={(entityId) => {
              const row = swipeRowsByEntityId().get(entityId);
              if (!row) return;

              const action = markDoneActionFor(row);
              if (!action) return;

              focusActionRow(row);
              void action.onClick();
            }}
          >
            <Switch>
              <Match
                when={
                  !forceEmptyState() &&
                  source.isLoading() &&
                  !isPullRefreshing()
                }
              >
                <div class="grid min-h-0 flex-1 place-items-center text-ink-muted touch:pt-(--mobile-content-inset-top) touch:pb-(--mobile-content-inset-bottom)">
                  <SpinnerIcon
                    aria-label="Loading email"
                    class="size-5 animate-spin"
                  />
                </div>
              </Match>

              <Match when={!forceEmptyState() && source.error()}>
                <div
                  ref={setEmptyViewport}
                  class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-y-auto text-sm text-ink-muted touch:pt-(--mobile-content-inset-top) touch:pb-(--mobile-content-inset-bottom)"
                >
                  <span>Email couldn’t be loaded.</span>
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
                {/* No top inset on the wrapper: each EmptyStatePanel pads itself
                    below the floating chrome (centered ones by default, the
                    left-aligned ones in EmailEmptyState), so padding here too
                    would double it. */}
                <div
                  ref={setEmptyViewport}
                  class="min-h-0 flex-1 overflow-y-auto touch:pb-(--mobile-content-inset-bottom)"
                >
                  <EmailEmptyState />
                </div>
              </Match>

              <Match when={true}>
                <div
                  ref={(element) => {
                    setViewport(element);
                    soupNavigationTouchHighlight(element);
                  }}
                  class="scrollbar-hidden min-h-0 flex-1 overflow-y-auto overscroll-none"
                >
                  {/* Keep insets inside the scroller so rows slide under the floating chrome. */}
                  <div
                    ref={setTopSpacer}
                    aria-hidden="true"
                    class="h-0 touch:h-(--mobile-content-inset-top)"
                  />
                  {/* A row subtree that suspends (the project crumb's preview query, say)
                      detaches only itself, not the list and its scroll position. */}
                  <Suspense>
                    <Virtualizer
                      ref={registerVirtualizer}
                      data={rows()}
                      scrollRef={viewport()}
                      startMargin={
                        isTouchDevice() ? (topSpacerSize.height ?? 0) : 0
                      }
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
                          <Match
                            when={row.kind === 'group-header' ? row : undefined}
                          >
                            {(group) => (
                              <EmailDateGroupHeader
                                row={group()}
                                isFirst={rows()[0]?.id === group().id}
                              />
                            )}
                          </Match>
                          <Match when={row.kind === 'entity' ? row : undefined}>
                            {(entityRow) => (
                              <SoupEntityContextMenu
                                entity={entityRow().entity}
                                list={actionState}
                                selectedEntities={selectedEntities}
                                viewContext={entityActionViewContext()}
                                onOpenChange={(open) => {
                                  if (!open) return;
                                  focusActionRow({
                                    entity: entityRow().entity,
                                    rowId: entityRow().id,
                                  });
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
                                      checked={list.selection.isSelected(
                                        entityRow().id
                                      )}
                                      highlighted={
                                        !isTouchDevice() &&
                                        list.focus.key() === entityRow().id
                                      }
                                      onMouseMove={() =>
                                        list.focus.set(entityRow().id, {
                                          reason: 'hover',
                                        })
                                      }
                                      onProjectClick={(project, event) => {
                                        const openInNewSplit = event.shiftKey;
                                        openEntity(project, {
                                          openInNewSplit,
                                          replacePreview:
                                            event.altKey && !openInNewSplit,
                                        });
                                      }}
                                      onChecked={(selected, shiftKey) =>
                                        listInteractions.selection.set(
                                          entityRow().id,
                                          selected,
                                          { range: shiftKey }
                                        )
                                      }
                                      entityRowConfig={{
                                        swipeLeftColor: 'bg-success',
                                        swipeLeftRevealedComponent: (
                                          <CheckIcon class="size-8 text-surface" />
                                        ),
                                      }}
                                      onClick={(event) => {
                                        if (
                                          event.metaKey ||
                                          event.ctrlKey ||
                                          (isTouchDevice() &&
                                            list.selection.count() > 0)
                                        ) {
                                          listInteractions.selection.toggle(
                                            entityRow().id
                                          );
                                          return;
                                        }

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
                  <Show when={isTouchDevice()}>
                    <div
                      aria-hidden="true"
                      class="h-(--mobile-content-inset-bottom)"
                    />
                  </Show>
                </div>
              </Match>
            </Switch>
          </SwipableRowProvider>
        </ListLayoutProvider>

        <Show when={selectedEntities().length > 0}>
          <EntitySelectionToolbar
            selected={selectedEntities()}
            onClear={listInteractions.selection.clear}
            analyticsSource="email_view_selection_toolbar"
          />
        </Show>
      </div>
    </MaybeSoupEntityActionDrawerManager>
  );
}
