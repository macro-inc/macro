import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import {
  type TaskBoardColumn,
  type TaskBoardTask,
  toTaskBoardGrouping,
} from '../core/task-board';
import type { TaskGroupBy } from '../types';
import { createTaskBoard } from './create-task-board';

const disposers: (() => void)[] = [];
const move = { id: 'one', fromLane: 'todo', toLane: 'done' };
const task: TaskBoardTask = {
  id: 'one',
  name: 'One',
  statusId: 'todo',
  assigneeIds: [],
  projectIds: [],
};

function rows(destination: string, statusId = destination): TaskBoardColumn[] {
  return ['todo', 'done'].map((id) => ({
    id,
    label: id,
    tasks: id === destination ? [{ ...task, statusId }] : [],
    hasMore: false,
    loadingMore: false,
  }));
}

function setup() {
  return createRoot((dispose) => {
    disposers.push(dispose);
    const [columns, setColumns] = createSignal(rows('todo'));
    const [groupBy, setGroupBy] = createSignal<TaskGroupBy>('status');
    const save = vi.fn(async () => {});
    const board = createTaskBoard({
      grouping: () => toTaskBoardGrouping(groupBy()),
      scope: () => toTaskBoardGrouping(groupBy()),
      columns,
      task: (id) =>
        columns()
          .flatMap((column) => column.tasks)
          .find((item) => item.id === id),
      actions: { canEditTask: () => true, canMoveTo: () => true, save },
    });

    return { board, save, setColumns, setGroupBy };
  });
}

function deferSave(save: ReturnType<typeof setup>['save']) {
  let resolve!: () => void;
  save.mockImplementationOnce(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      })
  );
  return () => resolve();
}

afterEach(() => {
  for (const dispose of disposers) {
    dispose();
  }
  disposers.length = 0;
});

it('blocks concurrent moves and restores the previous placement after a failed second move', async () => {
  const { board, save } = setup();
  const resolve = deferSave(save);
  const pending = board.move(move);

  expect(board.pending('one')).toBe(true);
  expect(board.columns()[0].tasks).toEqual([]);
  expect(board.columns()[1].tasks[0].id).toBe('one');
  expect(await board.move(move)).toBe(false);
  expect(save).toHaveBeenCalledOnce();

  resolve();
  expect(await pending).toBe(true);
  save.mockRejectedValueOnce(new Error('Forbidden'));

  expect(await board.move({ ...move, fromLane: 'done', toLane: 'todo' })).toBe(
    false
  );
  expect(board.pending('one')).toBe(false);
  expect(board.error()).toContain('Could not move task');
  expect(board.columns()[1].tasks[0].id).toBe('one');
});

it('ignores stale feed data until membership and properties acknowledge the saved move', async () => {
  const { board, save, setColumns, setGroupBy } = setup();
  const resolve = deferSave(save);
  const pending = board.move(move);
  await Promise.resolve();

  setGroupBy('priority');
  setGroupBy('status');
  expect(board.columns()[1].tasks).toHaveLength(1);

  setColumns(rows('done')); // Local cache optimism precedes save completion.
  resolve();
  await pending;
  setColumns(rows('todo')); // A stale response cannot undo the saved placement.
  expect(board.columns()[1].tasks).toHaveLength(1);

  setColumns(rows('done', 'todo')); // Membership alone does not acknowledge properties.
  expect(board.canMove({ ...move, fromLane: 'done', toLane: 'todo' })).toBe(
    true
  );

  setColumns(rows('done'));
  await Promise.resolve();
  setColumns(rows('todo')); // After acknowledgement, later feed changes are authoritative.
  expect(board.columns()[0].tasks).toHaveLength(1);
  expect(board.columns()[1].tasks).toEqual([]);
});

it.each([false, true])(
  'discards confirmed placement across grouping changes (save completes away: %s)',
  async (completeAway) => {
    const { board, save, setColumns, setGroupBy } = setup();
    const resolve = deferSave(save);
    await Promise.resolve();
    const pending = board.move(move);

    if (!completeAway) {
      resolve();
      await pending;
    }

    setGroupBy('priority');

    if (completeAway) {
      resolve();
      await pending;
    }

    setColumns(rows('todo'));
    setGroupBy('date'); // List-only grouping falls back to Status in the board.
    expect(board.columns()[0].tasks).toEqual([task]);
    expect(board.columns()[1].tasks).toEqual([]);
  }
);
