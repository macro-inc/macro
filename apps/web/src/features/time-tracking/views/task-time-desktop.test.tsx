import type { TimeEntryFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { ok } from 'neverthrow';
import { afterEach, expect, it, vi } from 'vitest';
import type { TaskTime } from '../primitives/create-task-time';
import { TaskTimeDesktop } from './task-time-desktop';

const entry: TimeEntryFieldsFragment = {
  id: 'entry-1',
  taskId: 'task-1',
  userId: 'macro|author@example.com',
  date: '2026-11-18',
  minutes: 30,
  note: 'Kickoff notes',
  startedAt: null,
  endedAt: null,
  source: 'MANUAL',
  createdAt: '2026-11-18T09:00:00.000Z',
  updatedAt: '2026-11-18T09:00:00.000Z',
  canEdit: true,
};

const update = vi.fn<TaskTime['update']>(() =>
  Promise.resolve(ok({ kind: 'queued' as const }))
);

let requestedTaskId: () => string | undefined = () => undefined;

vi.mock('../primitives/create-task-time', () => ({
  createTaskTime: (taskId: () => string | undefined): Partial<TaskTime> => {
    requestedTaskId = taskId;
    return {
      entries: () => [entry],
      pending: () => false,
      failed: () => false,
      hasOlder: () => false,
      olderPending: () => false,
      showOlder: vi.fn(),
      refetch: vi.fn(),
      viewerId: () => entry.userId,
      log: vi.fn(),
      update,
      remove: vi.fn(),
    };
  },
}));

afterEach(() => {
  cleanup();
  update.mockClear();
});

it('reads entries once opened and saves an edited entry after the form closes', async () => {
  render(() => (
    <TaskTimeDesktop
      taskId="task-1"
      minutes={30}
      canEdit
      person={() => <span>Author</span>}
    />
  ));

  expect(requestedTaskId()).toBeUndefined();
  fireEvent.click(screen.getByRole('button', { name: /^Time logged/ }));
  expect(requestedTaskId()).toBe('task-1');
  const menu = await screen.findByRole('button', { name: 'Entry actions' });
  fireEvent.keyDown(menu, { key: 'Enter' });
  const edit = await screen.findByRole('menuitem', { name: 'Edit entry' });
  fireEvent.keyDown(edit, { key: 'Enter' });

  const length = await screen.findByRole('textbox', { name: 'Length' });
  fireEvent.input(length, { target: { value: '45m' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  expect(update).toHaveBeenCalledOnce();
  expect(update).toHaveBeenCalledWith(
    entry,
    expect.objectContaining({ minutes: 45, date: '2026-11-18' })
  );
});
