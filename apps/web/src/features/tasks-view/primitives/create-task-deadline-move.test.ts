import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createTaskCalendar } from '../core/task-due-date';
import { createTaskBoard } from './create-task-board';
import { createTaskDeadlineMove } from './create-task-deadline-move';

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

function setup() {
  return createRoot((dispose) => {
    disposers.push(dispose);
    const calendar = createTaskCalendar(
      new Date('2026-10-21T18:00:00Z'),
      'America/New_York'
    );
    const [scope, setScope] = createSignal('one');
    const picker = createTaskDeadlineMove({ calendar: () => calendar, scope });
    const task = {
      id: 'one',
      name: 'One',
      dueDate: calendar.boundaries.today,
      deadline: 'today' as const,
      assigneeIds: [],
      projectIds: [],
    };
    const save = vi.fn(async () => {});
    const board = createTaskBoard({
      grouping: () => 'due_date',
      scope,
      columns: () =>
        ['today', 'tomorrow', 'next_7_days', 'later', 'no_due_date'].map(
          (id) => ({
            id,
            label: id,
            tasks: id === 'today' ? [task] : [],
            count: id === 'today' ? 1 : 0,
            hasMore: false,
            loadingMore: false,
          })
        ),
      task: () => task,
      actions: { canEditTask: () => true, canMoveTo: () => true, save },
      prepareMove: picker.prepare,
    });
    return { calendar, picker, board, save, setScope };
  });
}

it('cancels a broad bucket picker without writing or moving the original card', async () => {
  const { picker, board, save } = setup();
  const pending = board.move({
    id: 'one',
    fromLane: 'today',
    toLane: 'next_7_days',
  });
  expect(board.pending('one')).toBe(true);
  expect(picker.picker()).toMatchObject({
    min: '2026-10-23',
    max: '2026-10-28',
  });
  expect(board.columns()[0].tasks).toHaveLength(1);
  picker.cancel();
  expect(await pending).toBe(false);
  expect(save).not.toHaveBeenCalled();
  expect(board.pending('one')).toBe(false);
  expect(board.columns()[0].tasks).toHaveLength(1);
});

it('rejects out-of-bucket dates and rolls back a rejected reschedule', async () => {
  const { picker, board, save } = setup();
  const pending = board.move({
    id: 'one',
    fromLane: 'today',
    toLane: 'next_7_days',
  });
  picker.select('2026-10-29');
  picker.apply();
  expect(picker.picker()).toBeDefined();
  expect(save).not.toHaveBeenCalled();
  save.mockRejectedValueOnce(new Error('Forbidden'));
  picker.select('2026-10-28');
  picker.apply();
  expect(await pending).toBe(false);
  expect(save).toHaveBeenCalledWith(
    {
      id: 'one',
      fromLane: 'today',
      toLane: 'next_7_days',
      dueDate: '2026-10-28T04:00:00.000Z',
    },
    'due_date'
  );
  expect(board.columns()[0].tasks).toHaveLength(1);
  expect(board.columns()[2].tasks).toHaveLength(0);
});

it('assigns Tomorrow directly and clears dates without a picker', async () => {
  const { picker, calendar } = setup();
  expect(
    await picker.prepare(
      { id: 'one', fromLane: 'today', toLane: 'tomorrow' },
      'due_date'
    )
  ).toMatchObject({ dueDate: calendar.boundaries.tomorrow });
  expect(
    await picker.prepare(
      { id: 'one', fromLane: 'today', toLane: 'no_due_date' },
      'due_date'
    )
  ).toMatchObject({ dueDate: null });
  expect(picker.picker()).toBeUndefined();
});

it('cancels a pending date choice when its board scope changes', async () => {
  const { picker, board, save, setScope } = setup();
  const pending = board.move({
    id: 'one',
    fromLane: 'today',
    toLane: 'next_7_days',
  });
  setScope('another board');
  expect(await pending).toBe(false);
  expect(picker.picker()).toBeUndefined();
  expect(save).not.toHaveBeenCalled();
  expect(board.pending('one')).toBe(false);
});
