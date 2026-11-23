import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BookingRejectedError } from '../core/booking-error';
import type { BookingReceipt } from '../core/types';
import { type BookingSource, createBookingFlow } from './booking-flow';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
describe('booking flow', () => {
  it('ignores availability that arrives after a newer date was selected', async () => {
    const first = deferred<{ startsAt: string; endsAt: string }[]>();
    const second = deferred<{ startsAt: string; endsAt: string }[]>();
    const source: BookingSource = {
      slots: vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise),
      book: vi.fn(),
    };
    const flow = createRoot(() => createBookingFlow(source, 'profile'));
    const old = flow.chooseDate('event', '2026-10-01', 'UTC');
    const current = flow.chooseDate('event', '2026-10-02', 'UTC');
    const slot = {
      startsAt: '2026-10-02T09:00:00Z',
      endsAt: '2026-10-02T09:30:00Z',
    };
    second.resolve([slot]);
    await current;
    first.resolve([]);
    await old;
    expect(flow.slots()).toEqual([slot]);
    expect(flow.loading()).toBe(false);
  });
  it('prevents a second submission while the first is pending', async () => {
    const pending = deferred<BookingReceipt>();
    const book = vi.fn().mockReturnValue(pending.promise);
    const flow = createRoot(() =>
      createBookingFlow({ slots: vi.fn(), book }, 'profile')
    );
    flow.select('2026-10-02T09:00:00Z');
    const details = {
      name: 'Guest',
      email: 'guest@example.com',
      timeZone: 'UTC',
      answers: {},
    };
    const first = flow.submit('event', details);
    await flow.submit('event', details);
    expect(book).toHaveBeenCalledTimes(1);
    pending.resolve({ token: 'token' } as BookingReceipt);
    await first;
  });
});

const DETAILS = {
  name: 'Guest',
  email: 'guest@example.com',
  timeZone: 'UTC',
  answers: {},
};

describe('a booking without an answer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resends the same request by itself and holds the time until it is answered', async () => {
    const book = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ token: 't' } as BookingReceipt);
    const flow = createRoot(() =>
      createBookingFlow({ slots: vi.fn(), book }, 'profile')
    );
    const start = '2026-10-02T09:00:00Z';
    flow.select(start);
    const submitted = flow.submit('event', DETAILS);
    await vi.advanceTimersByTimeAsync(0);
    expect(flow.finishing()).toBe(true);
    expect(flow.stalled()).toBe(false);
    expect(flow.error()).toBe('');
    flow.back();
    flow.reset();
    flow.select('2026-10-03T10:00:00Z');
    await flow.chooseDate('another-event', '2026-10-03', 'UTC');
    await flow.submit('another-event', {
      ...DETAILS,
      email: 'different@example.com',
    });
    expect(flow.selected()).toBe(start);
    expect(book).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    await submitted;
    expect(book).toHaveBeenCalledTimes(2);
    expect(book.mock.calls[1]).toEqual(book.mock.calls[0]);
    expect(flow.finishing()).toBe(false);
    expect(flow.receipt()?.token).toBe('t');
  });

  it('says it is taking longer after four unanswered retries and still finishes', async () => {
    const book = vi.fn().mockResolvedValue({ token: 't' } as BookingReceipt);
    for (let i = 0; i < 5; i++)
      book.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const flow = createRoot(() =>
      createBookingFlow({ slots: vi.fn(), book }, 'profile')
    );
    flow.select('2026-10-02T09:00:00Z');
    const submitted = flow.submit('event', DETAILS);
    await vi.advanceTimersByTimeAsync(1000 + 2000 + 4000);
    expect(book).toHaveBeenCalledTimes(4);
    expect(flow.stalled()).toBe(false);
    await vi.advanceTimersByTimeAsync(8000);
    expect(book).toHaveBeenCalledTimes(5);
    expect(flow.stalled()).toBe(true);
    expect(flow.finishing()).toBe(true);
    await vi.advanceTimersByTimeAsync(15000);
    await submitted;
    expect(book).toHaveBeenCalledTimes(6);
    expect(flow.finishing()).toBe(false);
    expect(flow.stalled()).toBe(false);
    expect(flow.receipt()?.token).toBe('t');
  });

  it('shows the reason when the server refuses the resent request', async () => {
    const book = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new BookingRejectedError('Time taken'));
    const flow = createRoot(() =>
      createBookingFlow({ slots: vi.fn(), book }, 'profile')
    );
    flow.select('2026-10-02T09:00:00Z');
    const submitted = flow.submit('event', DETAILS);
    await vi.advanceTimersByTimeAsync(1000);
    await submitted;
    expect(flow.finishing()).toBe(false);
    expect(flow.error()).toBe('Time taken');
    flow.back();
    expect(flow.selected()).toBeUndefined();
  });

  it('stops resending once the page closes', async () => {
    const book = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const { flow, dispose } = createRoot((dispose) => ({
      flow: createBookingFlow({ slots: vi.fn(), book }, 'profile'),
      dispose,
    }));
    flow.select('2026-10-02T09:00:00Z');
    const submitted = flow.submit('event', DETAILS);
    await vi.advanceTimersByTimeAsync(0);
    dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    await submitted;
    expect(book).toHaveBeenCalledTimes(1);
  });
});

it('allows a different time after a definite rejection', async () => {
  const flow = createRoot(() =>
    createBookingFlow(
      {
        slots: vi.fn(),
        book: vi.fn().mockRejectedValue(new BookingRejectedError('Time taken')),
      },
      'profile'
    )
  );
  flow.select('2026-10-02T09:00:00Z');
  await flow.submit('event', {
    name: 'Guest',
    email: 'guest@example.com',
    timeZone: 'UTC',
    answers: {},
  });
  expect(flow.finishing()).toBe(false);
  flow.back();
  expect(flow.selected()).toBeUndefined();
  flow.select('2026-10-02T10:00:00Z');
  expect(flow.selected()).toBe('2026-10-02T10:00:00Z');
});
