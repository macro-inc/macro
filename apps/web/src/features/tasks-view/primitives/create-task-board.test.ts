import { createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import type { TaskBoardColumn, TaskBoardTask } from '../core/task-board';
import { createTaskBoard } from './create-task-board';

it('blocks read-only, stale, same-column, and concurrent moves; settles failures without owning cache data', async () => {
  await createRoot(async (dispose) => {
    try {
      const task: TaskBoardTask = {
        id: 'one',
        name: 'One',
        statusId: 'todo',
        assigneeIds: [],
        projectIds: [],
      };
      const [editable, setEditable] = createSignal(false);

      let resolve: () => void = () => {};

      const save = vi.fn(
        () =>
          new Promise<void>((done) => {
            resolve = done;
          })
      );

      const columns = ['todo', 'done'].map((id) => ({
        id,
        label: id,
        tasks: id === 'todo' ? [task] : [],
        hasMore: false,
        loadingMore: false,
      }));

      const board = createTaskBoard({
        grouping: () => 'status',
        scope: () => 'scope',
        task: () => task,
        columns: () => columns,
        actions: { canEditTask: editable, canMoveTo: () => true, save },
      });
      const move = { id: 'one', fromLane: 'todo', toLane: 'done' };

      expect(await board.move(move)).toBe(false);

      setEditable(true);

      expect(await board.move({ ...move, toLane: 'todo' })).toBe(false);
      expect(await board.move({ ...move, toLane: 'missing' })).toBe(false);
      expect(await board.move({ ...move, fromLane: 'gone' })).toBe(false);

      const first = board.move(move);

      expect(board.pending('one')).toBe(true);
      expect(
        board.columns().find((column) => column.id === 'todo')?.tasks
      ).toEqual([]);
      expect(
        board.columns().find((column) => column.id === 'done')?.tasks[0].id
      ).toBe('one');
      expect(await board.move(move)).toBe(false);
      expect(save).toHaveBeenCalledOnce();

      resolve();

      expect(await first).toBe(true);
      expect(board.pending('one')).toBe(false);
      expect(board.error()).toBeUndefined();

      save.mockRejectedValueOnce(new Error('Forbidden'));

      expect(
        await board.move({ ...move, fromLane: 'done', toLane: 'todo' })
      ).toBe(false);
      expect(board.pending('one')).toBe(false);
      expect(board.error()).toContain('Could not move task');
      expect(task.statusId).toBe('todo');
      expect(
        board.columns().find((column) => column.id === 'done')?.tasks[0].id
      ).toBe('one');
    } finally {
      dispose();
    }
  });
});

it('rechecks permissions and hides errors from a previous view scope', async () => {
  await createRoot(async (dispose) => {
    try {
      const [scope, setScope] = createSignal('old');
      const [allowed, setAllowed] = createSignal(true);

      let reject: (error: Error) => void = () => {};

      const save = vi.fn(
        () =>
          new Promise<void>((_resolve, fail) => {
            reject = fail;
          })
      );

      const board = createTaskBoard({
        grouping: () => 'assignee',
        scope,
        task: () => ({
          id: 'one',
          name: 'One',
          assigneeIds: ['alice'],
          projectIds: [],
        }),
        columns: () =>
          ['alice', 'bob'].map((id) => ({
            id,
            label: id,
            tasks: [],
            hasMore: false,
            loadingMore: false,
          })),
        actions: { canEditTask: allowed, canMoveTo: () => true, save },
      });
      const move = { id: 'one', fromLane: 'alice', toLane: 'bob' };

      expect(board.canMove(move)).toBe(true);

      setAllowed(false);

      expect(await board.move(move)).toBe(false);

      setAllowed(true);

      const pending = board.move(move);
      setScope('new');
      reject(new Error('Forbidden'));
      await pending;

      expect(board.error()).toBeUndefined();

      setScope('old');

      expect(board.error()).toContain('Could not move task');
    } finally {
      dispose();
    }
  });
});

it('keeps a confirmed placement until the feed acknowledges it, then accepts later feed changes', async () => {
  await createRoot(async (dispose) => {
    try {
      const task: TaskBoardTask = {
        id: 'one',
        name: 'One',
        statusId: 'todo',
        assigneeIds: [],
        projectIds: [],
      };
      const rows = (destination: string): TaskBoardColumn[] =>
        ['todo', 'done'].map((id) => ({
          id,
          label: id,
          tasks: id === destination ? [{ ...task, statusId: destination }] : [],
          hasMore: false,
          loadingMore: false,
        }));
      const [columns, setColumns] = createSignal(rows('todo'));
      const [scope, setScope] = createSignal('test');
      let resolve: () => void = () => {};
      const save = () =>
        new Promise<void>((done) => {
          resolve = done;
        });
      const board = createTaskBoard({
        grouping: () => 'status',
        scope,
        columns,
        task: () => columns().flatMap((column) => column.tasks)[0],
        actions: {
          canEditTask: () => true,
          canMoveTo: () => true,
          save,
        },
      });

      const pending = board.move({
        id: 'one',
        fromLane: 'todo',
        toLane: 'done',
      });
      expect(board.columns()[1].tasks).toHaveLength(1);
      await Promise.resolve();
      setScope('another-grouping');
      setScope('test');
      expect(board.columns()[1].tasks).toHaveLength(1);
      setColumns(rows('done')); // Local cache optimism precedes save completion.
      resolve();
      await pending;
      setColumns(rows('todo')); // A stale response must not undo the placement.
      expect(board.columns()[1].tasks).toHaveLength(1);
      setColumns(
        rows('done').map((column) => ({
          ...column,
          tasks: column.tasks.map((item) => ({ ...item, statusId: 'todo' })),
        }))
      );
      expect(
        board.canMove({ id: 'one', fromLane: 'done', toLane: 'todo' })
      ).toBe(true);
      setColumns(rows('done'));
      await Promise.resolve();
      setColumns(rows('todo'));
      expect(board.columns()[0].tasks).toHaveLength(1);
      expect(board.columns()[1].tasks).toEqual([]);
    } finally {
      dispose();
    }
  });
});

it.each([false, true])(
  'does not restore a confirmed override after leaving its scope (save completes away: %s)',
  async (completeAway) => {
    await createRoot(async (dispose) => {
      try {
        const original: TaskBoardTask = {
          id: 'one',
          name: 'One',
          statusId: 'todo',
          assigneeIds: [],
          projectIds: [],
        };
        const [task, setTask] = createSignal(original);
        const [scope, setScope] = createSignal('status');
        let resolve!: () => void;
        const board = createTaskBoard({
          grouping: () => 'status',
          scope,
          task,
          columns: () =>
            ['todo', 'done'].map((id) => ({
              id,
              label: id,
              tasks: task().statusId === id ? [task()] : [],
              hasMore: false,
              loadingMore: false,
            })),
          actions: {
            canEditTask: () => true,
            canMoveTo: () => true,
            save: () =>
              new Promise<void>((done) => {
                resolve = done;
              }),
          },
        });
        await Promise.resolve();
        const pending = board.move({
          id: 'one',
          fromLane: 'todo',
          toLane: 'done',
        });

        if (!completeAway) {
          resolve();
          await pending;
        }

        setScope('priority');

        if (completeAway) {
          resolve();
          await pending;
        }

        setTask({ ...original });
        setScope('status');
        expect(board.columns()[0].tasks).toEqual([original]);
        expect(board.columns()[1].tasks).toEqual([]);
      } finally {
        dispose();
      }
    });
  }
);
