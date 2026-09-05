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
import { InboxListEntity } from '@app/features/next-soup/soup-view/views/inbox/InboxListEntity';
import {
  createSoupEntityActions,
  MaybeSoupEntityActionDrawerManager,
  SoupEntityContextMenu,
  useSoupListNavigationHotkeys,
  viewedProjectIdFromContent,
} from '@app/features/soup';
import { DEBUG_SETTING_KEYS, useDebugSetting } from '@app/lib/debugSettings';
import { makePersistedState } from '@app/lib/persistence';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
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
  isNonMemberChannelEntity,
  type WithNotification,
} from '@entity';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import { Button, cn } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  Match,
  type Setter,
  Show,
  Switch,
} from 'solid-js';
import { Virtualizer, type VirtualizerHandle } from 'virtua/solid';
import {
  persistSoupNavigationTouchHighlight,
  soupNavigationTouchHighlight,
} from '../../next-soup/soup-view/soup-navigation-touch-highlight';
import {
  markChannelNotificationsSeenOnOpen,
  markReminderSeenOnOpen,
  openEntityInSplitFromUnifiedList,
} from '../../next-soup/utils';
import { useInboxView } from '../inbox-view-context';
import {
  createInboxListEntryStorage,
  DEFAULT_INBOX_LIST_STATE,
  type InboxListStateSnapshot,
} from '../persistence';
import {
  type InboxDataSourceItem,
  useInboxDataSource,
} from '../queries/use-inbox-query';
import { useInboxPreview } from '../use-inbox-preview';
import { InboxDateGroupHeader } from './InboxDateGroupHeader';
import { InboxEmptyState } from './InboxEmptyState';

type InboxActionRow = {
  entity: WithNotification<EntityData>;
  rowId: string;
};

type InboxListActivationMetadata = {
  event?: MouseEvent;
  newSplit?: boolean;
};

