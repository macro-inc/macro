import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
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
  it('retries a failed submission with the same idempotency key', async () => {
    const receipt = { token: 'token' } as BookingReceipt;
    const book = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(receipt);
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
    await flow.submit('event', details);
    await flow.submit('event', details);
    expect(book.mock.calls[0][2].requestId).toEqual(
      book.mock.calls[1][2].requestId
    );
    expect(flow.receipt()).toBe(receipt);
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

it('holds the original request across navigation and edited details after an uncertain response', async () => {
  const book = vi
    .fn()
    .mockRejectedValueOnce(new Error('lost response'))
    .mockResolvedValueOnce({ token: 't' } as BookingReceipt);
  const flow = createRoot(() =>
    createBookingFlow({ slots: vi.fn(), book }, 'profile')
  );
  const start = '2026-10-02T09:00:00Z';
  flow.select(start);
  const details = {
    name: 'Guest',
    email: 'guest@example.com',
    timeZone: 'UTC',
    answers: {},
  };
  await flow.submit('event', details);
  expect(flow.uncertain()).toBe(true);
  flow.back();
  flow.reset();
  flow.select('2026-10-03T10:00:00Z');
  await flow.chooseDate('another-event', '2026-10-03', 'UTC');
  expect(flow.selected()).toBe(start);
  await flow.submit('another-event', {
    ...details,
    email: 'different@example.com',
  });
  expect(book.mock.calls[1]).toEqual(book.mock.calls[0]);
  expect(flow.uncertain()).toBe(false);
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
  expect(flow.uncertain()).toBe(false);
  flow.back();
  expect(flow.selected()).toBeUndefined();
  flow.select('2026-10-02T10:00:00Z');
  expect(flow.selected()).toBe('2026-10-02T10:00:00Z');
});
