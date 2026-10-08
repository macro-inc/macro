import { Gantt } from '@app/components/gantt/gantt';
import type { GanttCreation } from '@app/components/gantt/gantt-create-area';
import { deriveGanttRange } from '@app/components/gantt/gantt-date';
import {
  getPropertyOptionLabel,
  getTaskStatusOptionId,
  type TaskEntityWithProperties,
} from '@entity';
import CaretRightIcon from '@phosphor/caret-right.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import { PropertyValueIcon } from '@property/component/propertyValue';
import { Button, cn } from '@ui';
import {
  type Accessor,
  createMemo,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { taskGanttDates } from '../queries/task-gantt';
import type {
  TasksDataSource,
  TasksDataSourceItem,
} from '../queries/use-tasks-query';
import type { TaskGroupBy } from '../types';

function AssigneeLabel(props: {
  id: string;
  createName: (id: Accessor<string>) => Accessor<string>;
}) {
  const name = props.createName(() => props.id);
  return <>{name()}</>;
}

export function TaskGanttView(props: {
  createAssigneeName: (id: Accessor<string>) => Accessor<string>;
  source: TasksDataSource;
  groupBy: TaskGroupBy;
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
  const loadMore = (row: TasksDataSourceItem) => {
    if (row.kind !== 'load-more') return;

    if (row.groupId !== undefined) {
      void props.source.loadMoreGroup(row.groupId);
      return;
    }

    void props.source.loadMore?.();
  };

  return (
    <div ref={props.ref} class="flex size-full min-h-0 min-w-0 flex-col">
      <Switch>
        <Match when={props.source.isLoading?.()}>
          <div class="grid flex-1 place-items-center text-ink-muted">
            <SpinnerIcon
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
            <Button onClick={() => void props.source.refresh?.()}>
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
          <Gantt.Root range={range()}>
            <Gantt.Chart>
              <Gantt.Header>
                <Gantt.TodayButton />
                <Gantt.Settings />
              </Gantt.Header>
              <Gantt.Rows
                items={props.source.items()}
                getKey={(row) => row.id}
                virtualize
              >
                {(row) => (
                  <Gantt.Row>
                    <Switch>
                      <Match when={row.kind === 'entity' ? row : undefined}>
                        {(item) =>
                          props.renderEntity(
                            () => item().entity,
                            <Gantt.Label>
                              <button
                                type="button"
                                class="flex size-full min-w-0 items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                title={item().entity.name}
                                onClick={(event) =>
                                  props.onOpen(item().entity, event)
                                }
                              >
                                <PropertyValueIcon
                                  optionId={
                                    getTaskStatusOptionId(item().entity) ?? ''
                                  }
                                  class="size-4 shrink-0"
                                />
                                <span class="min-w-0 flex-1">
                                  <span class="block truncate">
                                    {item().entity.name}
                                  </span>
                                  <Gantt.DateHint
                                    {...taskGanttDates(item().entity)}
                                  />
                                </span>
                              </button>
                            </Gantt.Label>
                          )
                        }
                      </Match>
                      <Match
                        when={row.kind === 'group-header' ? row : undefined}
                      >
                        {(group) => (
                          <Gantt.Label>
                            <button
                              type="button"
                              aria-expanded={props.isGroupExpanded(
                                group().groupId
                              )}
                              class="flex size-full min-w-0 items-center gap-2 text-left font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent"
                              onClick={() =>
                                props.onToggleGroup(group().groupId)
                              }
                            >
                              <CaretRightIcon
                                class={cn(
                                  'size-3.5 shrink-0 transition-transform',
                                  props.isGroupExpanded(group().groupId) &&
                                    'rotate-90'
                                )}
                              />
                              <span class="truncate">
                                <Show
                                  when={
                                    props.groupBy === 'assignee' &&
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
                                  <AssigneeLabel
                                    id={group().groupId}
                                    createName={props.createAssigneeName}
                                  />
                                </Show>
                              </span>
                              <Show when={group().count !== undefined}>
                                <span class="ml-auto text-xs text-ink-muted">
                                  {group().count}
                                </span>
                              </Show>
                            </button>
                          </Gantt.Label>
                        )}
                      </Match>
                      <Match when={row.kind === 'load-more' ? row : undefined}>
                        {(more) => (
                          <Gantt.Label>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={more().isLoading}
                              onClick={() => loadMore(more())}
                            >
                              {more().isLoading
                                ? 'Loading…'
                                : 'Load more tasks'}
                            </Button>
                          </Gantt.Label>
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
              <Gantt.TodayMarker />
              <Gantt.CreateArea
                minDate={new Date()}
                onCreate={props.onCreate}
              />
            </Gantt.Chart>
          </Gantt.Root>
          <Show when={props.source.hasMore?.() && !hasGlobalLoadMoreRow()}>
            <div class="flex shrink-0 justify-center border-t border-edge-muted p-2">
              <Button
                size="sm"
                disabled={props.source.isLoadingMore?.()}
                onClick={() => void props.source.loadMore?.()}
              >
                {props.source.isLoadingMore?.()
                  ? 'Loading…'
                  : 'Load more tasks'}
              </Button>
            </div>
          </Show>
        </Match>
      </Switch>
    </div>
  );
}
