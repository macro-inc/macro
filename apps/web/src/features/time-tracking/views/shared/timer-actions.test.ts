import type { TimeEntryFieldsFragment } from '@service-storage/graphql/generated/graphql';
import type { Client } from '@urql/core';
import { err, ok } from 'neverthrow';
import { beforeEach, expect, it, vi } from 'vitest';
import type { RunningTimerState } from '../../primitives/running-timer';
import type { RunningTimer } from '../../queries/timer';
import { createTimerActions } from './timer-actions';

const mocks = vi.hoisted(() => ({
  success: vi.fn(),
  failure: vi.fn(),
  alert: vi.fn(),
  remove: vi.fn(),
  choice: undefined as unknown,
}));

vi.mock('@core/component/Toast/Toast', () => ({
  toast: {
    success: mocks.success,
    failure: mocks.failure,
    alert: mocks.alert,
  },
}));
vi.mock('../../primitives/create-task-time', () => ({
  createTimeEntryWrites: () => ({ update: vi.fn(), remove: mocks.remove }),
}));
vi.mock('@ui/components/ImperativeDialog', () => ({
  openDialog: (
    _component: unknown,
    props: { onChoose?: (choice: unknown) => void }
  ) => {
    let resolveClosed: (event: { reason: string }) => void = () => undefined;
    const closed = new Promise<{ reason: string }>((resolve) => {
      resolveClosed = resolve;
    });
    queueMicrotask(() => props.onChoose?.(mocks.choice));
    return {
      close: () => resolveClosed({ reason: 'programmatic' }),
      closed,
    };
  },
}));

const DESIGN: RunningTimer = {
  id: 'timer-1',
  taskId: 'task-a',
  startedAt: '2026-11-23T09:00:00.000Z',
  task: {
    __typename: 'GraphqlSoupDocument',
    id: 'task-a',
    name: 'Design audit',
  },
};
const WIREFRAMES: RunningTimer = {
  id: 'timer-2',
  taskId: 'task-b',
  startedAt: '2026-11-23T10:12:00.000Z',
  task: { __typename: 'GraphqlSoupDocument', id: 'task-b', name: 'Wireframes' },
};
const SAVED: TimeEntryFieldsFragment = {
  id: 'timer-1',
  taskId: 'task-a',
  userId: 'macro|author@example.com',
  date: '2026-11-23',
  minutes: 72,
  note: null,
  startedAt: DESIGN.startedAt,
  endedAt: WIREFRAMES.startedAt,
  source: 'TIMER',
  createdAt: WIREFRAMES.startedAt,
  updatedAt: WIREFRAMES.startedAt,
  canEdit: true,
};

const calls: string[] = [];

function fakeTimer(running: RunningTimer | undefined) {
  const timer = {
    timer: () => running,
    seconds: () => 0,
    now: () => Date.parse('2026-11-23T20:00:00.000Z'),
    pending: () => false,
    busy: () => false,
    offline: () => false,
    start: vi.fn(),
    stop: vi.fn(),
    discard: vi.fn(),
    exclusive: vi.fn(),
  } satisfies RunningTimerState;
  timer.exclusive.mockImplementation((run) =>
    run({ start: timer.start, stop: timer.stop, discard: timer.discard })
  );
  return timer;
}

function actionsFor(runningTimer: RunningTimerState) {
  return createTimerActions({
    client: () => ({}) as Client,
    cacheHost: () => undefined,
    viewerId: () => SAVED.userId,
    runningTimer,
  });
}

beforeEach(() => {
  calls.length = 0;
  for (const mock of [mocks.success, mocks.failure, mocks.alert, mocks.remove])
    mock.mockReset();
  mocks.remove.mockImplementation(async () => {
    calls.push('remove');
    return ok({ kind: 'queued' });
  });
});

it('says what a switch saved, and Undo puts the first timer back', async () => {
  const timer = fakeTimer(DESIGN);
  timer.start.mockImplementation(async (args) => {
    calls.push(`start ${args.taskId} ${args.startedAt ?? ''}`.trim());
    return ok({
      kind: 'committed',
      data: {
        timeTracking: {
          id: 'tracking',
          serverNow: WIREFRAMES.startedAt,
          runningTimer: WIREFRAMES,
        },
        stoppedEntry: SAVED,
        stoppedTask: null,
      },
    });
  });
  timer.discard.mockImplementation(async (timerId) => {
    calls.push(`discard ${timerId}`);
    return ok({ kind: 'committed', data: null });
  });

  actionsFor(timer).start('task-b');
  await vi.waitFor(() => expect(mocks.success).toHaveBeenCalledOnce());
  const [message, options] = mocks.success.mock.calls[0] ?? [];
  expect(message).toBe(
    'Stopped the timer on Design audit and logged 1h 12m. Now timing Wireframes.'
  );

  calls.length = 0;
  options.actions[0].onClick();
  await vi.waitFor(() => expect(calls).toHaveLength(3));
  expect(calls).toEqual([
    'discard timer-2',
    `start task-a ${DESIGN.startedAt}`,
    'remove',
  ]);
});

