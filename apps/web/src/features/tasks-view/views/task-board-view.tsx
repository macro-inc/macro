import { toast } from '@core/component/Toast/Toast';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import { hasValue } from '@property/utils/typeGuards';
import { Button } from '@ui/components/Button';
import { type Accessor, createSignal, For, Show, Suspense } from 'solid-js';
import { TaskBoard } from '../components/task-board';
import {
  TaskBoardColumnIcon,
  TaskBoardProperty,
} from '../components/task-board-property';
import { TASK_SORT_OPTIONS } from '../constants';
import type { TaskBoardData } from '../context/task-board';
import {
  type TaskBoardColumn,
  type TaskBoardGrouping,
  type TaskBoardTask,
  toTaskBoardGrouping,
} from '../core/task-board';
import { createTaskBoard } from '../primitives/create-task-board';
import { taskBoardFacetId, taskBoardPropertyId } from '../queries/task-board';
import { useTasksView } from '../tasks-view-context';

const CARD_PROPERTY_IDS = [
  SYSTEM_PROPERTY_IDS.PRIORITY,
  SYSTEM_PROPERTY_IDS.DUE_DATE,
  SYSTEM_PROPERTY_IDS.PROJECT,
];

export function TaskBoardView(props: {
  data: TaskBoardData;
  onOpen(task: TaskBoardTask, event: MouseEvent): void;
  ref?: (element: HTMLDivElement) => void;
}) {
  const { state, source, projectsEnabled, setFacets } = useTasksView();
  const grouping = () => toTaskBoardGrouping(state.groupBy);
  const scope = () =>
    JSON.stringify([
      state.tab,
      grouping(),
      state.search,
      state.facets,
      state.sort,
    ]);
  const board = createTaskBoard({
    grouping,
    scope,
    columns: props.data.columns,
    task: props.data.task,
    actions: props.data.actions,
    compareTasks: props.data.compareTasks,
  });
  const [readError, setReadError] = createSignal<string>();
  const loading = source.boardLoading ?? source.isLoading;
  const sortLabel = () =>
    TASK_SORT_OPTIONS.find(
      (option) => option.id === (state.sort[0]?.id ?? 'updated_at')
    )?.label ?? 'Updated';
  const cardPropertyIds = () =>
    CARD_PROPERTY_IDS.filter((id) => {
      if (id === taskBoardPropertyId(grouping())) {
        return false;
      }

      return id !== SYSTEM_PROPERTY_IDS.PROJECT || projectsEnabled();
    });

  const revealHiddenColumns = () => {
    const facets = { ...state.facets };
    delete facets[taskBoardFacetId(grouping())];
    setFacets(facets);
  };

  const read = async (operation: () => Promise<void>) => {
    setReadError(undefined);

    try {
      await operation();
    } catch {
      setReadError('Could not load tasks. Try again.');
    }
  };

  const loadMore = async (columnId?: string) => {
    if (columnId === undefined) {
      await source.loadMore();
      const error = source.error();

      if (error) {
        throw error;
      }

      return;
    }

    await source.loadMoreGroup(columnId);
    const error = source.groupError?.(columnId);

    if (error) {
      throw error;
    }
  };

  const renderProperty = (
    task: Accessor<TaskBoardTask>,
    readOnly: Accessor<boolean>,
    id: string,
    iconOnly: boolean,
    includeEmpty = true
  ) => (
    <Show when={props.data.property(task().id, id)}>
      {(property) => (
        <Show when={includeEmpty || hasValue(property())}>
          <Suspense fallback={<span class="size-6" />}>
            <TaskBoardProperty
              property={property()}
              taskId={task().id}
              canEdit={!readOnly() && props.data.canEditProperty(task().id, id)}
              iconOnly={iconOnly}
              onSave={async (value, apiValues) => {
                try {
                  if (readOnly()) {
                    throw new Error('Task is no longer editable');
                  }

                  await props.data.saveProperty(task().id, value, apiValues);
                } catch (error) {
                  toast.failure(
                    `Could not update ${value.displayName.toLowerCase()}`
                  );
                  throw error;
                }
              }}
            />
          </Suspense>
        </Show>
      )}
    </Show>
  );

  const renderCard = (
    task: Accessor<TaskBoardTask>,
    readOnly: Accessor<boolean>
  ) => (
    <>
      <div class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 p-3 pb-2">
        <div data-kanban-no-drag class="flex shrink-0 items-center">
          {renderProperty(task, readOnly, SYSTEM_PROPERTY_IDS.STATUS, true)}
        </div>
        <button
          type="button"
          class="min-w-0 break-words text-left text-sm font-medium leading-6 text-ink hover:underline"
          onClick={(event) => {
            if (event.detail > 1) {
              return;
            }

            props.onOpen(task(), event);
          }}
        >
          {task().name || 'Untitled task'}
        </button>
        <div data-kanban-no-drag class="flex shrink-0 items-center">
          {renderProperty(task, readOnly, SYSTEM_PROPERTY_IDS.ASSIGNEES, true)}
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-1 px-3 pb-3 text-xs text-ink-muted">
        <div data-kanban-no-drag class="contents">
          <For each={cardPropertyIds()}>
            {(id) => {
              const iconOnly = id === SYSTEM_PROPERTY_IDS.PRIORITY;
              const includeEmpty = id === SYSTEM_PROPERTY_IDS.PRIORITY;

              return renderProperty(task, readOnly, id, iconOnly, includeEmpty);
            }}
          </For>
        </div>
      </div>
    </>
  );

  return (
    <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <Show when={loading()}>
        <p role="status" class="p-4 text-sm text-ink-muted">
          Loading tasks…
        </p>
      </Show>
      <Show when={source.error() || readError()}>
        <div
          role="alert"
          class="flex items-center gap-2 px-4 py-2 text-sm text-failure"
        >
          Could not load all tasks.
          <Button size="sm" onClick={() => void read(source.refresh)}>
            Retry
          </Button>
        </div>
      </Show>
      <Show when={props.data.definitionError()}>
        <div role="alert" class="px-4 py-2 text-sm text-failure">
          Could not load task properties. Moving tasks is unavailable.
          <Button
            size="sm"
            onClick={() => void read(props.data.retryDefinitions)}
          >
            Retry
          </Button>
        </div>
      </Show>
      <Show when={board.error()}>
        {(error) => (
          <p role="alert" class="px-4 py-2 text-sm text-ink-muted">
            {error()}
          </p>
        )}
      </Show>
      <TaskBoard.Root
        ref={props.ref}
        animationScope={scope()}
        columns={board.columns()}
        canMove={board.canMove}
        onMove={board.move}
      >
        <TaskBoard.Columns
          endColumn={
            props.data.hiddenColumnCount() > 0
              ? () => (
                  <TaskBoard.HiddenColumns
                    count={props.data.hiddenColumnCount()}
                    partial={
                      grouping() === 'assignee' || grouping() === 'project'
                    }
                    onReveal={revealHiddenColumns}
                  />
                )
              : undefined
          }
        >
          {(column) => (
            <TaskBoard.Column>
              <TaskBoard.Header>
                <TaskBoardColumnHeader
                  column={column()}
                  grouping={grouping()}
                  createAssigneeName={props.data.createAssigneeName}
                />
              </TaskBoard.Header>
              <TaskBoard.DropOverlay>
                Board sorted by {sortLabel()}
              </TaskBoard.DropOverlay>
              <TaskBoard.Cards
                empty={
                  <p class="px-2 py-6 text-center text-xs text-ink-extra-muted">
                    No matching tasks
                  </p>
                }
                footer={
                  <Show when={column().hasMore}>
                    <div class="py-3">
                      <Button
                        size="sm"
                        disabled={column().loadingMore}
                        onClick={() => void read(() => loadMore(column().id))}
                      >
                        {column().loadingMore ? 'Loading…' : 'Load more tasks'}
                      </Button>
                    </div>
                  </Show>
                }
              >
                {(task) => {
                  const readOnly = () =>
                    !props.data.actions.canEditTask(task().id) ||
                    board.pending(task().id);

                  return (
                    <TaskBoard.Card
                      task={task()}
                      canDrag={!readOnly()}
                      pending={board.pending(task().id)}
                      onOpen={props.onOpen}
                    >
                      {renderCard(task, readOnly)}
                    </TaskBoard.Card>
                  );
                }}
              </TaskBoard.Cards>
            </TaskBoard.Column>
          )}
        </TaskBoard.Columns>
      </TaskBoard.Root>
      <Show when={source.hasMore()}>
        <div class="p-3">
          <Button
            size="sm"
            disabled={source.isLoadingMore()}
            onClick={() => void read(() => loadMore())}
          >
            {source.isLoadingMore() ? 'Loading…' : 'Load more tasks'}
          </Button>
        </div>
      </Show>
    </div>
  );
}

