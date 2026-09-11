/** @vitest-environment jsdom */
import { storageServiceClient } from '@service-storage/client';
import type { ForeignEntity } from '@service-storage/generated/schemas';
import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { Suspense } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { MagicChipPullRequest } from './MagicChipPullRequest';

vi.mock('@service-storage/client', () => ({
  storageServiceClient: { getForeignEntityBySource: vi.fn() },
}));
vi.mock(
  '@core/component/LexicalMarkdown/component/decorator/PullRequestMention',
  () => ({
    PullRequestEntityLink: (props: { entity: ForeignEntity }) => (
      <span>{(props.entity.metadata as { status: string }).status}</span>
    ),
  })
);

afterEach(() => {
  cleanup();
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
    id: 'pr-entity',
    foreignEntityId: 'macro-inc/macro/pull/6369',
    foreignEntitySource: 'github_pull_request',
    metadata: { status: 'open' },
    storedForId: 'macro|wolf@macro.com',
    storedForAuthEntity: 'user',
    createdAt: '2026-09-11T00:00:00Z',
    updatedAt: '2026-09-11T00:00:00Z',
  };
  lookup.mockResolvedValue(
    err([{ code: 'NOT_FOUND', message: 'Not synced' }]) as Awaited<Lookup>
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const rendered = render(() => (
    <QueryClientProvider client={client}>
      <MagicChipPullRequest url="https://github.com/macro-inc/macro/pull/6369" />
    </QueryClientProvider>
  ));
  await vi.advanceTimersByTimeAsync(1);
  // A webhook can arrive after the old ten-minute polling cutoff.
  await vi.advanceTimersByTimeAsync(11 * 60_000);
  expect(screen.getByRole('link')).toBeTruthy();
  lookup.mockResolvedValue(ok(entity) as Awaited<Lookup>);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(screen.getByText('open')).toBeTruthy();
  lookup.mockResolvedValue(
    ok({ ...entity, metadata: { status: 'merged' } }) as Awaited<Lookup>
  );
  await vi.advanceTimersByTimeAsync(15_000);
  expect(screen.getByText('merged')).toBeTruthy();
  rendered.unmount();
  const calls = lookup.mock.calls.length;
  await vi.advanceTimersByTimeAsync(30_000);
  expect(lookup).toHaveBeenCalledTimes(calls);
  client.clear();
});
