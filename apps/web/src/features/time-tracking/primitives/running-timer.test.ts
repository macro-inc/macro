import type { Client } from '@urql/core';
import { err, ok } from 'neverthrow';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TimeTrackingChange } from '../queries/time-tracking-changes';
import type { RunningTimer } from '../queries/timer';
import { createRunningTimer } from './running-timer';

const STARTED = '2026-11-23T10:00:00.000Z';
const TIMER: RunningTimer = {
  id: 'timer-1',
  taskId: 'task-1',
  startedAt: STARTED,
  task: { __typename: 'GraphqlSoupDocument', id: 'task-1', name: 'Wireframes' },
};

const query = vi.hoisted(() => ({
  refetch: vi.fn(),
  startTimer: vi.fn(),
  onChange: undefined as
    | ((change: TimeTrackingChange) => Promise<unknown>)
    | undefined,
}));
const [timer, setTimer] = createSignal<RunningTimer | undefined>();
const [serverNow, setServerNow] = createSignal<string | undefined>();
const [fresh, setFresh] = createSignal(false);
let offline = false;

vi.mock('../queries/timer', () => ({
  createRunningTimerQuery: () => ({
    timer,
    serverNow,
    fresh,
    pending: () => false,
    refetch: query.refetch,
  }),
  startTimer: query.startTimer,
  stopTimer: vi.fn(),
  discardTimer: vi.fn(),
}));
vi.mock('../queries/time-tracking-changes', () => ({
  refreshOnTimeTrackingChanges: (
    onChange: (change: TimeTrackingChange) => Promise<unknown>
  ) => {
    query.onChange = onChange;
  },
}));
vi.mock('@core/util/connectivity', () => ({
  createBrowserOfflineSignal: () => () => offline,
  deviceLooksOffline: () => offline,
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-23T10:10:00.000Z'));
  setTimer(undefined);
  setServerNow(undefined);
  setFresh(false);
  offline = false;
  query.refetch.mockReset();
  query.startTimer.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

let dispose: (() => void) | undefined;

afterEach(() => dispose?.());

/** The timer's state, set up in a root whose effects have already run. */
function mountTimer() {
  return createRoot((disposeRoot) => {
    dispose = disposeRoot;
    return createRunningTimer({
      client: () => ({}) as Client,
      enabled: () => true,
    });
  });
}

it('counts on the server clock taken from a fresh reply', () => {
  const state = mountTimer();
  setTimer(TIMER);
  expect(state.seconds()).toBe(600);
  setServerNow('2026-11-23T10:10:05.000Z');
  setFresh(true);
  expect(state.seconds()).toBe(605);
  vi.advanceTimersByTime(2_000);
  expect(state.seconds()).toBe(607);
});

it('ignores the clock in a cached copy', () => {
  const state = mountTimer();
  setTimer(TIMER);
  setServerNow('2026-11-23T08:00:00.000Z');
  expect(state.seconds()).toBe(600);
});

it('refuses timer writes offline without asking the server', async () => {
  offline = true;
  const result = await mountTimer().start({ taskId: 'task-1' });
  expect(result.isErr() && result.error).toMatchObject({
    kind: 'refused',
    code: 'OFFLINE',
  });
  expect(query.startTimer).not.toHaveBeenCalled();
});

it('starts through the server when online', async () => {
  query.startTimer.mockResolvedValue(
    ok({ kind: 'committed', data: undefined })
  );
  const result = await mountTimer().start({ taskId: 'task-1' });
  expect(result.isOk()).toBe(true);
  expect(query.startTimer).toHaveBeenCalledWith(
    { taskId: 'task-1' },
    expect.anything()
  );
});

it('refuses a second timer change while one is in flight', async () => {
  let finish: (value: unknown) => void = () => undefined;
  query.startTimer.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const state = mountTimer();
  const first = state.start({ taskId: 'task-1' });
  const second = await state.start({ taskId: 'task-2' });
  expect(second.isErr() && second.error).toMatchObject({ code: 'BUSY' });
  expect(state.busy()).toBe(true);
  finish(ok({ kind: 'committed', data: undefined }));
  await first;
  expect(state.busy()).toBe(false);
  expect(query.startTimer).toHaveBeenCalledOnce();
});

it('reads the current time even while no timer runs', () => {
  const state = mountTimer();
  vi.setSystemTime(new Date('2026-11-23T11:10:00.000Z'));
  expect(state.now()).toBe(Date.parse('2026-11-23T11:10:00.000Z'));
});

it('shows the timer the server holds after a start whose reply is lost', async () => {
  query.startTimer.mockResolvedValue(
    err({ kind: 'failed', error: new Error('network') })
  );
  query.refetch.mockImplementation(async () => {
    setTimer(TIMER);
  });
  const state = mountTimer();
  const pressed = state.start({ taskId: 'task-1' });
  const again = await state.start({ taskId: 'task-1' });
  await pressed;
  expect(state.timer()).toEqual(TIMER);
  expect(again.isErr() && again.error).toMatchObject({ code: 'BUSY' });
  expect(query.startTimer).toHaveBeenCalledOnce();
});

it('does not re-read after a refusal the server answered', async () => {
  query.startTimer.mockResolvedValue(
    err({ kind: 'refused', code: 'FORBIDDEN', message: 'no' })
  );
  await mountTimer().start({ taskId: 'task-1' });
  expect(query.refetch).not.toHaveBeenCalled();
});

it('re-reads the timer when another session changes it', async () => {
  mountTimer();
  await query.onChange?.({ timer: false, taskId: 'task-1' });
  expect(query.refetch).not.toHaveBeenCalled();
  await query.onChange?.({ timer: true, taskId: null });
  expect(query.refetch).toHaveBeenCalledOnce();
});