function TaskBoardColumnHeader(props: {
  column: TaskBoardColumn;
  grouping: TaskBoardGrouping;
  createAssigneeName: TaskBoardData['createAssigneeName'];
}) {
  const label = () => (
    <h2 class="truncate text-sm font-medium" title={props.column.label}>
      {props.column.label}
    </h2>
  );
  const countLabel = () => {
    const loaded = props.column.tasks.length;

    if (props.column.count === undefined) {
      return `${loaded} loaded tasks`;
    }

    return `${loaded} loaded of ${props.column.count} tasks`;
  };

  return (
    <>
      <span
        class="flex size-4 shrink-0 items-center justify-center"
        aria-hidden="true"
      >
        <Suspense>
          <TaskBoardColumnIcon grouping={props.grouping} id={props.column.id} />
        </Suspense>
      </span>
      <Show
        when={props.grouping === 'assignee' && props.column.id}
        fallback={label()}
      >
        <Suspense fallback={label()}>
          <AssigneeColumnLabel
            id={props.column.id}
            fallback={props.column.label}
            createAssigneeName={props.createAssigneeName}
          />
        </Suspense>
      </Show>
      <span
        class="ml-auto shrink-0 text-xs text-ink-muted"
        aria-label={countLabel()}
      >
        {props.column.count ?? props.column.tasks.length}
      </span>
    </>
  );
}

function AssigneeColumnLabel(props: {
  id: string;
  fallback: string;
  createAssigneeName: TaskBoardData['createAssigneeName'];
}) {
  const resolvedName = props.createAssigneeName(() => props.id);
  const name = () => resolvedName() || props.fallback;

  return (
    <h2 class="truncate text-sm font-medium" title={name()}>
      {name()}
    </h2>
  );
}
