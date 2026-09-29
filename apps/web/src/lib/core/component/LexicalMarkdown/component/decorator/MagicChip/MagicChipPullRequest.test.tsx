/** @vitest-environment jsdom */
import { queryClient } from '@queries/client';
import { handlePullRequestUpdated } from '@queries/storage/pr-mention-sync';
import { storageServiceClient } from '@service-storage/client';
import type { ForeignEntity } from '@service-storage/generated/schemas';
import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err } from 'neverthrow';
import { Suspense } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { MagicChipPullRequest } from './MagicChipPullRequest';

vi.mock('@queries/agent-session/list-sync', () => ({
  refreshAgentSessionLists: vi.fn(async () => {}),
}));

vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
  };
});

vi.mock('@service-storage/client', () => ({
  storageServiceClient: { getForeignEntityBySource: vi.fn() },
}));
const openWithSplit = vi.fn();
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit }),
}));

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.useRealTimers();
  vi.clearAllMocks();
});

it('shows a PR link without suspending while the webhook mapping is pending or missing', async () => {
  type Lookup = ReturnType<
    typeof storageServiceClient.getForeignEntityBySource
  >;
  let resolve!: (value: Awaited<Lookup>) => void;
  vi.mocked(storageServiceClient.getForeignEntityBySource).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }) as Lookup
  );
  const client = new QueryClient();
  const url = 'https://github.com/macro-inc/macro/pull/6369';
  render(() => (
    <QueryClientProvider client={client}>
      <Suspense fallback={<span>Loading chip</span>}>
        <MagicChipPullRequest url={url} />
      </Suspense>
    </QueryClientProvider>
  ));
  expect(screen.getByRole('link').getAttribute('href')).toBe(url);
  expect(screen.queryByText('Loading chip')).toBeNull();
  resolve(
    err([{ code: 'NOT_FOUND', message: 'Not synced' }]) as Awaited<Lookup>
  );
  await waitFor(() =>
    expect(client.getQueryCache().getAll()[0].state.status).toBe('success')
  );
  expect(client.getQueryCache().getAll()[0].state.data).toBeNull();
  expect(screen.getByRole('link').getAttribute('href')).toBe(url);
  client.clear();
});

it('keeps an already mounted chip current through late sync and merge', async () => {
  vi.useFakeTimers();
  const lookup = vi.mocked(storageServiceClient.getForeignEntityBySource);
  type Lookup = ReturnType<
    typeof storageServiceClient.getForeignEntityBySource
  >;
  const entity: ForeignEntity = {
    id: '019f0000-0000-7000-8000-000000000001',
    foreignEntityId: 'macro-inc/macro/pull/6369',
    foreignEntitySource: 'github_pull_request',
    metadata: {
      status: 'open',
      name: 'Fix reply state',
      additions: 42,
      deletions: 0,
    },
    storedForId: 'macro|wolf@macro.com',
    storedForAuthEntity: 'user',
    createdAt: '2026-09-11T00:00:00Z',
    updatedAt: '2026-09-11T00:00:00Z',
  };
  lookup.mockResolvedValue(
    err([{ code: 'NOT_FOUND', message: 'Not synced' }]) as Awaited<Lookup>
  );
  const client = queryClient;
  const rendered = render(() => (
    <QueryClientProvider client={client}>
      <MagicChipPullRequest url="https://github.com/macro-inc/macro/pull/6369" />
    </QueryClientProvider>
  ));
  await vi.advanceTimersByTimeAsync(1);
  // A webhook can arrive after the old ten-minute polling cutoff.
  await vi.advanceTimersByTimeAsync(11 * 60_000);
  expect(screen.getByRole('link')).toBeTruthy();
  expect(lookup).toHaveBeenCalledTimes(1);
  await handlePullRequestUpdated(entity);
  await vi.advanceTimersByTimeAsync(1);
  expect(
    screen.getByRole('button', { name: '#6369 · Fix reply state' })
  ).toBeTruthy();
  expect(screen.getByLabelText('42 lines added')).toBeTruthy();
  expect(screen.getByLabelText('0 lines deleted')).toBeTruthy();
  await handlePullRequestUpdated({
    ...entity,
    metadata: {
      status: 'merged',
      name: 'Fix reply state',
      additions: 48,
      deletions: 2,
    },
    updatedAt: '2026-09-11T00:01:00Z',
  });
  await vi.advanceTimersByTimeAsync(1);
  expect(screen.getByLabelText('48 lines added')).toBeTruthy();
  expect(screen.getByLabelText('2 lines deleted')).toBeTruthy();
  screen.getByRole('button', { name: '#6369 · Fix reply state' }).click();
  expect(openWithSplit).toHaveBeenCalledWith(
    { type: 'pr', id: entity.id },
    expect.any(Object)
  );
  rendered.unmount();
  const calls = lookup.mock.calls.length;
  await vi.advanceTimersByTimeAsync(30_000);
  expect(lookup).toHaveBeenCalledTimes(calls);
  client.clear();
});
