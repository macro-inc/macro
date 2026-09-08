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
import { openEntityInSplitFromUnifiedList } from '@app/features/next-soup/utils';
import {
  MaybeSoupEntityActionDrawerManager,
  SoupEntityContextMenu,
  useSoupListNavigationHotkeys,
} from '@app/features/soup';
import { makePersistedState } from '@app/lib/persistence';
import {
  addUnique,
  removeValue,
  toggleValue,
} from '@app/lib/signals/store-array-updaters';
import { SwipableRowProvider } from '@components/app/mobile/SwipableRow';
import {
  useSplitPanelOrThrow,
  withSplitPanelOwner,
} from '@components/app/split-layout/layoutUtils';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import {
  type EntityData,
  EntitySelectionToolbar,
  getTaskStatusOptionId,
  ListLayoutProvider,
  type TaskEntityWithProperties,
} from '@entity';
import { useListLayout } from '@entity/composed/list-entity/shared';
import { soupPropertyToProperty } from '@entity/extractors-property';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import { PROPERTY_OPTION_IDS, SYSTEM_PROPERTY_IDS } from '@property';
import { useBulkSaveEntityPropertiesMutation } from '@queries/properties/entity';
import { useTagsQuery } from '@queries/properties/tags';
import { EntityType } from '@service-properties/generated/schemas/entityType';
import { Button, cn, Surface } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  Match,
  type Setter,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import { Virtualizer, type VirtualizerHandle } from 'virtua/solid';
import {
  createTasksListEntryStorage,
  DEFAULT_TASKS_LIST_STATE,
  type TasksListStateSnapshot,
} from '../../persistence';
import {
  type TasksDataSourceItem,
  useTasksDataSource,
} from '../../queries/use-tasks-query';
import { useTasksView } from '../../tasks-view-context';
import { TaskGroupHeader } from './TaskGroupHeader';
import { TaskListEntity } from './TaskListEntity';
import { TaskListHeader } from './TaskListHeader';
import './task-list.css';

function ResponsiveTaskListHeader() {
  const layout = useListLayout();

  return (
    <Show when={(layout?.isWide() ?? true) && !isTouchDevice()}>
      <TaskListHeader />
    </Show>
  );
}

const getStatusProperty = (task: TaskEntityWithProperties) => {
  const status = task.properties?.find(
    (property) => property.definition.id === SYSTEM_PROPERTY_IDS.STATUS
  );
  if (!status) return undefined;
  try {
    return soupPropertyToProperty(status);
  } catch {
    return undefined;
  }
};

type TasksListActivationMetadata = {
  event?: MouseEvent;
  newSplit?: boolean;
};

