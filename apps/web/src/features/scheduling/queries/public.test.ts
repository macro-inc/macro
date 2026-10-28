import { schedulingClient } from '@service-email/scheduling';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { createComponent, createRoot } from 'solid-js';
import { expect, it, vi } from 'vitest';
import type { BookingReceipt } from '../core/types';
import { createBookingFlow } from '../primitives/booking-flow';
import { createPublicBookingSource } from './public';

vi.mock('@service-email/scheduling', () => ({
  schedulingClient: { book: vi.fn() },
}));
vi.mock('@queries/client', () => ({ queryClient: {} }));

it('preserves uncertain retries but unlocks rejected requests', async () => {
  const client = new QueryClient();
  let flow!: ReturnType<typeof createBookingFlow>;
  const dispose = createRoot((dispose) => {
    createComponent(QueryClientProvider, {
      client,
      get children() {
        flow = createBookingFlow(createPublicBookingSource(), 'profile');
        return null;
      },
    });
    return dispose;
  });
  try {
    const receipt: BookingReceipt = {
      token: 'private-token',
      scheduleTimeZone: 'UTC',
      booking: {
        id: 'booking',
        eventTypeId: 'event',
        title: 'Meeting',
        name: 'Guest',
        email: 'guest@example.com',
        startsAt: '2026-10-03T09:00:00Z',
        endsAt: '2026-10-03T09:30:00Z',
        timeZone: 'UTC',
        hosts: ['host'],
        status: 'confirmed',
        attendance: 'unknown',
        rescheduleCount: 0,
        rescheduledAt: null,
        location: '',
        answers: {},
      },
    };
    const book = vi.mocked(schedulingClient.book);
    book
      .mockResolvedValueOnce(ok(JSON.parse('{}')))
      .mockResolvedValueOnce(ok(receipt));
    flow.select(receipt.booking.startsAt);
    const details = {
      name: 'Guest',
      email: 'guest@example.com',
      timeZone: 'UTC',
      answers: {},
    };
    await flow.submit('event', details);
    expect(flow.uncertain()).toBe(true);
    expect(flow.receipt()).toBeUndefined();
    await flow.submit('event', details);
    expect(book.mock.calls[1]).toEqual(book.mock.calls[0]);
    expect(flow.receipt()).toEqual(receipt);
    expect(flow.uncertain()).toBe(false);
    for (const status of [413, 422]) {
      flow.reset();
      flow.select(receipt.booking.startsAt);
      book.mockResolvedValueOnce(
        err([{ code: 'HTTP_ERROR', message: `HTTP error! status: ${status}` }])
      );
      await flow.submit('event', details);
      expect(flow.uncertain()).toBe(false);
      flow.back();
      expect(flow.selected()).toBeUndefined();
    }
  } finally {
    dispose();
    client.clear();
  }
});
