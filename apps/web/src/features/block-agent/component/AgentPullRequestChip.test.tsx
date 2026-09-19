/** @vitest-environment jsdom */
import { queryClient } from '@queries/client';
import { handlePullRequestUpdated } from '@queries/storage/pr-mention-sync';
import { storageServiceClient } from '@service-storage/client';
import type { ForeignEntity } from '@service-storage/generated/schemas';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err } from 'neverthrow';
import { Suspense } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import {
  AgentGithubChip,
  AgentPullRequestChip,
  githubRepositoryLabel,
} from './AgentPullRequestChip';
import { pullRequestLineCounts } from './pull-request-line-counts';

const { openWithSplit } = vi.hoisted(() => {
  class FakeWebSocket {
    url: string;
    readyState = 1;
    constructor(url: string) {
      this.url = url;
    }
    close() {}
    addEventListener() {}
    removeEventListener() {}
    send() {}
  }
  vi.stubGlobal('WebSocket', FakeWebSocket);
  return { openWithSplit: vi.fn() };
});

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
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
  createConnectionWebsocketEffect: vi.fn(),
  parseWebsocketPayload: vi.fn(),
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit }),
}));
vi.mock('@core/util/useSplitNavigationHandler', () => ({
  useSplitNavigationHandler: (onClick: (event: MouseEvent) => void) => ({
    onClick,
  }),
}));
vi.mock('@core/component/HoverCard', () => ({
  HoverCard: (props: { trigger: import('solid-js').JSX.Element }) =>
    props.trigger,
}));
vi.mock(
  '@core/component/LexicalMarkdown/component/decorator/PullRequestMention',
  () => ({
    PullRequestPreviewCard: () => null,
  })
);

const url = 'https://github.com/macro-inc/macro/pull/6303';

function entity(status: string): ForeignEntity {
  return {
    id: '019f0000-0000-7000-8000-000000000001',
    foreignEntityId: 'macro-inc/macro/pull/6303',
    foreignEntitySource: 'github_pull_request',
    metadata: { status, name: 'Add the header chip', number: 6303 },
    storedForId: 'macro|wolf@macro.com',
    storedForAuthEntity: 'user',
    createdAt: '2026-09-11T00:00:00Z',
    updatedAt: '2026-09-11T00:00:00Z',
  };
}

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.useRealTimers();
  vi.clearAllMocks();
});

it('shows a GitHub fallback without suspending while the webhook mapping is pending', async () => {
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
  render(() => (
    <QueryClientProvider client={client}>
      <Suspense fallback={<span>Loading chip</span>}>
        <AgentPullRequestChip url={url} />
      </Suspense>
    </QueryClientProvider>
  ));
  const link = screen.getByRole('link');
  expect(link.getAttribute('href')).toBe(url);
  expect(link.textContent).toContain('#6303');
  expect(link.textContent).toContain('Open');
  expect(screen.queryByText('Loading chip')).toBeNull();
  resolve(
    err([{ code: 'NOT_FOUND', message: 'Not synced' }]) as Awaited<Lookup>
  );
  await waitFor(() =>
    expect(client.getQueryCache().getAll()[0].state.status).toBe('success')
  );
  expect(screen.getByRole('link').getAttribute('href')).toBe(url);
  client.clear();
});

it('opens the PR entity once synced and follows later status changes', async () => {
  vi.useFakeTimers();
  const lookup = vi.mocked(storageServiceClient.getForeignEntityBySource);
  type Lookup = ReturnType<
    typeof storageServiceClient.getForeignEntityBySource
  >;
  lookup.mockResolvedValue(
    err([{ code: 'NOT_FOUND', message: 'Not synced' }]) as Awaited<Lookup>
  );
  const client = queryClient;
  const rendered = render(() => (
    <QueryClientProvider client={client}>
      <AgentPullRequestChip url={url} />
    </QueryClientProvider>
  ));
  await vi.advanceTimersByTimeAsync(1);
  expect(screen.getByRole('link')).toBeTruthy();
  await handlePullRequestUpdated(entity('open'));
  await vi.advanceTimersByTimeAsync(1);
  expect(screen.getByRole('button').textContent).toContain('#6303');
  expect(screen.getByRole('button').textContent).toContain('Open');
  fireEvent.click(screen.getByRole('button'));
  expect(openWithSplit).toHaveBeenCalledWith(
    { type: 'pr', id: entity('open').id },
    { preferNewSplit: true }
  );
  await handlePullRequestUpdated({
    ...entity('merged'),
    metadata: { status: 'merged', name: 'Add the header chip', number: 6303 },
    updatedAt: '2026-09-11T00:01:00Z',
  });
  await vi.advanceTimersByTimeAsync(1);
  expect(screen.getByRole('button').textContent).toContain('Merged');
  rendered.unmount();
  client.clear();
});

it('reads added and deleted lines from a synced pull request', () => {
  expect(pullRequestLineCounts(entity('open'))).toBeUndefined();
  expect(
    pullRequestLineCounts({
      ...entity('open'),
      metadata: { status: 'open', additions: 12, deletions: 3 },
    })
  ).toEqual({ additions: 12, deletions: 3 });
  expect(
    pullRequestLineCounts({
      ...entity('open'),
      metadata: { status: 'open', additions: 0, deletions: 0 },
    })
  ).toBeUndefined();
  expect(pullRequestLineCounts(undefined)).toBeUndefined();
});

it('names a repository from its url or a pull request url', () => {
  expect(githubRepositoryLabel('https://github.com/macro-inc/macro.git')).toBe(
    'macro-inc/macro'
  );
  expect(githubRepositoryLabel(url)).toBe('macro-inc/macro');
});

it('shows the repository alone, then folds it into the pull request chip', async () => {
  type Lookup = ReturnType<
    typeof storageServiceClient.getForeignEntityBySource
  >;
  vi.mocked(storageServiceClient.getForeignEntityBySource).mockReturnValue(
    new Promise(() => {}) as Lookup
  );
  const client = new QueryClient();
  const rendered = render(() => (
    <QueryClientProvider client={client}>
      <AgentGithubChip repoUrl="https://github.com/macro-inc/macro" />
    </QueryClientProvider>
  ));
  const repo = screen.getByRole('link', {
    name: 'Open macro-inc/macro on GitHub',
  });
  expect(repo.getAttribute('href')).toBe('https://github.com/macro-inc/macro');
  expect(screen.queryByText('#6303')).toBeNull();
  rendered.unmount();

  render(() => (
    <QueryClientProvider client={client}>
      <AgentGithubChip
        repoUrl="https://github.com/macro-inc/macro"
        pullRequestUrl={url}
      />
    </QueryClientProvider>
  ));
  const combined = screen.getByRole('link');
  expect(combined.getAttribute('href')).toBe(url);
  expect(combined.textContent).toContain('macro-inc/macro');
  expect(combined.textContent).toContain('#6303');
  expect(combined.textContent).toContain('Open');
  expect(
    screen.queryByRole('link', { name: 'Open macro-inc/macro on GitHub' })
  ).toBeNull();
  client.clear();
});
