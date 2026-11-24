import type { TimeEntryFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { Client } from '@urql/core';
import { ok } from 'neverthrow';
import type { JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { TimeTrackingContextProvider } from '../context/time-tracking-context';
import type { TaskTime } from '../primitives/create-task-time';
import type { RunningTimerState } from '../primitives/running-timer';
import type { RunningTimer } from '../queries/timer';
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
  createTimeEntryWrites: () => ({ update, remove: vi.fn() }),
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

function fakeTimer(running?: RunningTimer) {
  const start = vi.fn<RunningTimerState['start']>(() =>
    Promise.resolve(ok({ kind: 'committed' as const, data: undefined }))
  );
  const stop = vi.fn<RunningTimerState['stop']>(() =>
    Promise.resolve(ok({ kind: 'committed' as const, data: undefined }))
  );
  const timer: RunningTimerState = {
    timer: () => running,
    seconds: () => 2530,
    now: () => Date.now(),
    pending: () => false,
    busy: () => false,
    offline: () => false,
    start,
    stop,
    discard: vi.fn(),
    exclusive: vi.fn(),
  };
  return { timer, start, stop };
}

function renderDesktop(runningTimer: RunningTimerState): void {
  const view = (): JSX.Element => (
    <TaskTimeDesktop
      taskId="task-1"
      minutes={30}
      canEdit
      person={() => <span>Author</span>}
    />
  );
  render(() => (
    <TimeTrackingContextProvider
      value={{
        client: () => ({}) as Client,
        cacheHost: () => undefined,
        viewerId: () => entry.userId,
        runningTimer,
      }}
    >
      {view()}
    </TimeTrackingContextProvider>
  ));
}

it('reads entries once opened and saves an edited entry after the form closes', async () => {
  renderDesktop(fakeTimer().timer);

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

it('starts a timer on the task from the popover', async () => {
  const { timer, start } = fakeTimer();
  renderDesktop(timer);
  fireEvent.click(screen.getByRole('button', { name: /^Time logged/ }));
  fireEvent.click(await screen.findByRole('button', { name: /Start timer/ }));
  expect(start).toHaveBeenCalledWith({ taskId: 'task-1' });
});

it('stops the timer running on the task, showing its count', async () => {
  const { timer, stop } = fakeTimer({
    id: 'timer-1',
    taskId: 'task-1',
    startedAt: '2026-11-23T10:02:00.000Z',
    task: {
      __typename: 'GraphqlSoupDocument',
      id: 'task-1',
      name: 'Wireframes',
    },
  });
  renderDesktop(timer);
  fireEvent.click(screen.getByRole('button', { name: /^Time logged/ }));
  const control = await screen.findByRole('button', {
    name: 'Stop the timer at 0:42:10',
  });
  fireEvent.click(control);
  expect(stop).toHaveBeenCalledWith({ timerId: 'timer-1' });
});
