import type { Client } from '@urql/core';
import { err } from 'neverthrow';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRunningTimer } from '../../primitives/running-timer';
import type { RunningTimer } from '../../queries/timer';
import { createTimerActions } from './timer-actions';

const mocks = vi.hoisted(() => ({
  success: vi.fn(),
  failure: vi.fn(),
  alert: vi.fn(),
  refetch: vi.fn(),
  startTimer: vi.fn(),
  stopTimer: vi.fn(),
}));

vi.mock('@core/component/Toast/Toast', () => ({
  toast: {
    success: mocks.success,
    failure: mocks.failure,
    alert: mocks.alert,
  },
}));
vi.mock('../../primitives/create-task-time', () => ({
  createTimeEntryWrites: () => ({ update: vi.fn(), remove: vi.fn() }),
}));
vi.mock('../../queries/timer', () => ({
  createRunningTimerQuery: () => ({
    timer,
    serverNow: () => undefined,
    fresh: () => false,
    pending: () => false,
    refetch: mocks.refetch,
  }),
  startTimer: mocks.startTimer,
  stopTimer: mocks.stopTimer,
  discardTimer: vi.fn(),
}));
vi.mock('../../queries/time-tracking-changes', () => ({
  refreshOnTimeTrackingChanges: () => undefined,
}));
vi.mock('@core/util/connectivity', () => ({
  createBrowserOfflineSignal: () => () => false,
  deviceLooksOffline: () => false,
}));

const WIREFRAMES: RunningTimer = {
  id: 'timer-1',
  taskId: 'task-1',
  startedAt: '2026-11-23T10:00:00.000Z',
  task: { __typename: 'GraphqlSoupDocument', id: 'task-1', name: 'Wireframes' },
};
const LOST = err({ kind: 'failed', error: new Error('connection closed') });

const [timer, setTimer] = createSignal<RunningTimer | undefined>();
let dispose: (() => void) | undefined;

function mountActions() {
  return createRoot((disposeRoot) => {
    dispose = disposeRoot;
    const runningTimer = createRunningTimer({
      client: () => ({}) as Client,
      enabled: () => true,
    });
    return createTimerActions({
      client: () => ({}) as Client,
      cacheHost: () => undefined,
      viewerId: () => 'macro|author@example.com',
      runningTimer,
    });
  });
}

/** Let the press, its write, the re-read and any toast run. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  setTimer(undefined);
  for (const mock of Object.values(mocks)) mock.mockReset();
});

afterEach(() => dispose?.());

it('says nothing when a start whose reply was lost did land', async () => {
  mocks.startTimer.mockResolvedValue(LOST);
  mocks.refetch.mockImplementation(async () => {
    setTimer(WIREFRAMES);
    return { error: null };
  });
  mountActions().start('task-1');
  await vi.waitFor(() => expect(mocks.refetch).toHaveBeenCalledOnce());
  await settled();
  expect(mocks.failure).not.toHaveBeenCalled();
  expect(mocks.success).not.toHaveBeenCalled();
  expect(mocks.startTimer).toHaveBeenCalledOnce();
});

it('still says a start failed when it did not land', async () => {
  mocks.startTimer.mockResolvedValue(LOST);
  mocks.refetch.mockResolvedValue({ error: null });
  mountActions().start('task-1');
  await vi.waitFor(() =>
    expect(mocks.failure).toHaveBeenCalledWith(
      'Could not change the timer. Try again.'
    )
  );
});

it('says nothing when a stop whose reply was lost did land', async () => {
  setTimer(WIREFRAMES);
  mocks.stopTimer.mockResolvedValue(LOST);
  mocks.refetch.mockImplementation(async () => {
    setTimer(undefined);
    return { error: null };
  });
  mountActions().stop();
  await vi.waitFor(() => expect(mocks.refetch).toHaveBeenCalledOnce());
  await settled();
  expect(mocks.failure).not.toHaveBeenCalled();
  expect(mocks.alert).not.toHaveBeenCalled();
  expect(mocks.success).not.toHaveBeenCalled();
});
