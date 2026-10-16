import {
  LiveQuery,
  withLiveQueryData,
} from '@graphql-cache/exchange/live-query';
import { cleanup, render } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import {
  type Client,
  createClient,
  type Exchange,
  type Operation,
  type OperationResult,
} from '@urql/core';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { filter, makeSubject, mergeMap, onEnd, pipe, takeUntil } from 'wonka';
import type { AgentSessionMentionPreview } from './mention-types';

const mocks = vi.hoisted(() => ({
  client: undefined as Client | undefined,
  rest: vi.fn(),
  rename: vi.fn(),
  delete: vi.fn(),
}));
vi.mock('@service-agent-harness/client', () => ({
  agentHarnessServiceClient: { rename: mocks.rename, delete: mocks.delete },
}));
vi.mock('@queries/soup/cache', () => ({ invalidateAllSoup: vi.fn() }));
vi.mock('./list-sync', () => ({ refreshAgentSessionLists: async () => {} }));
vi.mock('@queries/client', () => ({
  queryClient: {
    invalidateQueries: async () => {},
    cancelQueries: async () => {},
  },
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: true }),
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => mocks.client,
}));
vi.mock('./mention-fetchers', async (original) => ({
  ...(await original<typeof import('./mention-fetchers')>()),
  fetchAgentSessionMentionPreviews: mocks.rest,
}));

import { useAgentSessionMentionPreview } from './mentions';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function setup() {
  const requests: {
    operation: Operation;
    subject: ReturnType<typeof makeSubject<OperationResult>>;
    ended: ReturnType<typeof vi.fn>;
  }[] = [];
  const exchange: Exchange = () => (source) =>
    pipe(
      source,
      filter((operation) => operation.kind === 'query'),
      mergeMap((operation) => {
        const subject = makeSubject<OperationResult>();
        const ended = vi.fn();
        requests.push({ operation, subject, ended });
        return pipe(
          subject.source,
          takeUntil(
            pipe(
              source,
              filter(
                (next) => next.kind === 'teardown' && next.key === operation.key
              )
            )
          ),
          onEnd(ended)
        );
      })
    );
  mocks.client = createClient({
    url: 'http://test.invalid',
    exchanges: [exchange],
  });
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const session = (id: string, name: string) => ({
    __typename: 'GraphqlSoupAgentSession',
    id,
    name,
    ownerId: 'viewer',
    botId: 'bot',
    bot: null,
    status: 'no_messages',
    createdAt: '',
    updatedAt: '',
  });
  const data = (...items: ReturnType<typeof session>[]) => ({
    user: { id: 'viewer', soup: { items } },
  });
  return { requests, cache, session, data };
}

function Mention(props: { id: string; enabled?: boolean }) {
  const query = useAgentSessionMentionPreview(
    () => props.id,
    () => props.enabled ?? true
  );
  const label = () => {
    const value = query.isSuccess ? query.data : undefined;
    return value?.access === 'access'
      ? `${value.data.name}:${value.data.status.kind}`
      : (value?.access ?? 'pending');
  };
  return <span data-testid={props.id}>{label()}</span>;
}

it('batches mounted mentions and follows held live records without another query emission', async () => {
  const { requests, cache, session, data } = setup();
  const view = render(() => (
    <QueryClientProvider client={cache}>
      <Mention id="a" />
      <Mention id="a" />
      <Mention id="b" />
    </QueryClientProvider>
  ));
  await vi.waitFor(() => expect(requests).toHaveLength(1));
  const live = new LiveQuery(
    data(session('a', 'First'), session('b', 'Second'))
  );
  requests[0].subject.next(
    withLiveQueryData(
      {
        operation: requests[0].operation,
        data: live.snapshot,
        stale: false,
        hasNext: false,
      },
      live.data
    )
  );
  await vi.waitFor(() =>
    expect(view.getAllByTestId('a').map((node) => node.textContent)).toEqual([
      'First:no_messages',
      'First:no_messages',
    ])
  );
  live.replace(
    data(
      { ...session('a', 'Renamed'), status: 'disconnected' },
      session('b', 'Second')
    )
  );
  expect(view.getAllByTestId('a').map((node) => node.textContent)).toEqual([
    'Renamed:disconnected',
    'Renamed:disconnected',
  ]);
  expect(view.getByTestId('b').textContent).toBe('Second:no_messages');
  expect(requests).toHaveLength(1);
  expect(mocks.rest).not.toHaveBeenCalled();
  view.unmount();
  await vi.waitFor(() => expect(requests[0].ended).toHaveBeenCalledOnce());
  cache.clear();
});