it('keeps the saved entry when Undo cannot start the first timer again', async () => {
  const timer = fakeTimer(DESIGN);
  timer.start
    .mockResolvedValueOnce(
      ok({
        kind: 'committed',
        data: {
          timeTracking: {
            id: 'tracking',
            serverNow: '',
            runningTimer: WIREFRAMES,
          },
          stoppedEntry: SAVED,
          stoppedTask: null,
        },
      })
    )
    .mockResolvedValueOnce(
      err({ kind: 'refused', code: 'OFFLINE', message: 'offline' })
    );
  timer.discard.mockResolvedValue(ok({ kind: 'committed', data: null }));
  actionsFor(timer).start('task-b');
  await vi.waitFor(() => expect(mocks.success).toHaveBeenCalledOnce());
  mocks.success.mock.calls[0]?.[1].actions[0].onClick();
  await vi.waitFor(() =>
    expect(mocks.failure).toHaveBeenCalledWith(
      'Could not undo. Check the time logged on both tasks.'
    )
  );
  expect(mocks.remove).not.toHaveBeenCalled();
});

it('says nothing when Undo is pressed while another timer change runs', async () => {
  const timer = fakeTimer(DESIGN);
  timer.start.mockResolvedValueOnce(
    ok({
      kind: 'committed',
      data: {
        timeTracking: {
          id: 'tracking',
          serverNow: '',
          runningTimer: WIREFRAMES,
        },
        stoppedEntry: SAVED,
        stoppedTask: null,
      },
    })
  );
  actionsFor(timer).start('task-b');
  await vi.waitFor(() => expect(mocks.success).toHaveBeenCalledOnce());
  timer.exclusive.mockResolvedValueOnce(
    err({ kind: 'refused', code: 'BUSY', message: 'busy' })
  );
  mocks.success.mock.calls[0]?.[1].actions[0].onClick();
  await vi.waitFor(() => expect(timer.exclusive).toHaveBeenCalledTimes(1));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(mocks.failure).not.toHaveBeenCalled();
  expect(timer.discard).not.toHaveBeenCalled();
});

it('names and undoes only the timer the server says it stopped', async () => {
  const timer = fakeTimer({ ...DESIGN, id: 'timer-seen-here' });
  timer.start.mockResolvedValue(
    ok({
      kind: 'committed',
      data: {
        timeTracking: {
          id: 'tracking',
          serverNow: '',
          runningTimer: WIREFRAMES,
        },
        stoppedEntry: SAVED,
        stoppedTask: null,
      },
    })
  );
  actionsFor(timer).start('task-b');
  await vi.waitFor(() => expect(mocks.success).toHaveBeenCalledOnce());
  expect(mocks.success.mock.calls[0]?.[0]).toBe(
    'Stopped the timer on Your running timer and logged 1h 12m. Now timing Wireframes.'
  );
});

it('resolves a timer past the limit even before this device has read it', async () => {
  const timer = fakeTimer(undefined);
  timer.start
    .mockResolvedValueOnce(
      err({
        kind: 'over-limit',
        timer: {
          id: DESIGN.id,
          taskId: DESIGN.taskId,
          startedAt: DESIGN.startedAt,
        },
      })
    )
    .mockResolvedValueOnce(ok({ kind: 'committed', data: undefined }));
  timer.discard.mockResolvedValue(ok({ kind: 'committed', data: null }));
  mocks.choice = { kind: 'discard' };
  actionsFor(timer).start('task-b');
  await vi.waitFor(() => expect(timer.start).toHaveBeenCalledTimes(2));
  expect(timer.discard).toHaveBeenCalledWith(DESIGN.id);
});

it('says nothing about a press while another timer change runs', async () => {
  const timer = fakeTimer(undefined);
  timer.start.mockResolvedValue(
    err({ kind: 'refused', code: 'BUSY', message: 'busy' })
  );
  actionsFor(timer).start('task-b');
  await vi.waitFor(() => expect(timer.start).toHaveBeenCalledOnce());
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(mocks.failure).not.toHaveBeenCalled();
});

it('confirms a stop with the length and an Edit action', async () => {
  const timer = fakeTimer(DESIGN);
  timer.stop.mockResolvedValue(
    ok({
      kind: 'committed',
      data: {
        timeTracking: { id: 'tracking', serverNow: '', runningTimer: null },
        entry: SAVED,
        task: null,
      },
    })
  );
  actionsFor(timer).stop();
  await vi.waitFor(() => expect(mocks.success).toHaveBeenCalledOnce());
  const [message, options] = mocks.success.mock.calls[0] ?? [];
  expect(message).toBe('Logged 1h 12m on Design audit');
  expect(options.actions[0].label).toBe('Edit');
});

it('asks what to log for a timer past the limit, then stops it that way', async () => {
  const timer = fakeTimer(DESIGN);
  timer.stop
    .mockResolvedValueOnce(
      err({
        kind: 'over-limit',
        timer: {
          id: DESIGN.id,
          taskId: DESIGN.taskId,
          startedAt: DESIGN.startedAt,
        },
      })
    )
    .mockResolvedValueOnce(
      ok({
        kind: 'committed',
        data: {
          timeTracking: { id: 'tracking', serverNow: '', runningTimer: null },
          entry: SAVED,
          task: null,
        },
      })
    );
  mocks.choice = { kind: 'log-all' };
  actionsFor(timer).stop();
  await vi.waitFor(() => expect(timer.stop).toHaveBeenCalledTimes(2));
  expect(timer.stop).toHaveBeenLastCalledWith({
    timerId: DESIGN.id,
    logAll: true,
  });
});

it('says why a timer cannot change offline', async () => {
  const timer = fakeTimer(undefined);
  timer.start.mockResolvedValue(
    err({ kind: 'refused', code: 'OFFLINE', message: 'offline' })
  );
  actionsFor(timer).start('task-b');
  await vi.waitFor(() =>
    expect(mocks.failure).toHaveBeenCalledWith('The timer needs a connection')
  );
});
