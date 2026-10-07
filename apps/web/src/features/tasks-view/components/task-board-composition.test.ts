import type {
  Kanban,
  KanbanCrossColumnDrop,
} from '@app/components/kanban/kanban';
import { cleanup, render } from '@solidjs/testing-library';
import {
  type Accessor,
  type ComponentProps,
  createComponent,
  createEffect,
  createSignal,
  type JSX,
  onCleanup,
} from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TaskBoardColumn, TaskBoardTask } from '../core/task-board';
import { TaskBoard } from './task-board';

const drag = vi.hoisted(() => ({
  drop: undefined as ((drop: KanbanCrossColumnDrop) => void) | undefined,
}));
const scrolled = vi.hoisted(() => vi.fn());
const visibility = vi.hoisted(() => ({ end: (): boolean => true }));

vi.mock('@app/components/kanban/kanban', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@app/components/kanban/kanban')>();

  return {
    ...original,
    Kanban: (props: ComponentProps<typeof Kanban>) => {
      if (props.mode === 'cross-column') drag.drop = props.onDrop;
      return original.Kanban(props);
    },
  };
});

vi.mock('@app/components/kanban/kanban-virtualizer', () => ({
  createKanbanVirtualizer: (options: {
    direction: string;
    keys: Accessor<readonly (string | number)[]>;
  }) => ({
    getVirtualItems: () =>
      options
        .keys()
        .map((key, index) => ({
          key,
          index,
          start: index * 100,
          size: 100,
        }))
        .filter((item) => item.key !== -1 || visibility.end()),
    getTotalSize: () => options.keys().length * 100,
    scrollToIndex: (index: number, scrollOptions: { align?: string }) =>
      scrolled(options.direction, index, scrollOptions),
    measureElement: vi.fn(),
    takeSnapshot: () => [],
  }),
}));

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
  );
});
afterEach(() => {
  cleanup();
  drag.drop = undefined;
  vi.clearAllMocks();
  visibility.end = () => true;
  vi.unstubAllGlobals();
});

const task: TaskBoardTask = {
  id: 'task',
  name: 'Original',
  statusId: 'todo',
  assigneeIds: [],
  projectIds: [],
};

function column(id: string, tasks: readonly TaskBoardTask[]): TaskBoardColumn {
  return { id, label: id, tasks, hasMore: true, loadingMore: false };
}

function mountBoard(options: {
  columns: Accessor<readonly TaskBoardColumn[]>;
  hidden: Accessor<boolean>;
  endColumn?: () => JSX.Element;
  move(): Promise<boolean>;
}) {
  const card = (current: Accessor<TaskBoardTask>) => {
    const content = document.createElement('span');
    createEffect(() => {
      content.textContent = current().name;
    });

    return createComponent(TaskBoard.Card, {
      get task() {
        return current();
      },
      canDrag: true,
      pending: false,
      onOpen: vi.fn(),
      children: content,
    });
  };
  const cards = (current: Accessor<TaskBoardColumn>) =>
    createComponent(TaskBoard.Cards, {
      children: card,
      get footer() {
        const footer = document.createElement('button');
        footer.textContent = `${current().id} paging`;
        return footer;
      },
    });

  return render(() =>
    createComponent(TaskBoard.Root, {
      get columns() {
        return options.columns();
      },
      animationScope: 'scope',
      canMove: () => true,
      onMove: options.move,
      get children() {
        return createComponent(TaskBoard.Columns, {
          get endColumn() {
            if (!options.hidden()) return undefined;
            return (
              options.endColumn ??
              (() => {
                const end = document.createElement('section');
                end.textContent = 'Hidden';
                return end;
              })
            );
          },
          children: (current) =>
            createComponent(TaskBoard.Column, {
              get children() {
                const heading = document.createElement('h2');
                createEffect(() => {
                  heading.textContent = current().label;
                });
                return [
                  createComponent(TaskBoard.Header, { children: heading }),
                  cards(current),
                ];
              },
            }),
        });
      },
    })
  );
}

it('preserves reactive card content and column ownership across regrouping and final-column changes', async () => {
  const [columns, setColumns] = createSignal([column('todo', [task])]);
  const [hidden, setHidden] = createSignal(false);
  const view = mountBoard({ columns, hidden, move: async () => true });
  const original = view.container.querySelector('[data-kanban-card]');

  setColumns([column('todo', [{ ...task, name: 'Updated' }])]);
  expect(view.container.querySelector('[data-kanban-card]')).toBe(original);
  expect(original?.textContent).toBe('Updated');

  setHidden(true);
  expect(view.getByText('Hidden')).toBeTruthy();
  setColumns([]);
  expect(view.container.querySelector('[data-kanban-card]')).toBeNull();
  setColumns([column('alice', [{ ...task, name: 'Regrouped' }])]);
  expect(view.getByText('Regrouped')).toBeTruthy();
  expect(view.queryByText('todo paging')).toBeNull();
  expect(view.getByText('alice paging')).toBeTruthy();
  const lane = view.container.querySelector('[data-kanban-lane="alice"]');
  const labelId = lane?.getAttribute('aria-labelledby');
  expect(document.getElementById(labelId ?? '')?.textContent).toBe('alice');
  expect(
    lane
      ?.querySelector('[data-task-board-scroll]')
      ?.getAttribute('aria-labelledby')
  ).toBe(labelId);
  setHidden(false);
  expect(view.queryByText('Hidden')).toBeNull();

  await Promise.resolve();
  const spacer = view.container.querySelector('[data-task-board-rows]');
  expect(spacer?.nextElementSibling?.textContent).toBe('alice paging');
});

it('reveals the sorted destination card through both composed virtualizers after a successful move', async () => {
  const [columns, setColumns] = createSignal([
    column('todo', [task]),
    column('done', [{ ...task, id: 'earlier', name: 'Earlier' }]),
  ]);
  const move = async () => {
    setColumns([
      column('todo', []),
      column('done', [
        { ...task, id: 'earlier', name: 'Earlier' },
        { ...task, statusId: 'done' },
      ]),
    ]);
    return true;
  };
  mountBoard({ columns, hidden: () => false, move });

  drag.drop?.({ kind: 'card', id: task.id, fromLane: 'todo', toLane: 'done' });
  await Promise.resolve();
  expect(scrolled).toHaveBeenCalledWith('horizontal', 1, { align: 'auto' });
  expect(scrolled).toHaveBeenCalledWith('vertical', 1, { align: 'auto' });
});

it('creates final-column resources only while that virtual column is mounted', () => {
  const [visible, setVisible] = createSignal(false);
  const [hidden, setHidden] = createSignal(true);
  visibility.end = visible;
  const disposed = vi.fn();
  const endColumn = vi.fn(() => {
    onCleanup(disposed);
    const end = document.createElement('section');
    end.textContent = 'Hidden';
    return end;
  });
  const view = mountBoard({
    columns: () => [column('todo', [task])],
    hidden,
    endColumn,
    move: async () => true,
  });

  expect(endColumn).not.toHaveBeenCalled();
  expect(view.queryByText('Hidden')).toBeNull();
  setVisible(true);
  expect(endColumn).toHaveBeenCalledTimes(1);
  expect(view.getByText('Hidden')).toBeTruthy();
  setVisible(false);
  expect(disposed).toHaveBeenCalledTimes(1);
  expect(view.queryByText('Hidden')).toBeNull();
  setVisible(true);
  expect(endColumn).toHaveBeenCalledTimes(2);
  setHidden(false);
  expect(disposed).toHaveBeenCalledTimes(2);
  expect(view.queryByText('Hidden')).toBeNull();
});
