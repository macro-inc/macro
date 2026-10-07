import { createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import type { TaskBoardColumn, TaskBoardTask } from '../core/task-board';
import { createTaskBoard } from './create-task-board';

function fixture() {
  const task = (id: string, statusId: string): TaskBoardTask => ({
    id,
    statusId,
    name: id,
    assigneeIds: [],
    projectIds: [],
  });
  const [one, setOne] = createSignal(task('one', 'todo'));
  const two = task('two', 'done');
  const three = task('three', 'done');
  const [scope, setScope] = createSignal('first');
  const [revision, setRevision] = createSignal(0);
  const save = vi.fn(async () => {});
  const board = createTaskBoard({
    scope,
    grouping: () => 'status',
    task: (id) => (id === 'one' ? one() : id === 'two' ? two : three),
    columns: (): TaskBoardColumn[] => {
      revision();
      return ['todo', 'done'].map((id) => ({
        id,
        label: id,
        hasMore: false,
        loadingMore: false,
        tasks: [one(), two, three].filter((task) => task.statusId === id),
      }));
    },
    compareTasks: (left, right) =>
      ['one', 'two', 'three'].indexOf(left) -
      ['one', 'two', 'three'].indexOf(right),
    actions: { canEditTask: () => true, canMoveTo: () => true, save },
  });
  const order = () =>
    board
      .columns()
      .find((column) => column.id === 'done')!
      .tasks.map((task) => task.id);
  return {
    board,
    order,
    setScope,
    save,
    confirm: () => {
      setOne(task('one', 'done'));
      setRevision((value) => value + 1);
    },
  };
}

it('retains a pointer-selected slot across save acknowledgement and resets on scope changes', async () => {
  await createRoot(async (dispose) => {
    try {
      const value = fixture();
      await Promise.resolve();
      expect(
        await value.board.move({
          id: 'one',
          fromLane: 'todo',
          toLane: 'done',
          beforeId: 'three',
        })
      ).toBe(true);
      expect(value.order()).toEqual(['two', 'one', 'three']);
      value.confirm();
      await Promise.resolve();
      expect(value.order()).toEqual(['two', 'one', 'three']);
      value.setScope('second');
      expect(value.order()).toEqual(['one', 'two', 'three']);
    } finally {
      dispose();
    }
  });
});

it('appends below the final card and removes the local slot when a write fails', async () => {
  await createRoot(async (dispose) => {
    try {
      const value = fixture();
      await Promise.resolve();
      value.save.mockRejectedValueOnce(new Error('Forbidden'));
      expect(
        await value.board.move({
          id: 'one',
          fromLane: 'todo',
          toLane: 'done',
          beforeId: 'three',
        })
      ).toBe(false);
      expect(value.order()).toEqual(['two', 'three']);
      expect(
        await value.board.move({ id: 'one', fromLane: 'todo', toLane: 'done' })
      ).toBe(true);
      expect(value.order()).toEqual(['two', 'three', 'one']);
      value.board.resetPositions();
      expect(value.order()).toEqual(['one', 'two', 'three']);
    } finally {
      dispose();
    }
  });
});
