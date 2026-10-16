import EmptyStateNoFilterMatchGraphic from '@design/empty-state-no-filter-match.svg';
import { Button } from '@ui/components/Button';
import {
  type Accessor,
  createContext,
  createMemo,
  type JSX,
  Show,
  useContext,
} from 'solid-js';
import { KanbanBoard } from '../../../components/kanban/kanban-board';
import type {
  TaskBoardColumn,
  TaskBoardMove,
  TaskBoardTask,
} from '../core/task-board';

const TaskColumnsContext =
  createContext<Accessor<readonly TaskBoardColumn[]>>();
const TaskColumnContext = createContext<Accessor<TaskBoardColumn>>();

/** Tasks own their entity data; the shared board owns layout and dragging. */
function Root(props: {
  columns: readonly TaskBoardColumn[];
  animationScope?: string;
  canMove(move: TaskBoardMove): boolean;
  onMove(move: TaskBoardMove): Promise<boolean>;
  ref?: (element: HTMLDivElement) => void;
  children: JSX.Element;
}) {
  const columns = createMemo(() =>
    props.columns.map((column) => ({
      id: column.id,
      label: column.label,
      itemIds: column.tasks.map((task) => task.id),
    }))
  );
  return (
    <TaskColumnsContext.Provider value={() => props.columns}>
      <KanbanBoard.Root
        mode="cross-column"
        columns={columns()}
        animationScope={props.animationScope}
        canMove={props.canMove}
        onDrop={props.onMove}
        ref={props.ref}
      >
        {props.children}
      </KanbanBoard.Root>
    </TaskColumnsContext.Provider>
  );
}

function Columns(props: {
  children(column: Accessor<TaskBoardColumn>): JSX.Element;
  endColumn?: () => JSX.Element;
  'aria-label'?: string;
}) {
  const columns = useContext(TaskColumnsContext);
  if (!columns) throw new Error('TaskBoard.Root is required');
  const columnsById = createMemo(
    () => new Map(columns().map((column) => [column.id, column]))
  );
  return (
    <KanbanBoard.Columns
      endColumn={props.endColumn}
      aria-label={props['aria-label'] ?? 'Task board'}
    >
      {(column) => (
        <Show when={columnsById().get(column().id)}>
          {(taskColumn) => (
            <TaskColumnContext.Provider value={taskColumn}>
              {props.children(taskColumn)}
            </TaskColumnContext.Provider>
          )}
        </Show>
      )}
    </KanbanBoard.Columns>
  );
}

function Cards(props: {
  children(task: Accessor<TaskBoardTask>): JSX.Element;
  empty?: JSX.Element;
  footer?: JSX.Element;
  itemsLabel?: string;
}) {
  const column = useContext(TaskColumnContext);
  if (!column) throw new Error('TaskBoard.Columns is required');
  const tasksById = createMemo(
    () => new Map(column().tasks.map((task) => [task.id, task]))
  );
  return (
    <KanbanBoard.Cards
      empty={props.empty}
      footer={props.footer}
      itemsLabel={props.itemsLabel ?? 'tasks'}
    >
      {(id) => (
        <Show when={tasksById().get(id)}>{(task) => props.children(task)}</Show>
      )}
    </KanbanBoard.Cards>
  );
}

function Card(props: {
  task: TaskBoardTask;
  canDrag: boolean;
  pending: boolean;
  onOpen(task: TaskBoardTask, event: MouseEvent): void;
  children: JSX.Element;
}) {
  return (
    <KanbanBoard.Card
      id={props.task.id}
      canDrag={props.canDrag}
      pending={props.pending}
      onClick={(event) => {
        if (event.target.closest('[data-kanban-no-drag], button')) return;
        props.onOpen(props.task, event);
      }}
    >
      {props.children}
    </KanbanBoard.Card>
  );
}

function HiddenColumns(props: {
  count: number;
  partial: boolean;
  onReveal(): void;
}) {
  return (
    <KanbanBoard.ColumnPlaceholder aria-label="Hidden columns">
      <div aria-hidden="true" class="h-20 w-32 shrink-0 text-ink-extra-muted">
        <EmptyStateNoFilterMatchGraphic class="size-full" />
      </div>
      <h2
        class="text-sm font-medium"
        title={
          props.partial ? `At least ${props.count} hidden columns` : undefined
        }
      >
        {props.count}
        {props.partial ? '+' : ''} hidden
      </h2>
      <Button size="sm" variant="outline" onClick={props.onReveal}>
        Reveal hidden columns
      </Button>
    </KanbanBoard.ColumnPlaceholder>
  );
}

export const TaskBoard = {
  Root,
  Columns,
  Column: KanbanBoard.Column,
  Header: KanbanBoard.Header,
  ColumnLabel: KanbanBoard.ColumnLabel,
  ColumnCount: KanbanBoard.ColumnCount,
  CardHeader: KanbanBoard.CardHeader,
  CardFields: KanbanBoard.CardFields,
  DropOverlay: KanbanBoard.DropOverlay,
  Cards,
  Card,
  HiddenColumns,
};
