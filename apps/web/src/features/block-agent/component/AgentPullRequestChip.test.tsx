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
import { AgentPullRequestChip } from './AgentPullRequestChip';

vi.mock('@queries/agent-session/list-sync', () => ({
  refreshAgentSessionLists: vi.fn(async () => {}),
}));

const { openWithSplit, openExternalUrl } = vi.hoisted(() => {
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
  return { openWithSplit: vi.fn(), openExternalUrl: vi.fn() };
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
vi.mock('@core/util/url', () => ({ openExternalUrl }));
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
  expect(link.textContent).toBe('#6303');
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

it('opens the synced PR on GitHub and follows later status changes', async () => {
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
  expect(openExternalUrl).toHaveBeenCalledWith(url);
  expect(openWithSplit).not.toHaveBeenCalled();
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

it('shows only the number, with a neutral icon, when GitHub has not synced the PR', async () => {
  vi.useFakeTimers();
  type Lookup = ReturnType<
    typeof storageServiceClient.getForeignEntityBySource
  >;
  vi.mocked(storageServiceClient.getForeignEntityBySource).mockResolvedValue(
    err([{ code: 'NOT_FOUND', message: 'Not synced' }]) as Awaited<Lookup>
  );
  render(() => (
    <QueryClientProvider client={queryClient}>
      <AgentPullRequestChip url={url} />
    </QueryClientProvider>
  ));
  await vi.advanceTimersByTimeAsync(1);

  const link = screen.getByRole('link');
  expect(link.getAttribute('href')).toBe(url);
  expect(link.textContent).toBe('#6303');
  expect(link.querySelector('svg')?.getAttribute('class')).toContain(
    'text-ink-muted'
  );
  expect(link.querySelector('.text-success')).toBeNull();
});

it.each([
  ['open', 'Open', 'text-success'],
  ['merged', 'Merged', 'text-note'],
  ['closed', 'Closed', 'text-failure'],
])('shows a synced %s PR as %s', async (status, word, color) => {
  vi.useFakeTimers();
  type Lookup = ReturnType<
    typeof storageServiceClient.getForeignEntityBySource
  >;
  vi.mocked(storageServiceClient.getForeignEntityBySource).mockResolvedValue(
    err([{ code: 'NOT_FOUND', message: 'Not synced' }]) as Awaited<Lookup>
  );
  render(() => (
    <QueryClientProvider client={queryClient}>
      <AgentPullRequestChip url={url} />
    </QueryClientProvider>
  ));
  await handlePullRequestUpdated(entity(status));
  await vi.advanceTimersByTimeAsync(1);

  const chip = screen.getByRole('button');
  expect(chip.textContent).toBe(`#6303${word}`);
  expect(screen.getByText(word).getAttribute('class')).toContain(color);
});

it('shows a synced PR without a status the same neutral way', async () => {
  vi.useFakeTimers();
  type Lookup = ReturnType<
    typeof storageServiceClient.getForeignEntityBySource
  >;
  vi.mocked(storageServiceClient.getForeignEntityBySource).mockResolvedValue(
    err([{ code: 'NOT_FOUND', message: 'Not synced' }]) as Awaited<Lookup>
  );
  render(() => (
    <QueryClientProvider client={queryClient}>
      <AgentPullRequestChip url={url} />
    </QueryClientProvider>
  ));
  await handlePullRequestUpdated({
    ...entity('open'),
    metadata: { name: 'Add the header chip', number: 6303 },
  });
  await vi.advanceTimersByTimeAsync(1);

  const chip = screen.getByRole('button');
  expect(chip.textContent).toBe('#6303');
  expect(chip.querySelector('svg')?.getAttribute('class')).toContain(
    'text-ink-muted'
  );
});
