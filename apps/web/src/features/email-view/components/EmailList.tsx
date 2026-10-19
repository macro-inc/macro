import '@entity/composed/ListEntity.css';
import { type ListActivation, useListInteractions } from '@app/components/list';
import { CommandState } from '@app/features/command/state';
import {
  resolveEntityActionViewContext,
  toEntityActionListState,
  useEntityActionHotkeys,
} from '@app/features/next-soup/actions';
import { EmailRowSchedule } from '@app/features/reminders/views/email-row-schedule';
import {
  createSoupEntityActions,
  MaybeSoupEntityActionDrawerManager,
  SoupEntityContextMenu,
  viewedProjectIdFromContent,
} from '@app/features/soup';
import { DEBUG_SETTING_KEYS, useDebugSetting } from '@app/lib/debugSettings';
import { makePersistedState } from '@app/lib/persistence';
import { PullToRefresh } from '@components/app/mobile/PullToRefresh';
import { SwipableRowProvider } from '@components/app/mobile/SwipableRow';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { createSplitAutofocus } from '@components/app/split-layout/utils/createSplitAutofocus';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { debounce } from '@core/util/debounce';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  type EntityData,
  EntitySelectionToolbar,
  ListEntity,
  ListLayoutProvider,
  type WithNotification,
} from '@entity';
import BellIcon from '@phosphor/bell-simple.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import { createElementSize } from '@solid-primitives/resize-observer';
import { Button, cn } from '@ui';
import { tourTarget } from '@ui/components/Tour';
import {
  createComputed,
  createEffect,
  createMemo,
  createSignal,
  Match,
  on,
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
import {
  type EmailListActivationMetadata,
  useEmailView,
} from '../email-view-context';
import {
  createEmailListEntryStorage,
  DEFAULT_EMAIL_LIST_STATE,
  type EmailListStateSnapshot,
} from '../persistence';
import { createEmailRowActionState } from '../primitives/row-action-state';
import type { EmailDataSourceItem } from '../queries/use-email-query';
import type { EmailListPane } from '../reader-pane';
import { EMAIL_TOUR } from '../tour';
import { useEmailListHotkeys } from '../use-email-list-hotkeys';
import { EmailDateGroupHeader } from './EmailDateGroupHeader';
import { EmailEmptyState } from './EmailEmptyState';
import { EmailRowActions, EmailStarAction } from './EmailRowActions';

type EmailActionRow = {
  entity: WithNotification<EntityData>;
  rowId: string;
};

export type EmailListProps = {
  /** The focusable list root, for callers that hand keyboard focus back. */
  ref?: (element: HTMLDivElement) => void;
  /** Present while threads open in a reading pane beside the list. */
  pane?: EmailListPane;
};

export function EmailList(props: EmailListProps) {
  const {
    state,
    source,
    list,
    registerListActivationHandler,
    openThread,
    selectedThread,
    filterByTag,
  } = useEmailView();
  const panel = useSplitPanelOrThrow();

  function openEntity(
    entity: EntityData,
    options: {
      event?: MouseEvent;
      openInNewSplit?: boolean;
    } = {}
  ) {
    const finishTouchHighlight = options.event
      ? persistSoupNavigationTouchHighlight(options.event)
      : undefined;

    fireAndForget(
      openEntityInSplitFromUnifiedList(entity, {
        splitHandle: panel.handle,
        referredFrom: 'mail',
        openInNewSplit: options.openInNewSplit,
      }).finally(() => finishTouchHighlight?.()),
      'open-entity-in-split'
    );
  }

  function onActivate({
    item,
    metadata,
  }: ListActivation<EmailDataSourceItem, EmailListActivationMetadata>) {
    if (item.kind === 'load-more') {
      if (!item.isLoading) void source.loadMore().catch(() => {});

      return;
    }

    if (item.kind !== 'entity') return;

    const sourceRow = source.items().find((row) => row.id === item.id);

    if (sourceRow?.kind !== 'entity') return;

    const newSplit =
      metadata?.newSplit === true || metadata?.event?.shiftKey === true;

    if (
      !newSplit &&
      metadata?.event?.altKey !== true &&
      openThread(
        { id: sourceRow.entity.id, fallbackName: sourceRow.entity.name },
        { event: metadata?.event }
      )
    ) {
      // Opening a row in the pane hands it the keyboard, so r, e and the
      // message arrows act on the thread just opened.
      props.pane?.focusReader(sourceRow.entity.id);
      return;
    }

    openEntity(sourceRow.entity, {
      event: metadata?.event,
      openInNewSplit: newSplit,
    });
  }

  registerListActivationHandler(onActivate);

  const { buildActionGroups, isFavorited } = createSoupEntityActions();
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
  // Coming back from a thread, or toggling the reading pane, remounts the
  // list with focus on the page; the list takes it so its keys and
  // screen-reader cursor work.
  createSplitAutofocus({
    element: () => grid() ?? null,
    enabled: () => panel.isPanelActive() && !isTouchDevice(),
  });
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

    // The view-owned controller survives inline detail navigation. Restore
    // persisted focus only on a cold mount that has no live focus to preserve.
    if (current.focusKey === undefined && value.focusKey !== undefined) {
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

  // With a reading pane, the open thread follows the keyboard cursor. Held
  // keys settle first; following replaces history rather than adding to it.
  const followInPane = debounce((entity: EntityData | undefined) => {
    if (!props.pane || entity?.type !== 'email') return;
    props.pane.focusReader(undefined);
    openThread({ id: entity.id, fallbackName: entity.name }, { replace: true });
  }, 60);
  onCleanup(() => followInPane.clear());
  // The row the cursor was on before its latest move, read when an action
  // moves the cursor: the pane follows only if it showed that row.
  let previousCursorId: string | undefined;
  createComputed(
    on(
      () => focusedEntity()?.id,
      (_id, previous) => {
        previousCursorId = previous;
      }
    )
  );
  // While the reader has the keyboard the list's keys stand down.
  const listHasKeyboard = () =>
    panel.isPanelActive() && !(props.pane?.readerHasKeyboard() ?? false);

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
        // Mark done moved past the open thread: the pane follows. An action
        // on another row (under the pointer) leaves the pane where it is.
        if (previousCursorId === selectedThread()?.id) {
          followInPane(target.entity);
        }
      }

      grid()?.focus();
    },
  });

  const listInteractions = useListInteractions({
    controller: list,
    scopeId: panel.splitHotkeyScope,
    scrollHandle: virtualizer,
    enabled: listHasKeyboard,
    navigation: {
      onNavigate: (event) => {
        const row = event.result?.item;
        if (row?.kind === 'entity') followInPane(row.entity);
        if (event.kind !== 'move' || event.direction !== 1) return;
        if (source.isLoadingMore() || source.error() || !source.hasMore())
          return;

        const distanceFromEnd = event.result
          ? list.items.count() - event.result.index - 1
          : 0;

        if (distanceFromEnd > 3) return;

        void source.loadMore().catch(() => {});
      },
    },
    activation: {
      shouldHandleKeyEvent: (event) =>
        !(
          event?.target instanceof Element &&
          event.target.closest('button[data-reminder-action]')
        ),
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
    condition: listHasKeyboard,
  });

  useEmailListHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: listHasKeyboard,
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

  const rowActionFor = (row: EmailActionRow, id: string) =>
    actionGroupsFor(row)
      .flatMap((group) => group.items)
      .find((action) => action.id === id);
  const markDoneActionFor = (row: EmailActionRow) =>
    rowActionFor(row, 'mark-done');
  const remindActionFor = (row: EmailActionRow) =>
    rowActionFor(row, 'create-reminder');

  function focusActionRow(row: EmailActionRow) {
    list.focus.set(row.rowId, { reason: 'pointer', force: true });
    list.selection.setAnchor(row.rowId);
  }

  const rowActionState = createEmailRowActionState();

  async function runRowAction(
    row: EmailActionRow,
    actionId: 'favorite' | 'mark-done' | 'mark-not-done'
  ) {
    const action = actionGroupsFor(row)
      .flatMap((group) => group.items)
      .find((item) => item.id === actionId);
    if (!action || action.disabled) return;

    await rowActionState.run(row.rowId, async () => {
      focusActionRow(row);
      try {
        await action.onClick();
      } catch {
        // Entity actions own their rollback and failure notification.
      } finally {
        grid()?.focus();
      }
    });
  }

  function RowActions(props: { row: EmailActionRow }) {
    const archived = () =>
      props.row.entity.type === 'email' && props.row.entity.done;

    return (
      <EmailRowActions
        archived={archived()}
        canArchive={entityActionViewContext().supportsMarkDone}
        pending={rowActionState.isPending(props.row.rowId)}
        onFocus={() => focusActionRow(props.row)}
        onArchive={() =>
          fireAndForget(
            runRowAction(props.row, archived() ? 'mark-not-done' : 'mark-done'),
            'email-view'
          )
        }
        onCommands={() => {
          focusActionRow(props.row);
          CommandState.openForEntityAction([props.row.entity]);
        }}
      />
    );
  }

  let restoredScroll = false;
  function registerVirtualizer(handle?: VirtualizerHandle) {
    setVirtualizer(handle);
    if (!handle || restoredScroll) return;

    handle.scrollTo(scrollOffset);
    restoredScroll = true;
  }

  const hasEmailRows = () => rows().some((row) => row.kind === 'entity');

  function showsEmptyViewport() {
    return (
      forceEmptyState() ||
      (!source.isLoading() &&
        ((Boolean(source.error()) && !hasEmailRows()) || rows().length === 0))
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
  // and start from the top.
  const listScope = () =>
    `${state.tab}|${state.inboxIds === undefined ? '*' : state.inboxIds.join(',')}|${state.aliasFilter?.emailAddress ?? ''}`;
  let activeScope = listScope();
  createEffect(() => {
    const nextScope = listScope();
    if (nextScope === activeScope) return;

    activeScope = nextScope;

    listInteractions.selection.clear();
    list.focus.clear({ reason: 'programmatic' });
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

    list.focus.first({
      isNavigable: (row) => row.kind === 'entity',
      reason: 'restore',
    });
  });

  function checkNearEnd() {
    const handle = virtualizer();
    if (!handle) return;

    if (!source.hasMore() || source.error()) return;

    const distance =
      handle.scrollSize - handle.scrollOffset - handle.viewportSize;
    if (distance < 300 && !source.isLoadingMore()) {
      void source.loadMore().catch(() => {});
    }
  }

  const listTarget = tourTarget(EMAIL_TOUR.list);
  return (
    <MaybeSoupEntityActionDrawerManager>
      <div
        ref={(element: HTMLDivElement) => {
          setGrid(element);
          listTarget(element);
          props.ref?.(element);
        }}
        role="grid"
        aria-label="Email"
        aria-multiselectable="true"
        aria-activedescendant={list.focus.key()}
        tabIndex={0}
        class="soup-list relative flex size-full min-h-0 min-w-0 flex-col overflow-hidden outline-none [--color-list-highlighted:var(--color-active)]"
      >
        <PullToRefresh
          scrollContainer={pullScrollContainer}
          onRefresh={pullRefresh}
        />

        <ListLayoutProvider ref={grid} narrowLayout="inbox">
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
              fireAndForget(action.onClick(), 'email-view');
            }}
            canSwipeRight={(entityId) => {
              const row = swipeRowsByEntityId().get(entityId);
              return row ? remindActionFor(row) !== undefined : false;
            }}
            onSwipeRight={(entityId) => {
              const row = swipeRowsByEntityId().get(entityId);
              if (!row) return;

              const action = remindActionFor(row);
              if (!action) return;

              focusActionRow(row);
              fireAndForget(action.onClick(), 'email-view');
            }}
            // Done removes the row; Remind me keeps it until a time is picked.
            triggerBehavior={{ left: 'fly-out', right: 'spring-back' }}
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

              <Match
                when={!forceEmptyState() && source.error() && !hasEmailRows()}
              >
                <div
                  ref={setEmptyViewport}
                  class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-y-auto text-sm text-ink-muted touch:pt-(--mobile-content-inset-top) touch:pb-(--mobile-content-inset-bottom)"
                >
                  <span>Email couldn’t be loaded.</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      fireAndForget(source.refresh(), 'email-view')
                    }
                  >
                    Try again
                  </Button>
                </div>
              </Match>

              <Match when={forceEmptyState() || rows().length === 0}>
                {/* EmptyStatePanel owns the top inset below the mobile chrome. */}
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
                                      onFilterByTag={filterByTag}
                                      scheduleStatus={
                                        <Show
                                          when={source.reminderForThread?.(
                                            entityRow().entity.id
                                          )}
                                        >
                                          {(reminder) => (
                                            <EmailRowSchedule
                                              reminder={reminder()}
                                            />
                                          )}
                                        </Show>
                                      }
                                      leadingAction={
                                        <Show when={!isTouchDevice()}>
                                          <EmailStarAction
                                            starred={isFavorited(
                                              entityRow().entity
                                            )}
                                            pending={rowActionState.isPending(
                                              entityRow().id
                                            )}
                                            onFocus={() =>
                                              focusActionRow({
                                                entity: entityRow().entity,
                                                rowId: entityRow().id,
                                              })
                                            }
                                            onStar={() =>
                                              fireAndForget(
                                                runRowAction(
                                                  {
                                                    entity: entityRow().entity,
                                                    rowId: entityRow().id,
                                                  },
                                                  'favorite'
                                                ),
                                                'email-view'
                                              )
                                            }
                                          />
                                        </Show>
                                      }
                                      actions={
                                        <Show when={!isTouchDevice()}>
                                          <RowActions
                                            row={{
                                              entity: entityRow().entity,
                                              rowId: entityRow().id,
                                            }}
                                          />
                                        </Show>
                                      }
                                      checked={list.selection.isSelected(
                                        entityRow().id
                                      )}
                                      highlighted={
                                        !isTouchDevice() &&
                                        list.focus.key() === entityRow().id
                                      }
                                      current={
                                        props.pane !== undefined &&
                                        selectedThread()?.id ===
                                          entityRow().entity.id
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
                                        swipeRightColor: 'bg-accent',
                                        swipeRightRevealedComponent: (
                                          <BellIcon class="size-8 text-surface" />
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
                                      : (loadMore().label ?? 'Load More')}
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
