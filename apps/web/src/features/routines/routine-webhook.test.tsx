import { queryClient } from '@queries/client';
import { render, screen, waitFor } from '@solidjs/testing-library';
import { QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { afterEach, expect, it, vi } from 'vitest';
import { RoutineWebhookUrl } from './components/routine-webhook-url';
import { scheduledActionKeys } from './queries/keys';
import { createRoutineWebhook } from './queries/webhook';

const getWebhook = vi.hoisted(() => vi.fn());
vi.mock('@service-scheduled-action/client', () => ({
  scheduledActionClient: { getWebhook },
  routineWebhookUrl: (token: string) => `https://example.test/${token}`,
}));
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
  };
});

const WEBHOOK = {
  routineId: 'routine',
  tokenPrefix: 'mrw_000000000000',
  createdAt: '2026-11-07T09:00:00Z',
};

function Panel(props: { enabled: boolean }) {
  const webhook = createRoutineWebhook(
    () => 'routine',
    () => props.enabled
  );
  return <RoutineWebhookUrl state={webhook()} />;
}

function mount(enabled: boolean) {
  return render(() => (
    <QueryClientProvider client={queryClient}>
      <Panel enabled={enabled} />
    </QueryClientProvider>
  ));
}

afterEach(() => {
  queryClient.clear();
  getWebhook.mockReset();
});

it('loads the URL while its panel shows, before any trigger is saved', async () => {
  getWebhook.mockResolvedValue(err([{ code: 'NOT_FOUND', message: '' }]));

  mount(false);

  expect(
    await screen.findByRole('button', { name: 'Create URL' })
  ).toBeTruthy();
});

it('keeps the URL on screen when a refetch fails', async () => {
  getWebhook.mockResolvedValueOnce(ok(WEBHOOK));
  mount(true);
  await screen.findByRole('button', { name: 'Delete URL' });

  getWebhook.mockResolvedValue(err([{ code: 'INTERNAL', message: '' }]));
  await queryClient.refetchQueries({
    queryKey: scheduledActionKeys.webhook({ scheduleId: 'routine' }).queryKey,
  });

  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect(screen.getByRole('button', { name: 'Delete URL' })).toBeTruthy();
});