/** Compact Inbox-card list used by the Activity-layout Inbox workspace. */
export function InboxList() {
  const { state } = useInboxView();
  const panel = useSplitPanelOrThrow();
  const notificationSource = useGlobalNotificationSource();

  const source = withSplitPanelOwner(listOwnedSlotName('data-source'), () =>
    useInboxDataSource(state)
  );

  const list = withSplitPanelOwner(listOwnedSlotName('controller'), () =>
    createListController<InboxDataSourceItem, InboxListActivationMetadata>({
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
      viewId: 'inbox',
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

  const preview = useInboxPreview({
    controller: list,
    handle: panel.handle,
    onPreview: (entity) => {
      void openEntity(entity, {
        newSplit: false,
        replacePair: false,
        mergeHistory: true,
      });
    },
  });

  const { buildActionGroups } = createSoupEntityActions();
  const entityActionViewContext = () =>
    resolveEntityActionViewContext({
      activeListView: panel.handle.content().id,
      activeTab: state.tab,
    });

  function onActivate({
    item,
    metadata,
  }: ListActivation<InboxDataSourceItem, InboxListActivationMetadata>) {
    if (item.kind === 'load-more') {
      if (!item.isLoading) void source.loadMore();

      return;
    }

    if (item.kind !== 'entity') return;

    const sourceRow = source.items().find((row) => row.id === item.id);

    if (sourceRow?.kind !== 'entity') return;

    const newSplit =
      metadata?.newSplit === true || metadata?.event?.shiftKey === true;

    preview.cancel();

    void openEntity(sourceRow.entity, {
      event: metadata?.event,
      newSplit,
      replacePair: metadata?.event?.altKey === true && !newSplit,
    });
  }

  async function openEntity(
    entity: WithNotification<EntityData>,
    options: {
      event?: MouseEvent;
      newSplit: boolean;
      replacePair: boolean;
      mergeHistory?: boolean;
    }
  ) {
    markReminderSeenOnOpen(entity, notificationSource);
    if (!isNonMemberChannelEntity(entity)) {
      markChannelNotificationsSeenOnOpen(entity, notificationSource);
    }

    const finishTouchHighlight = options.event
      ? persistSoupNavigationTouchHighlight(options.event)
      : undefined;

    try {
      await openEntityInSplitFromUnifiedList(entity, {
        openInNewSplit: options.newSplit,
        replacePreview: options.replacePair,
        splitHandle: panel.handle,
        referredFrom: 'inbox',
        mergeHistory: options.mergeHistory,
      });
    } finally {
      finishTouchHighlight?.();
    }
  }

  const [viewport, setViewport] = createSignal<HTMLDivElement>();
  const [emptyViewport, setEmptyViewport] = createSignal<HTMLDivElement>();
  const [virtualizer, setVirtualizer] = createSignal<VirtualizerHandle>();
  const [isPullRefreshing, setIsPullRefreshing] = createSignal(false);
  const forceEmptyState = useDebugSetting(
    DEBUG_SETTING_KEYS.FORCE_EMPTY_STATES
  );

  let scrollOffset = DEFAULT_INBOX_LIST_STATE.scrollOffset;
  const readListState = (): InboxListStateSnapshot => ({
    focusKey: list.focus.requestedKey(),
    scrollOffset: virtualizer()?.scrollOffset ?? scrollOffset,
  });

  const applyListState: Setter<InboxListStateSnapshot> = (next) => {
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
    { storages: createInboxListEntryStorage(panel.handle) }
  );

  const rows = source.items;

  const swipeRowsById = createMemo(() => {
    const entities = new Map<string, InboxActionRow>();

    for (const row of rows()) {
      if (row.kind !== 'entity') continue;

      entities.set(row.id, { entity: row.entity, rowId: row.id });
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

  let listRoot: HTMLDivElement | undefined;
  const actionState = toEntityActionListState({
    controller: list,
    getEntity: (row) => (row.kind === 'entity' ? row.entity : undefined),
    onFocus: (target) => {
      if (target) {
        virtualizer()?.scrollToIndex(target.index, { align: 'nearest' });
      }

      listRoot?.focus();
    },
  });

  const listInteractions = useListInteractions({
    controller: list,
    scopeId: panel.splitHotkeyScope,
    scrollHandle: virtualizer,
    enabled: panel.isPanelActive,
    navigation: {
      onNavigate: (event) => {
        const row = event.result?.item;
        if (row?.kind === 'entity') {
          preview.request(row.entity);
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
    restoreFocus: () => listRoot?.focus(),
    viewContext: entityActionViewContext,
    splitHandle: panel.handle,
    condition: panel.isPanelActive,
  });

  function actionGroupsFor(row: InboxActionRow) {
    const content = panel.handle.content();

    return buildActionGroups(actionState, [row.entity], {
      viewContext: entityActionViewContext(),
      viewedProjectId: viewedProjectIdFromContent(content),
      splitHandle: panel.handle,
    });
  }

  const markDoneActionFor = (row: InboxActionRow) =>
    actionGroupsFor(row)
      .flatMap((group) => group.items)
      .find((action) => action.id === 'mark-done');

  function focusActionRow(row: InboxActionRow) {
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

  let activeTab = state.tab;
  createEffect(() => {
    const nextTab = state.tab;
    if (nextTab === activeTab) return;

    activeTab = nextTab;
    preview.cancel();
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
        ref={listRoot}
        role="grid"
        aria-label="Inbox"
        aria-multiselectable="true"
        aria-activedescendant={list.focus.key()}
        tabIndex={0}
        class="soup-list relative mt-3 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden outline-none"
        style={{ '--mobile-content-inset-top': '0px' }}
      >
        <PullToRefresh
          scrollContainer={pullScrollContainer}
          onRefresh={pullRefresh}
        />

        <SwipableRowProvider
          container={viewport}
          canSwipeLeft={(rowId) => {
            const row = swipeRowsById().get(rowId);
            return row ? markDoneActionFor(row) !== undefined : false;
          }}
          onSwipeLeft={(rowId) => {
            const row = swipeRowsById().get(rowId);
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
                !forceEmptyState() && source.isLoading() && !isPullRefreshing()
              }
            >
              <div class="grid min-h-0 flex-1 place-items-center text-ink-muted">
                <SpinnerIcon
                  aria-label="Loading inbox"
                  class="size-5 animate-spin"
                />
              </div>
            </Match>

            <Match when={!forceEmptyState() && source.error()}>
              <div
                ref={setEmptyViewport}
                class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-y-auto pb-[max(1rem,var(--mobile-content-inset-bottom,0px))] text-sm text-ink-muted"
              >
                <span>Inbox couldn’t be loaded.</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void source.refresh()}
                >
                  Try again
                </Button>
              </div>
            </Match>

            <Match when={forceEmptyState() || rows().length === 0}>
              <div
                ref={setEmptyViewport}
                class="min-h-0 flex-1 overflow-y-auto pb-[max(1rem,var(--mobile-content-inset-bottom,0px))]"
              >
                <InboxEmptyState />
              </div>
            </Match>

            <Match when={true}>
              <div
                ref={(element) => {
                  setViewport(element);
                  soupNavigationTouchHighlight(element);
                }}
                class="scrollbar-hidden min-h-0 flex-1 overflow-y-auto overscroll-none pb-[max(0.5rem,var(--mobile-content-inset-bottom,0px))]"
              >
                <Virtualizer
                  ref={registerVirtualizer}
                  data={rows()}
                  scrollRef={viewport()}
                  bufferSize={500}
                  itemSize={88}
                  keepMounted={
                    list.focus.index() >= 0 ? [list.focus.index()] : undefined
                  }
                  onScroll={checkNearEnd}
                >
                  {(row) => (
                    <Switch>
                      <Match
                        when={row.kind === 'group-header' ? row : undefined}
                      >
                        {(group) => (
                          <InboxDateGroupHeader
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
                                <InboxListEntity
                                  class="mx-0 w-full border-b border-edge touch:border-b-0"
                                  cardClass="rounded-none px-4 py-3"
                                  entity={entityRow().entity}
                                  occurrenceKey={entityRow().id}
                                  checked={list.selection.isSelected(
                                    entityRow().id
                                  )}
                                  hideCheckbox
                                  highlighted={
                                    !isTouchDevice() &&
                                    list.focus.key() === entityRow().id
                                  }
                                  focusable={false}
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
                      <Match when={row.kind === 'load-more' ? row : undefined}>
                        {(loadMore) => (
                          <div id={loadMore().id} role="row">
                            <div
                              role="gridcell"
                              aria-busy={loadMore().isLoading}
                              class={cn(
                                'flex min-h-12 items-center justify-center',
                                !isTouchDevice() &&
                                  list.focus.key() === loadMore().id &&
                                  'bg-active/60'
                              )}
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
              </div>
            </Match>
          </Switch>
        </SwipableRowProvider>

        <Show when={selectedEntities().length > 0}>
          <EntitySelectionToolbar
            selected={selectedEntities()}
            onClear={listInteractions.selection.clear}
            analyticsSource="inbox_view_selection_toolbar"
          />
        </Show>
      </div>
    </MaybeSoupEntityActionDrawerManager>
  );
}
