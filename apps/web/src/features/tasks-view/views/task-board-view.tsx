import { Button } from '@ui/components/Button';
import { type Accessor, createSignal, Show } from 'solid-js';
import { TaskBoard, type TaskBoardProps } from '../components/task-board';
import type { TaskBoardData } from '../context/task-board';
import type { TaskBoardGrouping, TaskBoardTask } from '../core/task-board';
import { createTaskBoard } from '../primitives/create-task-board';

export function TaskBoardView(props: {
  data: TaskBoardData;
  grouping: Accessor<TaskBoardGrouping>;
  scope: Accessor<string>;
  sortLabel: Accessor<string>;
  loading: Accessor<boolean>;
  error: Accessor<unknown>;
  hasMore: Accessor<boolean>;
  loadingMore: Accessor<boolean>;
  loadMore(columnId?: string): Promise<void>;
  refresh(): Promise<void>;
  onOpen(task: TaskBoardTask, event: MouseEvent): void;
  onRevealHiddenColumns(): void;
  ref?: (element: HTMLDivElement) => void;
  renderColumnIcon?: TaskBoardProps['renderColumnIcon'];
  renderLeadingTitleProperty?: TaskBoardProps['renderLeadingTitleProperty'];
  renderTitleProperty?: TaskBoardProps['renderTitleProperty'];
  renderProperties?: TaskBoardProps['renderProperties'];
}) {
  const board = createTaskBoard({
    grouping: props.grouping,
    scope: props.scope,
    columns: props.data.columns,
    task: props.data.task,
    actions: props.data.actions,
    compareTasks: props.data.compareTasks,
  });
  const [readError, setReadError] = createSignal<string>();

  const read = async (operation: () => Promise<void>) => {
    setReadError(undefined);

    try {
      await operation();
    } catch {
      setReadError('Could not load tasks. Try again.');
    }
  };

  return (
    <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <Show when={props.loading()}>
        <p role="status" class="p-4 text-sm text-ink-muted">
          Loading tasks…
        </p>
      </Show>
      <Show when={props.error() || readError()}>
        <div
          role="alert"
          class="flex items-center gap-2 px-4 py-2 text-sm text-failure"
        >
          Could not load all tasks.
          <Button size="sm" onClick={() => void read(props.refresh)}>
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
      <TaskBoard
        ref={props.ref}
        animationScope={props.scope()}
        columns={board.columns()}
        sortLabel={props.sortLabel()}
        hiddenColumnCount={props.data.hiddenColumnCount()}
        hiddenColumnCountIsPartial={
          props.grouping() === 'assignee' || props.grouping() === 'project'
        }
        onRevealHiddenColumns={props.onRevealHiddenColumns}
        canEdit={props.data.actions.canEditTask}
        canMove={board.canMove}
        pending={board.pending}
        onMove={board.move}
        onOpen={props.onOpen}
        onLoadMore={(id) => void read(() => props.loadMore(id))}
        renderColumnIcon={props.renderColumnIcon}
        renderLeadingTitleProperty={props.renderLeadingTitleProperty}
        renderTitleProperty={props.renderTitleProperty}
        renderProperties={props.renderProperties}
      />
      <Show when={props.hasMore()}>
        <div class="p-3">
          <Button
            size="sm"
            disabled={props.loadingMore()}
            onClick={() => void read(() => props.loadMore())}
          >
            {props.loadingMore() ? 'Loading…' : 'Load more tasks'}
          </Button>
        </div>
      </Show>
    </div>
  );
}
