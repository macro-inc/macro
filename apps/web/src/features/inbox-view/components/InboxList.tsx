import '@entity/composed/ListEntity.css';
import {
  createListController,
  type ListActivation,
  listOwnedSlotName,
  useListInteractions,
} from '@app/components/list';
import {
  type EntityActionNavigationHandler,
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
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { PullToRefresh } from '@components/app/mobile/PullToRefresh';
import { SwipableRowProvider } from '@components/app/mobile/SwipableRow';
import {
  useSplitPanelOrThrow,
  withSplitPanelOwner,
} from '@components/app/split-layout/layoutUtils';
import { useChannelsContext } from '@core/context/channels';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import {
  type EntityData,
  EntitySelectionToolbar,
  isNonMemberChannelEntity,
  type WithNotification,
} from '@entity';
import { getChannelThreadName } from '@entity/utils/channel-thread-name';
import CheckIcon from '@phosphor/check.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import { createElementSize } from '@solid-primitives/resize-observer';
import { debounce } from '@solid-primitives/scheduled';
import { Button } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  Match,
  onCleanup,
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
import { HomeListEntity } from './HomeListEntity';
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

type InboxListProps = {
  previewEntity: EntityData | undefined;
  onPreviewEntityChange: (entity: EntityData | undefined) => void;
  onPreviewActivate?: () => void;
};

/** Compact notification list used by the Notifications workspace. */
export function InboxList(props: InboxListProps) {
  const channels = useChannelsContext();
  const channelName = (entity: WithNotification<EntityData>) =>
    entity.type === 'channel_thread'
      ? getChannelThreadName(entity, channels.channelsById())
      : undefined;
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
      isNavigable: (row) => row.kind === 'entity',
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
    if (item.kind !== 'entity') return;

    const sourceRow = source.items().find((row) => row.id === item.id);

    if (sourceRow?.kind !== 'entity') return;

    previewAfterNavigation.clear();

    const newSplit =
      metadata?.newSplit === true || metadata?.event?.shiftKey === true;

    if (!isTouchDevice() && !newSplit) {
      markEntitySeen(sourceRow.entity);
      showPreview(sourceRow.entity);
      props.onPreviewActivate?.();
      return;
    }

    void openEntity(sourceRow.entity, {
      event: metadata?.event,
      newSplit,
    });
  }

  function markEntitySeen(entity: WithNotification<EntityData>) {
    markReminderSeenOnOpen(entity, notificationSource);
    if (!isNonMemberChannelEntity(entity)) {
      markChannelNotificationsSeenOnOpen(entity, notificationSource);
    }
  }

  function showPreview(entity: WithNotification<EntityData>) {
    props.onPreviewEntityChange(entity);
  }

  const previewAfterNavigation = debounce(showPreview, 150);
  onCleanup(() => previewAfterNavigation.clear());

  async function openEntity(
    entity: WithNotification<EntityData>,
    options: {
      event?: MouseEvent;
      newSplit: boolean;
      mergeHistory?: boolean;
    }
  ) {
    markEntitySeen(entity);

    const finishTouchHighlight = options.event
      ? persistSoupNavigationTouchHighlight(options.event)
      : undefined;

    try {
      await openEntityInSplitFromUnifiedList(entity, {
        openInNewSplit: options.newSplit,
        splitHandle: panel.handle,
        referredFrom: 'inbox',
        mergeHistory: options.mergeHistory,
      });
    } finally {
      finishTouchHighlight?.();
    }
  }

  const [viewport, setViewport] = createSignal<HTMLDivElement>();
  const [topSpacer, setTopSpacer] = createSignal<HTMLDivElement>();
  const topSpacerSize = createElementSize(topSpacer);
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

  const createActionNavigationHandler = ():
    | EntityActionNavigationHandler
    | undefined => {
    if (props.previewEntity === undefined) return;

    return ({ entity }) => {
      previewAfterNavigation.clear();
      props.onPreviewEntityChange(entity);
    };
  };

  let listRoot: HTMLDivElement | undefined;
  const [collapseRow, setCollapseRow] =
    createSignal<(rowId: string) => Promise<void>>();

  const actionState = toEntityActionListState({
    controller: list,
    getEntity: (row) => (row.kind === 'entity' ? row.entity : undefined),
    collapse: {
      enabled: isTouchDevice,
      run: async (entityId) => {
        const collapse = collapseRow();
        if (!collapse) return;

        // Actions target entities; swipe rows are keyed by notification occurrence.
        await Promise.all(
          rows().flatMap((row) =>
            row.kind === 'entity' && row.entity.id === entityId
              ? [collapse(row.id)]
              : []
          )
        );
      },
    },
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
        previewAfterNavigation.clear();

        const row = event.result?.item;
        if (!isTouchDevice() && row?.kind === 'entity') {
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
    enableDeleteHotkey: false,
    scopeId: panel.splitHotkeyScope,
    list: actionState,
    selectedEntities,
    focusedEntity,
    restoreFocus: () => listRoot?.focus(),
    viewContext: entityActionViewContext,
    splitHandle: panel.handle,
    createActionNavigationHandler,
    condition: panel.isPanelActive,
  });

  function actionGroupsFor(row: InboxActionRow) {
    const content = panel.handle.content();

    return buildActionGroups(actionState, [row.entity], {
      viewContext: entityActionViewContext(),
      viewedProjectId: viewedProjectIdFromContent(content),
      splitHandle: panel.handle,
      createActionNavigationHandler,
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
    previewAfterNavigation.clear();
    listInteractions.selection.clear();
    list.focus.clear({ reason: 'programmatic' });
    setPersistedListState((current) => ({ ...current, scrollOffset: 0 }));
  });

  createEffect(() => {
    rows();
    if (source.isLoading()) return;

    if (list.focus.result()) return;

    list.focus.restore(list.focus.requestedKey(), {
      retainUnavailable: false,
    });
  });

  function checkNearEnd() {
    if (
      forceEmptyState() ||
      source.isLoading() ||
      source.isFetching() ||
      source.error() ||
      !source.hasMore()
    )
      return;

    const container = pullScrollContainer();
    if (!container || container.clientHeight === 0) return;

    const distance =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distance < 300) {
      void source.loadMore();
    }
  }

  const scrollContainerSize = createElementSize(pullScrollContainer);
  createEffect(() => {
    rows();
    source.isFetching();
    scrollContainerSize.height;

    // Fill short or filtered pages without waiting for a scroll event.
    const frame = requestAnimationFrame(checkNearEnd);
    onCleanup(() => cancelAnimationFrame(frame));
  });

  return (
    <MaybeSoupEntityActionDrawerManager>
      <div
        ref={listRoot}
        role="grid"
        aria-label="Home"
        aria-multiselectable="true"
        aria-activedescendant={list.focus.key()}
        tabIndex={0}
        class="soup-list relative mt-3 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden outline-none touch:mt-0"
      >
        <Show when={source.warning()}>
          {(warning) => (
            <div
              role="status"
              class="flex items-center gap-2 px-4 pb-2 text-xs text-ink-muted"
            >
              <span>{warning()}</span>
              <button
                type="button"
                class="underline"
                onClick={() => void source.refresh()}
              >
                Retry
              </button>
            </div>
          )}
        </Show>
        <PullToRefresh
          scrollContainer={pullScrollContainer}
          onRefresh={pullRefresh}
        />

        <SwipableRowProvider
          container={viewport}
          setCollapseEntity={setCollapseRow}
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
              <div class="grid min-h-0 flex-1 place-items-center text-ink-muted touch:pt-(--mobile-content-inset-top)">
                <SpinnerIcon
                  aria-label="Loading Home"
                  class="size-5 animate-spin"
                />
              </div>
            </Match>

            <Match when={!forceEmptyState() && source.error()}>
              <div
                ref={setEmptyViewport}
                class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-y-auto pb-[max(1rem,var(--mobile-content-inset-bottom,0px))] touch:pt-(--mobile-content-inset-top) text-sm text-ink-muted"
              >
                <span>Home couldn’t be loaded.</span>
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
                onScroll={checkNearEnd}
              >
                {/* The spacer scrolls away; the viewport stays behind the filters. */}
                <div
                  ref={setTopSpacer}
                  aria-hidden="true"
                  class="h-0 touch:h-(--mobile-content-inset-top)"
                />
                <Virtualizer
                  ref={registerVirtualizer}
                  data={rows()}
                  scrollRef={viewport()}
                  startMargin={
                    isTouchDevice() ? (topSpacerSize.height ?? 0) : 0
                  }
                  bufferSize={500}
                  itemSize={36}
                  keepMounted={
                    list.focus.index() >= 0 ? [list.focus.index()] : undefined
                  }
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
                                <HomeListEntity
                                  channelName={channelName(entityRow().entity)}
                                  timestamp={
                                    state.tab === 'signal'
                                      ? entityRow().entity.sortTs
                                      : (entityRow().entity.notifiedAt ??
                                        entityRow().entity.sortTs)
                                  }
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