export function TaskList() {
  const panel = useSplitPanelOrThrow();
  const { state, setState } = useTasksView();
  const userId = useUserId();
  const isGroupExpanded = (groupId: string) =>
    !state.collapsedGroupIds.includes(groupId);
  const setGroupExpanded = (groupId: string, expanded: boolean) =>
    setState(
      'collapsedGroupIds',
      expanded ? removeValue(groupId) : addUnique(groupId)
    );
  const toggleGroup = (groupId: string) =>
    setState('collapsedGroupIds', toggleValue(groupId));

  const source = withSplitPanelOwner(listOwnedSlotName('data-source'), () => {
    const tagsQuery = useTagsQuery();

    return useTasksDataSource(state, {
      userId,
      tagSets: () => tagsQuery.data ?? [],
      isGroupExpanded,
    });
  });

  function openEntity(
    entity: EntityData,
    options: {
      openInNewSplit?: boolean;
      replacePreview?: boolean;
      mergeHistory?: boolean;
    } = {}
  ) {
    void openEntityInSplitFromUnifiedList(entity, {
      splitHandle: panel.handle,
      referredFrom: 'tasks',
      ...options,
    });
  }

  function onActivate({
    item,
    metadata,
  }: ListActivation<TasksDataSourceItem, TasksListActivationMetadata>) {
    if (item.kind === 'group-header') {
      toggleGroup(item.groupId);

      return;
    }

    if (item.kind === 'load-more' && item.groupId !== undefined) {
      const focusIndex = list.items.indexOf(item.id);
      void source.loadMoreGroup(item.groupId).then(() => {
        if (list.focus.requestedKey() !== item.id) return;

        list.focus.restore(item.id, {
          fallback: 'nearest',
          nearestIndex: focusIndex,
          retainUnavailable: false,
        });
      });

      return;
    }

    if (item.kind !== 'entity') return;

    const sourceRow = source
      .items()
      .find((row) => row.kind === 'entity' && row.id === item.id);

    if (sourceRow?.kind !== 'entity') return;

    const newSplit =
      metadata?.newSplit === true || metadata?.event?.shiftKey === true;

    openEntity(sourceRow.entity, {
      openInNewSplit: newSplit,
      replacePreview: metadata?.event?.altKey === true && !newSplit,
    });
  }

  const list = withSplitPanelOwner(listOwnedSlotName('controller'), () =>
    createListController<TasksDataSourceItem, TasksListActivationMetadata>({
      items: source.items,
      getKey: (row) => row.id,
      selection: {
        getKey: (row) => (row.kind === 'entity' ? row.entity.id : row.id),
      },
      isNavigable: (row) => row.kind !== 'section-header',
      isSelectable: (row) => row.kind === 'entity',
      onActivate,
    })
  );

  withSplitPanelOwner(listOwnedSlotName('navigation-hotkeys'), () => {
    useSoupListNavigationHotkeys({
      splitHotkeyScope: panel.splitHotkeyScope,
      viewId: 'tasks',
      dataSource: source,
      controller: list,
      handle: panel.handle,
      openEntityInSplit: (task, options) => {
        openEntity(task, {
          mergeHistory: options.mergeHistory,
        });
      },
    });
  });

  const entityActionViewContext = () =>
    resolveEntityActionViewContext({
      activeListView: panel.handle.content().id,
      activeTab: state.tab,
    });
  const [viewport, setViewport] = createSignal<HTMLDivElement>();
  const [grid, setGrid] = createSignal<HTMLDivElement>();
  const [virtualizer, setVirtualizer] = createSignal<VirtualizerHandle>();

  let scrollOffset = DEFAULT_TASKS_LIST_STATE.scrollOffset;
  const readListState = (): TasksListStateSnapshot => ({
    focusKey: list.focus.requestedKey(),
    scrollOffset: virtualizer()?.scrollOffset ?? scrollOffset,
  });

  const applyListState: Setter<TasksListStateSnapshot> = (next) => {
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
    { storages: createTasksListEntryStorage(panel.handle) }
  );

  const visibleRows = source.items;
  const tasksById = createMemo(() => {
    const tasks = new Map<string, TaskEntityWithProperties>();
    for (const row of visibleRows()) {
      if (row.kind === 'entity') tasks.set(row.entity.id, row.entity);
    }
    return tasks;
  });
  const saveProperties = useBulkSaveEntityPropertiesMutation();
  const canCompleteTask = (taskId: string) => {
    const task = tasksById().get(taskId);
    if (!task || saveProperties.isPending) return false;
    return (
      getTaskStatusOptionId(task) !== PROPERTY_OPTION_IDS.STATUS.COMPLETED &&
      getStatusProperty(task) !== undefined
    );
  };
  const completeTask = (taskId: string) => {
    const task = tasksById().get(taskId);
    if (!task) return;
    const property = getStatusProperty(task);
    if (!property) return;
    saveProperties.mutate({
      properties: [
        {
          entityId: task.id,
          entityType: EntityType.TASK,
          property,
          apiValues: {
            valueType: 'SELECT_STRING',
            values: [PROPERTY_OPTION_IDS.STATUS.COMPLETED],
          },
        },
      ],
    });
  };

  const selectedTasks = createMemo(() =>
    list.selection
      .items()
      .flatMap((row) => (row.kind === 'entity' ? [row.entity] : []))
  );

  const focusedTask = () => {
    const row = list.focus.result()?.item;
    return row?.kind === 'entity' ? row.entity : undefined;
  };

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

  const listInteractions = useListInteractions({
    controller: list,
    scopeId: panel.splitHotkeyScope,
    scrollHandle: virtualizer,
    enabled: panel.isPanelActive,
    navigation: {
      onNavigate: (event) => {
        const row = event.result?.item;
        if (row?.kind === 'entity' && panel.handle.isControllerSplit()) {
          openEntity(row.entity, {
            mergeHistory: true,
          });
        }

        if (event.kind !== 'move' || event.direction !== 1) return;
        if (source.isLoadingMore() || !source.hasMore()) {
          return;
        }

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
    disclosure: {
      getKey: (row) =>
        row.kind === 'section-header' ? undefined : row.groupId,
      isExpanded: isGroupExpanded,
      setExpanded: setGroupExpanded,
      getFocusKey: (groupId) =>
        visibleRows().find(
          (row) => row.kind === 'group-header' && row.groupId === groupId
        )?.id,
    },
  });

  useEntityActionHotkeys({
    scopeId: panel.splitHotkeyScope,
    list: actionState,
    selectedEntities: selectedTasks,
    focusedEntity: focusedTask,
    restoreFocus: () => grid()?.focus(),
    viewContext: entityActionViewContext,
    splitHandle: panel.handle,
    condition: panel.isPanelActive,
  });

  let restoredScroll = false;
  function registerVirtualizer(handle?: VirtualizerHandle) {
    setVirtualizer(handle);
    if (!handle || restoredScroll) return;

    handle.scrollTo(scrollOffset);
    restoredScroll = true;
  }

  let activeTab = state.tab;
  createEffect(() => {
    const nextTab = state.tab;
    if (nextTab === activeTab) return;

    activeTab = nextTab;
    listInteractions.selection.clear();
    list.focus.clear({ reason: 'programmatic' });
    panel.handle.resetPreview();
    setPersistedListState((current) => ({ ...current, scrollOffset: 0 }));
  });

  createEffect(() => {
    visibleRows();
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
    if (distance >= 300 || source.isLoadingMore()) return;

    void source.loadMore();
  }

  const emptyMessage = () => {
    if (state.search.trim()) return 'No tasks match this search.';

    return 'No tasks in this view.';
  };

  return (
    <MaybeSoupEntityActionDrawerManager>
      <Surface
        depth={2}
        ref={setGrid}
        role="grid"
        aria-label="Tasks"
        aria-multiselectable="true"
        aria-activedescendant={list.focus.key()}
        tabIndex={0}
        class="@container/u-list flex min-h-0 min-w-0 flex-col rounded-2xl p-2 outline-none"
      >
        <ListLayoutProvider ref={grid}>
          <ResponsiveTaskListHeader />
          <SwipableRowProvider
            container={viewport}
            canSwipeLeft={canCompleteTask}
            canSwipeRight={() => false}
            onSwipeLeft={completeTask}
            triggerBehavior="spring-back"
          >
            <Switch>
              <Match when={source.isLoading()}>
                <div class="grid min-h-0 flex-1 place-items-center text-ink-muted">
                  <SpinnerIcon class="size-5 animate-spin" />
                </div>
              </Match>

              <Match when={source.error()}>
                <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-sm text-ink-muted">
                  <span>Tasks couldn’t be loaded.</span>
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

              <Match when={visibleRows().length === 0}>
                <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-sm text-ink-muted">
                  <span>{emptyMessage()}</span>
                  <Show when={source.hasMore()}>
                    <Button
                      variant="outline"
                      size="sm"
                      class="rounded-lg"
                      disabled={source.isLoadingMore()}
                      onClick={() => void source.loadMore()}
                    >
                      <Show
                        when={source.isLoadingMore()}
                        fallback="Search more results"
                      >
                        <SpinnerIcon class="size-3 animate-spin" />
                        Searching
                      </Show>
                    </Button>
                  </Show>
                </div>
              </Match>

              <Match when={true}>
                <div
                  ref={setViewport}
                  class="min-h-0 flex-1 overflow-auto overscroll-none"
                >
                  <Suspense>
                    <Virtualizer
                      ref={registerVirtualizer}
                      data={visibleRows()}
                      scrollRef={viewport()}
                      bufferSize={240}
                      itemSize={44}
                      keepMounted={
                        list.focus.index() >= 0
                          ? [list.focus.index()]
                          : undefined
                      }
                      onScroll={checkNearEnd}
                    >
                      {(row) => (
                        <div>
                          <Switch>
                            <Match
                              when={
                                row.kind === 'group-header' ? row : undefined
                              }
                            >
                              {(group) => (
                                <TaskGroupHeader
                                  row={group()}
                                  groupBy={state.groupBy}
                                  expanded={isGroupExpanded(group().groupId)}
                                  focused={list.focus.key() === group().id}
                                  onFocus={() =>
                                    list.focus.set(group().id, {
                                      reason: 'hover',
                                    })
                                  }
                                  onToggle={() =>
                                    list.activate.key(group().id, {
                                      reason: 'pointer',
                                    })
                                  }
                                />
                              )}
                            </Match>
                            <Match when={row.kind === 'entity' && row}>
                              {(entityRow) => (
                                <SoupEntityContextMenu
                                  entity={entityRow().entity}
                                  list={actionState}
                                  selectedEntities={selectedTasks}
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
                                  <TaskListEntity
                                    rowId={entityRow().id}
                                    entity={entityRow().entity}
                                    highlighted={
                                      list.focus.key() === entityRow().id
                                    }
                                    checked={list.selection.isSelected(
                                      entityRow().id
                                    )}
                                    onMouseMove={() =>
                                      list.focus.set(entityRow().id, {
                                        reason: 'hover',
                                      })
                                    }
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
                                  />
                                </SoupEntityContextMenu>
                              )}
                            </Match>
                            <Match
                              when={
                                row.kind === 'section-header' ? row : undefined
                              }
                            >
                              {(section) => (
                                <div id={section().id} role="row">
                                  <div
                                    role="gridcell"
                                    aria-colspan={7}
                                    class="flex h-8 items-end px-3 pb-1 text-xs font-semibold text-ink-extra-muted"
                                  >
                                    {section().label}
                                  </div>
                                </div>
                              )}
                            </Match>
                            <Match
                              when={row.kind === 'load-more' ? row : undefined}
                            >
                              {(loadMore) => {
                                const highlighted = () =>
                                  list.focus.key() === loadMore().id;
                                const buttonClass = () =>
                                  cn({
                                    'bg-surface': !highlighted(),
                                    'border-transparent': highlighted(),
                                  });
                                const activate = () => {
                                  if (loadMore().isLoading) return;
                                  list.activate.key(loadMore().id, {
                                    reason: 'pointer',
                                  });
                                };

                                return (
                                  <div id={loadMore().id} role="row">
                                    <div
                                      role="gridcell"
                                      aria-colspan={7}
                                      aria-busy={loadMore().isLoading}
                                      onMouseMove={() =>
                                        list.focus.set(loadMore().id, {
                                          reason: 'hover',
                                        })
                                      }
                                      onClick={activate}
                                      class={cn(
                                        'my-1 flex min-h-9 items-center justify-center rounded',
                                        highlighted()
                                          ? 'mx-1 w-[calc(100%-0.5rem)] bg-active/60'
                                          : 'mx-auto'
                                      )}
                                    >
                                      <Show
                                        when={!loadMore().isLoading}
                                        fallback={
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            depth={2}
                                            class={buttonClass()}
                                            disabled
                                          >
                                            <SpinnerIcon class="size-3 animate-spin" />
                                            Loading...
                                          </Button>
                                        }
                                      >
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          depth={2}
                                          class={buttonClass()}
                                        >
                                          <CaretDownIcon class="size-2.5" />
                                          Load More
                                        </Button>
                                      </Show>
                                    </div>
                                  </div>
                                );
                              }}
                            </Match>
                          </Switch>
                        </div>
                      )}
                    </Virtualizer>
                  </Suspense>
                </div>
              </Match>
            </Switch>
          </SwipableRowProvider>
          <Show when={selectedTasks().length > 0}>
            <EntitySelectionToolbar
              selected={selectedTasks()}
              onClear={listInteractions.selection.clear}
              analyticsSource="tasks_view_selection_toolbar"
            />
          </Show>
        </ListLayoutProvider>
      </Surface>
    </MaybeSoupEntityActionDrawerManager>
  );
}
