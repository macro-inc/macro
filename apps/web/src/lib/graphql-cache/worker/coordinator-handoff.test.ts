import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CoordinatorHandoff } from './coordinator-handoff';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('bounds foreground reads without extending the budget on candidate changes', async () => {
  const record = vi.fn();
  const onChange = vi.fn();
  const handoff = new CoordinatorHandoff({
    timeoutMs: 1000,
    setTimeout,
    clearTimeout,
    now: Date.now,
    telemetry: { record, flush() {} },
    onChange,
  });
  handoff.start(1);
  await vi.advanceTimersByTimeAsync(900);
  handoff.start(2);
  await vi.advanceTimersByTimeAsync(100);
  expect(handoff.readState).toEqual({ ownerEpoch: 2, state: 'blocked' });
  expect(onChange).toHaveBeenLastCalledWith({
    ownerEpoch: 2,
    state: 'blocked',
  });
  handoff.ready(2);
  expect(handoff.readState).toEqual({ ownerEpoch: 2, state: 'ready' });
  expect(record).toHaveBeenCalledWith(
    expect.objectContaining({
      ownerEvent: 'visibility-handoff-completed',
      durationMs: 1000,
    })
  );
});

it('parks without a background read deadline and starts a fresh foreground resume budget', async () => {
  const record = vi.fn();
  const onChange = vi.fn();
  const handoff = new CoordinatorHandoff({
    timeoutMs: 1000,
    setTimeout,
    clearTimeout,
    now: Date.now,
    telemetry: { record, flush() {} },
    onChange,
  });
  handoff.start(1, false);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(handoff.readState).toEqual({ ownerEpoch: 1, state: 'waiting' });
  expect(vi.getTimerCount()).toBe(0);
  handoff.park(1);
  handoff.park(1);
  expect(
    record.mock.calls.filter(([event]) => event.ownerEvent === 'parked')
  ).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(300_000);
  handoff.start(2, true);
  await vi.advanceTimersByTimeAsync(999);
  expect(handoff.readState?.state).toBe('waiting');
  await vi.advanceTimersByTimeAsync(1);
  expect(handoff.readState?.state).toBe('blocked');
  handoff.ready(2);
  expect(record).toHaveBeenCalledWith(
    expect.objectContaining({
      ownerEvent: 'unpark-completed',
      durationMs: 1000,
    })
  );
});

it('cancels foreground deadlines when everyone hides, but failure alone never resumes reads', async () => {
  const handoff = new CoordinatorHandoff({
    timeoutMs: 1000,
    setTimeout,
    clearTimeout,
    now: Date.now,
    telemetry: { record() {}, flush() {} },
    onChange() {},
  });
  handoff.start(1);
  await vi.advanceTimersByTimeAsync(900);
  handoff.start(1, false);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(handoff.readState?.state).toBe('waiting');
  handoff.start(1, true);
  await vi.advanceTimersByTimeAsync(1000);
  expect(handoff.readState?.state).toBe('blocked');
  handoff.cancel();
  expect(handoff.readState?.state).toBe('blocked');
  handoff.ready(2);
  expect(handoff.readState?.state).toBe('ready');
});
