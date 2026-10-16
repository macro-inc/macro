import type { EmailReminderPage } from '@service-storage/generated/schemas/emailReminderPage';
import { cleanup, render } from '@solidjs/testing-library';
import { focusManager, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { queryClient } from '../client';
import { useEmailReminderCollection } from './email-collection';

const listReminders = vi.hoisted(() => vi.fn());
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { reminders: { listEmailReminders: listReminders } },
}));
vi.mock('../client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return {
    queryClient: new QueryClient({
      defaultOptions: {
        queries: { staleTime: 300_000, refetchOnWindowFocus: false },
      },
    }),
  };
});

const pending: EmailReminderPage = {
  items: [
    {
      threadId: 'thread',
      followup: {
        threadId: 'thread',
        linkId: 'inbox',
        reminderId: 'reminder',
        revision: 'operation',
        state: 'pending',
        condition: 'regardless',
        remindAt: '2026-10-06T20:19:00Z',
      },
    },
  ],
};

function setup() {
  const [enabled, setEnabled] = createSignal(true);
  function Collection() {
    const query = useEmailReminderCollection(() => ({
      userId: 'owner',
      enabled: enabled(),
      filters: {},
    }));
    return (
      <div>
        {query.isSuccess ? query.data.pages[0].items.length : 'loading'}
      </div>
    );
  }
  const view = render(() => (
    <QueryClientProvider client={queryClient}>
      <Collection />
    </QueryClientProvider>
  ));
  return { ...view, setEnabled };
}

beforeEach(() => {
  vi.useFakeTimers();
  listReminders
    .mockResolvedValueOnce(ok(pending))
    .mockResolvedValue(ok({ items: [] }));
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  focusManager.setFocused(undefined);
  vi.resetAllMocks();
  vi.useRealTimers();
});

it('clears a delivered reminder on focus before the polling interval', async () => {
  const { container } = setup();
  await vi.advanceTimersByTimeAsync(1);
  expect(container.textContent).toBe('1');
  focusManager.setFocused(false);
  await vi.advanceTimersByTimeAsync(1000);
  focusManager.setFocused(true);
  await vi.advanceTimersByTimeAsync(1);
  expect(container.textContent).toBe('0');
  expect(listReminders).toHaveBeenCalledTimes(2);
});

it('refetches when returning to Reminders within the global five-minute stale time', async () => {
  const { container, setEnabled } = setup();
  await vi.advanceTimersByTimeAsync(1);
  expect(container.textContent).toBe('1');
  setEnabled(false);
  await vi.advanceTimersByTimeAsync(1000);
  setEnabled(true);
  await vi.advanceTimersByTimeAsync(1);
  expect(container.textContent).toBe('0');
  expect(listReminders).toHaveBeenCalledTimes(2);
});
