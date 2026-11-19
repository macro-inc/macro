import { ThrownResultError } from '@core/util/result';
import { queryClient } from '@queries/client';
import { schedulingClient } from '@service-email/scheduling';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { createComponent, createRoot } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { RescheduleRefusedError } from '../core/booking-error';
import type { BookingReceipt } from '../core/types';
import { createBookingReceiptSource } from './public';

vi.mock('@service-email/scheduling', () => ({
  schedulingClient: {
    receipt: vi.fn(async () => err([{ code: 'NOT_FOUND' }])),
    replacementSlots: vi.fn(),
    reschedule: vi.fn(),
    cancelPublic: vi.fn(),
  },
}));
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return { queryClient: new QueryClient() };
});

it('does not share pending replacement slots across visitor time zones', async () => {
  const client = new QueryClient();
  let source!: ReturnType<typeof createBookingReceiptSource>;
  const dispose = createRoot((dispose) => {
    createComponent(QueryClientProvider, {
      client,
      get children() {
        source = createBookingReceiptSource(
          () => 'booking',
          () => 'token'
        );
        return null;
      },
    });
    return dispose;
  });
  const tokyo = [
    { startsAt: '2026-10-19T16:00:00Z', endsAt: '2026-10-19T16:30:00Z' },
  ];
  const la = [
    { startsAt: '2026-10-20T16:00:00Z', endsAt: '2026-10-20T16:30:00Z' },
  ];
  const slots = vi.mocked(schedulingClient.replacementSlots);
  slots
    .mockResolvedValueOnce(ok({ slots: tokyo }))
    .mockResolvedValueOnce(ok({ slots: la }));
  try {
    const results = await Promise.all([
      source.replacementSlots('2026-10-20', 'Asia/Tokyo'),
      source.replacementSlots('2026-10-20', 'America/Los_Angeles'),
    ]);
    expect(results).toEqual([tokyo, la]);
    expect(slots.mock.calls).toEqual([
      ['booking', 'token', '2026-10-20', 'Asia/Tokyo'],
      ['booking', 'token', '2026-10-20', 'America/Los_Angeles'],
    ]);
  } finally {
    dispose();
    client.clear();
    queryClient.clear();
  }
});

function mountSource() {
  const client = new QueryClient();
  let source!: ReturnType<typeof createBookingReceiptSource>;
  const dispose = createRoot((dispose) => {
    createComponent(QueryClientProvider, {
      client,
      get children() {
        source = createBookingReceiptSource(
          () => 'booking',
          () => 'token'
        );
        return null;
      },
    });
    return dispose;
  });
  return {
    source,
    done: () => {
      dispose();
      client.clear();
      queryClient.clear();
    },
  };
}

const confirmed: BookingReceipt = {
  token: 'token',
  scheduleTimeZone: 'UTC',
  booking: {
    id: 'booking',
    eventTypeId: 'intro',
    title: 'Introduction',
    name: 'Alex Morgan',
    email: 'alex@example.com',
    startsAt: '2026-10-19T16:00:00Z',
    endsAt: '2026-10-19T16:30:00Z',
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

it.each([
  [422, true],
  [400, false],
  [503, false],
])(
  'treats only a %i reschedule as the host calendar refusing it',
  async (status, refused) => {
    const { source, done } = mountSource();
    vi.mocked(schedulingClient.reschedule).mockResolvedValueOnce(
      err([{ code: 'HTTP_ERROR', message: `HTTP error! status: ${status}` }])
    );
    try {
      const outcome = source.reschedule('2026-10-19T17:00:00Z');
      await expect(outcome).rejects.toBeInstanceOf(
        refused ? RescheduleRefusedError : ThrownResultError
      );
    } finally {
      done();
    }
  }
);

it('keeps a cancellation on the receipt when the refresh after it fails', async () => {
  let failing = false;
  vi.mocked(schedulingClient.receipt).mockImplementation(async () =>
    failing
      ? err([{ code: 'HTTP_ERROR', message: 'HTTP error! status: 503' }])
      : ok(confirmed)
  );
  vi.mocked(schedulingClient.cancelPublic).mockResolvedValueOnce(
    ok({ booking: { ...confirmed.booking, status: 'cancelled' } })
  );
  const { source, done } = mountSource();
  try {
    await source.receipt.refetch();
    expect(source.receipt.data?.booking.status).toBe('confirmed');
    failing = true;
    await source.cancel();
    expect(source.receipt.isError).toBe(true);
    expect(source.receipt.data?.booking.status).toBe('cancelled');
  } finally {
    vi.mocked(schedulingClient.receipt).mockImplementation(async () =>
      err([{ code: 'NOT_FOUND', message: 'Not found' }])
    );
    done();
  }
});

it('reads the receipt back when a cancellation’s response is lost', async () => {
  let landed = false;
  vi.mocked(schedulingClient.receipt).mockImplementation(async () =>
    ok(
      landed
        ? {
            ...confirmed,
            booking: { ...confirmed.booking, status: 'cancelled' },
          }
        : confirmed
    )
  );
  vi.mocked(schedulingClient.cancelPublic).mockImplementationOnce(async () => {
    landed = true;
    return err([{ code: 'HTTP_ERROR', message: 'HTTP error! status: 504' }]);
  });
  const { source, done } = mountSource();
  try {
    await source.receipt.refetch();
    await expect(source.cancel()).rejects.toBeInstanceOf(ThrownResultError);
    expect(source.receipt.data?.booking.status).toBe('cancelled');
  } finally {
    vi.mocked(schedulingClient.receipt).mockImplementation(async () =>
      err([{ code: 'NOT_FOUND', message: 'Not found' }])
    );
    done();
  }
});
