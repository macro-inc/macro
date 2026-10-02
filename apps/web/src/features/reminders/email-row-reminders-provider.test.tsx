import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { createEffect, createSignal, onCleanup } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { useEmailRowReminders } from './context/email-row-reminders';
import { EmailRowRemindersQueryProvider } from './email-row-reminders-provider';

const mocks = vi.hoisted(() => ({
  summary: vi.fn(),
  user: (): string => 'alice',
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => mocks.user() }));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: true }),
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    reminders: { emailReminderSummaries: mocks.summary },
  },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('batches mounted rows once per 100 IDs, coalesces duplicate registrations, and isolates accounts', async () => {
  mocks.summary.mockResolvedValue(ok([]));
  const [owner, setOwner] = createSignal('alice');
  mocks.user = owner;
  const [ids, setIds] = createSignal(
    Array.from({ length: 205 }, (_, i) => `thread-${i}`)
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Rows() {
    const reminders = useEmailRowReminders()!;
    createEffect(() => {
      const cleanups = [...ids(), ids()[0]]
        .filter(Boolean)
        .map(reminders.register);
      onCleanup(() => cleanups.forEach((stop) => stop()));
    });
    return null;
  }
  render(() => (
    <QueryClientProvider client={client}>
      <EmailRowRemindersQueryProvider>
        <Rows />
      </EmailRowRemindersQueryProvider>
    </QueryClientProvider>
  ));
  await waitFor(() => expect(mocks.summary).toHaveBeenCalledTimes(3));
  expect(
    mocks.summary.mock.calls.map(([ids]) => ids.length).sort((a, b) => a - b)
  ).toEqual([5, 100, 100]);
  expect(new Set(mocks.summary.mock.calls.flatMap(([ids]) => ids)).size).toBe(
    205
  );
  setOwner('bob');
  await waitFor(() => expect(mocks.summary).toHaveBeenCalledTimes(6));
  setIds([]);
  await new Promise((resolve) => setTimeout(resolve, 60));
  expect(mocks.summary).toHaveBeenCalledTimes(6);
  client.clear();
});
