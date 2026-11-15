import { queryClient } from '@queries/client';
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { afterEach, expect, it, vi } from 'vitest';
import { RoutineWebhookUrl } from './components/routine-webhook-url';
import { scheduledActionKeys } from './queries/keys';
import { createRoutineWebhook } from './queries/webhook';

const client = vi.hoisted(() => ({
  getWebhook: vi.fn(),
  mintWebhook: vi.fn(),
  removeWebhook: vi.fn(),
}));
vi.mock('@service-scheduled-action/client', () => ({
  scheduledActionClient: client,
}));
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
  };
});

const WEBHOOK = { hookId: 'hook-1', createdAt: '2026-11-07T09:00:00Z' };
const URL = 'https://example.test/scheduled-action/hooks/hook-2/mrw_secret';

function Panel() {
  const webhook = createRoutineWebhook(() => 'routine');
  return <RoutineWebhookUrl state={webhook()} />;
}

function mount() {
  return render(() => (
    <QueryClientProvider client={queryClient}>
      <Panel />
    </QueryClientProvider>
  ));
}

afterEach(() => {
  queryClient.clear();
  for (const fn of Object.values(client)) fn.mockReset();
});

it('makes a URL and shows it with its secret only until the panel closes', async () => {
  client.getWebhook.mockResolvedValue(ok({}));
  client.mintWebhook.mockResolvedValue(
    ok({
      hookId: 'hook-2',
      url: URL,
      bearerUrl: 'https://example.test/scheduled-action/hooks/hook-2',
      secret: 'mrw_secret',
      createdAt: '2026-11-15T09:00:00Z',
    })
  );
  const panel = mount();

  fireEvent.click(await screen.findByRole('button', { name: 'Create URL' }));

  const shown = await screen.findByRole('textbox', { name: 'Webhook URL' });
  expect((shown as HTMLInputElement).value).toBe(URL);
  expect(screen.getByText(/won’t be shown again/)).toBeTruthy();
  panel.unmount();

  mount();
  expect(await screen.findByRole('button', { name: 'New URL' })).toBeTruthy();
  expect(screen.queryByRole('textbox', { name: 'Webhook URL' })).toBeNull();
  expect(screen.queryByText(/mrw_secret/)).toBeNull();
});

it('deletes the URL', async () => {
  client.getWebhook.mockResolvedValue(ok({ webhook: WEBHOOK }));
  client.removeWebhook.mockResolvedValue(ok(undefined));
  mount();

  fireEvent.click(await screen.findByRole('button', { name: 'Delete URL' }));

  expect(
    await screen.findByRole('button', { name: 'Create URL' })
  ).toBeTruthy();
  expect(client.removeWebhook).toHaveBeenCalledWith('routine');
});

it('keeps the URL on screen when a refetch fails', async () => {
  client.getWebhook.mockResolvedValueOnce(ok({ webhook: WEBHOOK }));
  mount();
  await screen.findByRole('button', { name: 'Delete URL' });

  client.getWebhook.mockResolvedValue(err([{ code: 'INTERNAL', message: '' }]));
  await queryClient.refetchQueries({
    queryKey: scheduledActionKeys.webhook({ scheduleId: 'routine' }).queryKey,
  });

  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect(screen.getByRole('button', { name: 'Delete URL' })).toBeTruthy();
});
