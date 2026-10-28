import { queryClient } from '@queries/client';
import { schedulingClient } from '@service-email/scheduling';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { createComponent, createRoot } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { createBookingReceiptSource } from './public';

vi.mock('@service-email/scheduling', () => ({
  schedulingClient: {
    receipt: vi.fn(async () => err([{ code: 'NOT_FOUND' }])),
    replacementSlots: vi.fn(),
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
