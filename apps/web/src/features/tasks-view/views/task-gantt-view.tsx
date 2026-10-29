import type { GanttCreation } from '@app/components/gantt/create-gantt-creation';
import { Gantt } from '@app/components/gantt/gantt';
import { deriveGanttRange } from '@app/components/gantt/gantt-date';
import type { SoupLoadMoreRow } from '@app/features/soup';
import { useInfiniteScrollSentinel } from '@app/lib/primitives/infinite-scroll-sentinel';
import { UserIcon } from '@core/component/UserIcon';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  getPropertyOptionLabel,
  getTaskStatusOptionId,
  type TaskEntityWithProperties,
} from '@entity';
import CalendarIcon from '@icon/system/regular/calendar-blank.svg';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import CircleDashedIcon from '@icon/system/regular/circle-dashed.svg';
import SpinnerIcon from '@icon/system/regular/spinner.svg';
import ProjectIcon from '@icon/system/regular/stack.svg';
import { PropertyValueIcon } from '@property/component/propertyValue';
import { Button, cn, Layer } from '@ui';
import type { ComponentProps } from 'solid-js';
import {
  type Accessor,
  createMemo,
  createSignal,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { STATUS_GROUP_HEADER_TINTS } from '../components/task-list/TaskGroupHeader';
import { taskGanttDates } from '../queries/task-gantt';
import type { TasksDataSource } from '../queries/use-tasks-query';
import type { TaskGroupBy } from '../types';

function EntityGroupLabel(props: {
  id: string;
  createName: (id: Accessor<string>) => Accessor<string>;
}) {
  const name = props.createName(() => props.id);
  return <>{name()}</>;
}

/** Requests the next page while near the visible rows; a failure waits for Retry. */
function GanttContinuation(props: {
  isLoading: boolean;
  failed: boolean;
  onLoad: () => void;
}) {
  const [sentinel, setSentinel] = createSignal<HTMLDivElement>();
  useInfiniteScrollSentinel({
    sentinel,
    hasNextPage: () => !props.failed,
    isFetchingNextPage: () => props.isLoading,
    fetchNextPage: () => props.onLoad(),
  });
  const status = () => (
    <Show
      when={props.failed}
      fallback={
        <span class="flex items-center gap-1.5 px-2 text-ink-muted">
          <SpinnerIcon class="size-3 animate-spin" />
          Loading tasks…
        </span>
      }
    >
      <Button size="sm" variant="ghost" onClick={() => props.onLoad()}>
        Retry loading tasks
      </Button>
    </Show>
  );

  return (
    <>
      {/* The label drawer can be hidden; this wrapper always spans the row. */}
      <div ref={setSentinel} class="absolute inset-0">
        <Gantt.Label>{status()}</Gantt.Label>
      </div>
      <Gantt.Pagination>{status()}</Gantt.Pagination>
    </>
  );
}

export function TaskGanttView(props: {
  createAssigneeName: (id: Accessor<string>) => Accessor<string>;
  createProjectName: (id: Accessor<string>) => Accessor<string>;
  source: TasksDataSource;
  groupBy: TaskGroupBy;
  groupMoves: Omit<ComponentProps<typeof Gantt.GroupDrag>, 'children'>;
  isGroupExpanded: (id: string) => boolean;
  onToggleGroup: (id: string) => void;
  onOpen: (task: TaskEntityWithProperties, event: MouseEvent) => void;
  onCreate?: (dates: GanttCreation) => void;
  renderEntity: (
    task: Accessor<TaskEntityWithProperties>,
    label: JSX.Element
  ) => JSX.Element;
  ref?: (element: HTMLDivElement) => void;
}) {
  const dates = createMemo(() =>
    (props.source.boardRows ?? props.source.items)().flatMap((row) =>
      row.kind === 'entity' ? [taskGanttDates(row.entity)] : []
    )
  );
  const range = createMemo(() => deriveGanttRange(dates()));
  const error = () => props.source.error?.();
  const hasGlobalLoadMoreRow = () =>
    props.source
      .items()
      .some((row) => row.kind === 'load-more' && row.groupId === undefined);
  const loadMore = (row: SoupLoadMoreRow) => {
    if (row.groupId !== undefined) {
      fireAndForget(props.source.loadMoreGroup(row.groupId), 'tasks-view');
      return;
    }

    fireAndForget(props.source.loadMore?.(), 'tasks-view');
  };
  const loadMoreFailed = (row: SoupLoadMoreRow) =>
    Boolean(
      row.groupId === undefined
        ? error()
        : props.source.groupError?.(row.groupId)
    );

  return (
    <div ref={props.ref} class="flex size-full min-h-0 min-w-0 flex-col">
      <Switch>
        <Match when={props.source.isLoading?.()}>
          <div class="grid flex-1 place-items-center text-ink-muted">
            <SpinnerIcon
              aria-hidden={false}
              aria-label="Loading timeline"
              class="size-5 animate-spin"
            />
          </div>
        </Match>
        <Match when={error() && !props.source.items().length}>
          <div
            role="alert"
            class="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-ink-muted"
          >
            Tasks couldn’t be loaded.
            <Button
              variant="ghost"
              onClick={() =>
                fireAndForget(props.source.refresh?.(), 'tasks-view')
              }
            >
              Try again
            </Button>
          </div>
        </Match>
        <Match when={!props.source.items().length && !props.onCreate}>
          <div class="grid flex-1 place-items-center text-sm text-ink-muted">
            No matching tasks
          </div>
        </Match>
        <Match when={true}>
          <Show when={error()}>
            <p role="status" class="px-3 py-2 text-xs text-ink-muted">
              Could not refresh tasks. Showing the last loaded timeline.
            </p>
          </Show>
          <Gantt.Root range={range()} labelWidth={0}>
            <Gantt.SidebarToggle />
            <Gantt.Controls>
              <Gantt.TodayButton />
              <Gantt.Settings />
            </Gantt.Controls>
            <Gantt.GroupDrag {...props.groupMoves}>
              <Gantt.Chart>
                <Gantt.Header />
                <Gantt.Rows
                  items={props.source.items()}
                  getKey={(row) => row.id}
                  getPanelKey={(row) =>
                    row.kind === 'entity' || row.kind === 'load-more'
                      ? (row.groupId ?? '')
                      : undefined
                  }
                  virtualize
                  renderDropPreview={(move) => {
                    const task = (
                      props.source.boardRows ?? props.source.items
                    )().find(
                      (row) =>
                        row.kind === 'entity' && row.entity.id === move.id
                    );
                    return (
                      task?.kind === 'entity' && (
                        <Gantt.DropPreview
                          {...taskGanttDates(task.entity)}
                          title={task.entity.name}
                        />
                      )
                    );
                  }}
                >
                  {(row) => (
                    <Gantt.Row>
                      <Show
                        when={
                          row.kind !== 'section-header' &&
                          row.groupId !== undefined
                        }
                      >
                        <Gantt.GroupDrop
                          id={row.id}
                          groupId={'groupId' in row ? (row.groupId ?? '') : ''}
                        />
                      </Show>
                      <Switch>
                        <Match when={row.kind === 'entity' ? row : undefined}>
                          {(item) => (
                            <Gantt.DragItem
                              id={item().entity.id}
                              key={item().id}
                              groupId={item().groupId ?? ''}
                              label={item().entity.name}
                            >
                              {props.renderEntity(
                                () => item().entity,
                                <Gantt.Label>
                                  <Layer depth={2}>
                                    <button
                                      type="button"
                                      class="flex h-7 w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-md px-2 text-left text-xs outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                                      title={item().entity.name}
                                      onClick={(event) =>
                                        props.onOpen(item().entity, event)
                                      }
                                    >
                                      <PropertyValueIcon
                                        optionId={
                                          getTaskStatusOptionId(
                                            item().entity
                                          ) ?? ''
                                        }
                                        class="size-3.5 shrink-0"
                                      />
                                      <span class="min-w-0 flex-1 leading-3.5">
                                        <span class="block truncate">
                                          {item().entity.name}
                                        </span>
                                        <Gantt.DateHint
                                          {...taskGanttDates(item().entity)}
                                          class="leading-3"
                                        />
                                      </span>
                                    </button>
                                  </Layer>
                                </Gantt.Label>
                              )}
                            </Gantt.DragItem>
                          )}
                        </Match>
                        <Match
                          when={row.kind === 'group-header' ? row : undefined}
                        >
                          {(group) => (
                            <Gantt.GroupHeader
                              class={
                                props.groupBy === 'status'
                                  ? STATUS_GROUP_HEADER_TINTS[group().groupId]
                                  : undefined
                              }
                            >
                              <button
                                type="button"
                                aria-expanded={props.isGroupExpanded(
                                  group().groupId
                                )}
                                class="flex h-full w-full min-w-0 items-center gap-2.5 rounded-[inherit] px-2 py-1.5 text-left text-xs font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                                onClick={() =>
                                  props.onToggleGroup(group().groupId)
                                }
                              >
                                <Layer depth={3}>
                                  <span class="flex size-4.5 shrink-0 items-center justify-center rounded-xs group-hover/header:bg-ink/5">
                                    <CaretRightIcon
                                      class={cn(
                                        'size-2.5 transition-transform',
                                        props.isGroupExpanded(
                                          group().groupId
                                        ) && 'rotate-90'
                                      )}
                                    />
                                  </span>
                                </Layer>
                                <Switch>
                                  <Match when={!group().groupId}>
                                    <CircleDashedIcon class="size-3.5 shrink-0 text-ink-extra-muted" />
                                  </Match>
                                  <Match
                                    when={
                                      props.groupBy === 'status' ||
                                      props.groupBy === 'priority'
                                    }
                                  >
                                    <PropertyValueIcon
                                      optionId={group().groupId}
                                      class="size-3.5 shrink-0"
                                    />
                                  </Match>
                                  <Match when={props.groupBy === 'assignee'}>
                                    <UserIcon
                                      id={group().groupId}
                                      size="sm"
                                      suppressClick
                                      showTooltip={false}
                                    />
                                  </Match>
                                  <Match when={props.groupBy === 'project'}>
                                    <ProjectIcon class="size-3.5 shrink-0" />
                                  </Match>
                                  <Match when={props.groupBy === 'date'}>
                                    <CalendarIcon class="size-3.5 shrink-0" />
                                  </Match>
                                </Switch>
                                <span class="truncate">
                                  <Show
                                    when={
                                      (props.groupBy === 'assignee' ||
                                        props.groupBy === 'project') &&
                                      group().groupId
                                    }
                                    fallback={
                                      props.groupBy === 'status' ||
                                      props.groupBy === 'priority'
                                        ? (getPropertyOptionLabel(
                                            group().groupId
                                          ) ?? group().label)
                                        : group().label
                                    }
                                  >
                                    <EntityGroupLabel
                                      id={group().groupId}
                                      createName={
                                        props.groupBy === 'project'
                                          ? props.createProjectName
                                          : props.createAssigneeName
                                      }
                                    />
                                  </Show>
                                </span>
                                <Show when={group().count !== undefined}>
                                  <span class="shrink-0 rounded-full bg-ink/10 px-1.5 py-px text-xs font-medium tabular-nums text-ink-extra-muted">
                                    {group().count}
                                  </span>
                                </Show>
                              </button>
                            </Gantt.GroupHeader>
                          )}
                        </Match>
                        <Match
                          when={row.kind === 'load-more' ? row : undefined}
                        >
                          {(more) => (
                            <GanttContinuation
                              isLoading={more().isLoading ?? false}
                              failed={loadMoreFailed(more())}
                              onLoad={() => loadMore(more())}
                            />
                          )}
                        </Match>
                        <Match
                          when={row.kind === 'section-header' ? row : undefined}
                        >
                          {(section) => (
                            <Gantt.Label>{section().label}</Gantt.Label>
                          )}
                        </Match>
                      </Switch>
                    </Gantt.Row>
                  )}
                </Gantt.Rows>
                <Show
                  when={props.source.hasMore?.() && !hasGlobalLoadMoreRow()}
                >
                  <Gantt.Row>
                    <GanttContinuation
                      isLoading={props.source.isLoadingMore?.() ?? false}
                      failed={Boolean(error())}
                      onLoad={() =>
                        fireAndForget(props.source.loadMore?.(), 'tasks-view')
                      }
                    />
                  </Gantt.Row>
                </Show>
                <Gantt.TodayMarker />
                <Gantt.CreateArea
                  minDate={new Date()}
                  onCreate={props.onCreate}
                />
              </Gantt.Chart>
            </Gantt.GroupDrag>
            <Gantt.ZoomControls />
          </Gantt.Root>
        </Match>
      </Switch>
    </div>
  );
}