it('uses fresh permission-aware fallback after a live record disappears', async () => {
  const { requests, cache, session, data } = setup();
  mocks.rest.mockResolvedValue(
    new Map<string, AgentSessionMentionPreview>([
      ['a', { access: 'no_access' }],
    ])
  );
  const view = render(() => (
    <QueryClientProvider client={cache}>
      <Mention id="a" />
    </QueryClientProvider>
  ));
  await vi.waitFor(() => expect(requests).toHaveLength(1));
  const live = new LiveQuery(data(session('a', 'Before')));
  requests[0].subject.next(
    withLiveQueryData(
      {
        operation: requests[0].operation,
        data: live.snapshot,
        stale: false,
        hasNext: false,
      },
      live.data
    )
  );
  await vi.waitFor(() =>
    expect(view.getByTestId('a').textContent).toBe('Before:no_messages')
  );
  live.replace(data());
  await vi.waitFor(() =>
    expect(view.getByTestId('a').textContent).toBe('no_access')
  );
  expect(mocks.rest).toHaveBeenCalledWith(['a'], false);
  cache.clear();
});

it('releases disabled mentions and ignores late updates to their old batch', async () => {
  const { requests, cache, session, data } = setup();
  const [enabled, setEnabled] = createSignal(true);
  const view = render(() => (
    <QueryClientProvider client={cache}>
      <Mention id="a" enabled={enabled()} />
    </QueryClientProvider>
  ));
  await vi.waitFor(() => expect(requests).toHaveLength(1));
  setEnabled(false);
  requests[0].subject.next({
    operation: requests[0].operation,
    data: data(session('a', 'Late')),
    stale: false,
    hasNext: false,
  });
  expect(view.getByTestId('a').textContent).toBe('pending');
  expect(mocks.rest).not.toHaveBeenCalled();
  cache.clear();
});

import { ok } from 'neverthrow';
import { refreshActiveGraphqlPreviewQueries } from '../preview/active-queries';
import { deleteAgentSession, renameAgentSession } from './entity-mutations';
import { invalidateAgentSessionMetadata } from './session-metadata-sync';

it('refreshes uncached live mentions after rename, deletion, and reconnect', async () => {
  const { requests, cache, session, data } = setup();
  mocks.rename.mockResolvedValue(ok(undefined));
  mocks.delete.mockResolvedValue(ok(undefined));
  mocks.rest.mockResolvedValue(
    new Map<string, AgentSessionMentionPreview>([
      ['a', { access: 'does_not_exist' }],
    ])
  );
  const view = render(() => (
    <QueryClientProvider client={cache}>
      <Mention id="a" />
    </QueryClientProvider>
  ));
  const reply = (index: number, value: unknown) =>
    requests[index].subject.next({
      operation: requests[index].operation,
      data: value,
      stale: false,
      hasNext: false,
    });
  await vi.waitFor(() => expect(requests).toHaveLength(1));
  reply(0, data(session('a', 'Before')));
  await renameAgentSession('a', 'After');
  await vi.waitFor(() => expect(requests).toHaveLength(2));
  reply(1, data(session('a', 'After')));
  await vi.waitFor(() =>
    expect(view.getByTestId('a').textContent).toBe('After:no_messages')
  );
  const recovery = invalidateAgentSessionMetadata();
  await vi.waitFor(() => expect(requests).toHaveLength(3));
  reply(2, data(session('a', 'Recovered')));
  await recovery;
  expect(view.getByTestId('a').textContent).toBe('Recovered:no_messages');
  await deleteAgentSession('a');
  await vi.waitFor(() => expect(requests).toHaveLength(4));
  reply(3, data());
  await vi.waitFor(() =>
    expect(view.getByTestId('a').textContent).toBe('does_not_exist')
  );
  cache.clear();
});

it('fetches again when a newer change arrives during a metadata refresh', async () => {
  const { requests, cache, session, data } = setup();
  const view = render(() => (
    <QueryClientProvider client={cache}>
      <Mention id="a" />
    </QueryClientProvider>
  ));
  const reply = (index: number, name: string) =>
    requests[index].subject.next({
      operation: requests[index].operation,
      data: data(session('a', name)),
      stale: false,
      hasNext: false,
    });
  await vi.waitFor(() => expect(requests).toHaveLength(1));
  reply(0, 'Initial');
  const first = refreshActiveGraphqlPreviewQueries('a');
  await vi.waitFor(() => expect(requests).toHaveLength(2));
  const newer = refreshActiveGraphqlPreviewQueries('a');
  reply(1, 'Older');
  await vi.waitFor(() => expect(requests).toHaveLength(3));
  reply(2, 'Newest');
  await Promise.all([first, newer]);
  expect(view.getByTestId('a').textContent).toBe('Newest:no_messages');
  cache.clear();
});
