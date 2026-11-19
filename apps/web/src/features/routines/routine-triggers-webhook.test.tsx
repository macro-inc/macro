import { queryClient } from '@queries/client';
import { fireEvent, render, screen, within } from '@solidjs/testing-library';
import { QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { afterEach, expect, it, vi } from 'vitest';
import type { RoutineTriggerDraft } from './core/routine-triggers';
import { RoutineTriggers } from './routine-triggers';

const host = vi.hoisted(() => ({
  flags: new Set<string>(),
  getWebhook: vi.fn(),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: (flag: { key: string }) => () => ({
    enabled: host.flags.has(flag.key),
    loading: false,
  }),
}));
vi.mock('@service-scheduled-action/client', () => ({
  scheduledActionClient: {
    getWebhook: host.getWebhook,
    mintWebhook: vi.fn(),
    removeWebhook: vi.fn(),
  },
}));
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
  };
});
vi.mock('./queries/github-link', () => ({
  createGithubConnection: () => () => ({
    linked: undefined,
    connecting: false,
    connect: vi.fn(),
  }),
}));
vi.mock('./queries/github-repositories', () => ({
  createGithubRepositoryOptions: () => () => [],
}));

const SAVED: RoutineTriggerDraft[] = [
  { id: 'hook', kind: 'event', events: ['webhook'] },
];

function openSavedWebhook() {
  render(() => (
    <QueryClientProvider client={queryClient}>
      <RoutineTriggers
        triggers={SAVED}
        onChange={() => {}}
        routineId="routine"
      />
    </QueryClientProvider>
  ));
  fireEvent.click(
    screen.getByRole('button', { name: 'URL for Webhook received' })
  );
  return screen.getByRole('dialog', { name: 'Edit trigger' });
}

afterEach(() => {
  queryClient.clear();
  host.flags.clear();
  host.getWebhook.mockReset();
});

it('reads the saved trigger’s URL while webhooks are on', async () => {
  host.flags.add('enable-routine-webhooks');
  host.getWebhook.mockResolvedValue(ok({}));
  const panel = openSavedWebhook();
  expect(
    await within(panel).findByRole('button', { name: 'Create URL' })
  ).toBeTruthy();
  expect(host.getWebhook).toHaveBeenCalledWith('routine');
});

it('says a saved trigger doesn’t run while webhooks are off, and reads no URL', () => {
  const panel = openSavedWebhook();
  expect(
    within(panel).getByText(/Webhooks aren’t available on your account/)
  ).toBeTruthy();
  expect(
    within(panel).queryByRole('button', { name: 'Create URL' })
  ).toBeNull();
  expect(host.getWebhook).not.toHaveBeenCalled();
});
