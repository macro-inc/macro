import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rest: vi.fn<
    (ids?: string[], options?: { throwOnError?: boolean }) => Promise<void>
  >(async () => {}),
  graphql: vi.fn<(options?: { throwOnError?: boolean }) => Promise<void>>(
    async () => {}
  ),
  graphqlSoup: vi.fn(() => false),
  row: vi.fn<
    (
      document: unknown,
      variables: { sessionId: string },
      context: { requestPolicy: string }
    ) => Promise<{
      error?: Error;
      data?: { agentSession: { id: string; turnState: string } };
    }>
  >(async () => ({})),
  held: vi.fn((_id: string) => false),
  cached: vi.fn((_id: string): unknown => undefined),
  hydrate: vi.fn(),
  spans: [] as {
    name: string;
    parent: string | null;
    attrs: Record<string, unknown>;
  }[],
}));

/** Records each span with the span it was started from; never an ambient one. */
vi.mock('@macro-inc/observability', () => {
  type Recorded = (typeof mocks.spans)[number];
  const start = (name: string, parent: Recorded | null) => {
    const record: Recorded = { name, parent: parent?.name ?? null, attrs: {} };
    mocks.spans.push(record);
    const span = {
      setAttr: (key: string, value: unknown) => {
        record.attrs[key] = value;
      },
      error: () => {},
      span: (child: string, operation: (span: unknown) => Promise<unknown>) =>
        run(child, record, operation),
    };
    return span;
  };
  const run = (
    name: string,
    parent: Recorded | null,
    operation: (span: unknown) => Promise<unknown>
  ) => operation(start(name, parent));
  return {
    Telemetry: {
      span: (name: string, operation: (span: unknown) => Promise<unknown>) =>
        run(name, null, operation),
    },
  };
});

vi.mock('@queries/soup/refresh', () => ({
  refreshSoupEntities: mocks.rest,
}));
vi.mock('@queries/soup/graphql/active-queries', () => ({
  refreshActiveGraphqlSoupQueries: mocks.graphql,
}));
vi.mock('@core/constant/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/constant/featureFlags')>()),
  isFeatureEnabled: mocks.graphqlSoup,
}));
vi.mock('@queries/soup/normalized-cache', () => ({
  hasSoupEntity: mocks.held,
  getSoupEntityById: mocks.cached,
  hydrateSoupEntity: mocks.hydrate,
}));
vi.mock('@service-storage/graphql-soup', () => ({
  mapGraphqlAgentSessionRow: (session: { id: string; turnState: string }) => ({
    id: session.id,
    turnState: session.turnState,
  }),
  getGraphqlSoupClient: () => ({
    query: (
      document: unknown,
      variables: { sessionId: string },
      context: { requestPolicy: string }
    ) => ({ toPromise: () => mocks.row(document, variables, context) }),
  }),
}));
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/query-core');
  return { queryClient: new QueryClient() };
});

import { AgentSessionRowDocument } from '@service-storage/graphql/generated/graphql';
import { refreshAgentSessionLists } from './list-sync';
import { invalidateAgentSessionMetadata } from './session-metadata-sync';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.spans.length = 0;
  mocks.graphqlSoup.mockReturnValue(false);
  mocks.held.mockReturnValue(false);
});
afterEach(() => vi.restoreAllMocks());

it('coalesces a metadata burst into one REST list refresh', async () => {
  await Promise.all([
    refreshAgentSessionLists('first'),
    refreshAgentSessionLists('first'),
    refreshAgentSessionLists('second'),
  ]);
  expect(mocks.rest.mock.calls).toEqual([
    [['first', 'second'], { throwOnError: true }],
  ]);
});

it('never network-refreshes the GraphQL soup queries', async () => {
  await refreshAgentSessionLists('first');
  expect(mocks.graphql).not.toHaveBeenCalled();
});

it('reads each changed session row from the primary under GraphQL Soup', async () => {
  mocks.graphqlSoup.mockReturnValue(true);
  await Promise.all([
    refreshAgentSessionLists('first'),
    refreshAgentSessionLists('first'),
    refreshAgentSessionLists('second'),
  ]);
  expect(mocks.row.mock.calls).toEqual([
    [
      AgentSessionRowDocument,
      { sessionId: 'first' },
      { requestPolicy: 'network-only' },
    ],
    [
      AgentSessionRowDocument,
      { sessionId: 'second' },
      { requestPolicy: 'network-only' },
    ],
  ]);
  expect(mocks.graphql).not.toHaveBeenCalled();
});

it('reads no row for a session no list holds', async () => {
  await refreshAgentSessionLists('first');
  expect(mocks.row).not.toHaveBeenCalled();
});

it('hydrates a REST row from the primary after its replica-backed lists refetch', async () => {
  mocks.held.mockReturnValue(true);
  mocks.cached.mockReturnValue({
    tag: 'agentSession',
    frecency_score: 3,
    data: { id: 'first', turnState: 'running' },
  });
  mocks.row.mockResolvedValueOnce({
    data: { agentSession: { id: 'first', turnState: 'idle' } },
  });

  await refreshAgentSessionLists('first');

  expect(mocks.hydrate).toHaveBeenCalledExactlyOnceWith({
    tag: 'agentSession',
    frecency_score: 3,
    data: { id: 'first', turnState: 'idle' },
  });
  expect(mocks.rest.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.row.mock.invocationCallOrder[0]
  );
});

it('retries a session whose row read failed', async () => {
  mocks.graphqlSoup.mockReturnValue(true);
  mocks.row.mockResolvedValueOnce({ error: new Error('network') });
  await refreshAgentSessionLists('first');
  expect(mocks.row.mock.calls.map(([, variables]) => variables)).toEqual([
    { sessionId: 'first' },
    { sessionId: 'first' },
  ]);
});

it('lets every row read settle before retrying the batch', async () => {
  mocks.graphqlSoup.mockReturnValue(true);
  let finishSecond!: () => void;
  mocks.row
    .mockResolvedValueOnce({ error: new Error('network') })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSecond = () => resolve({});
        })
    );
  const refresh = Promise.all([
    refreshAgentSessionLists('first'),
    refreshAgentSessionLists('second'),
  ]);
  await vi.waitFor(() => expect(mocks.row).toHaveBeenCalledTimes(2));
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(mocks.row).toHaveBeenCalledTimes(2);
  finishSecond();
  await refresh;
  expect(mocks.row).toHaveBeenCalledTimes(4);
});

it('keeps the refetch and every row read in the pass trace', async () => {
  mocks.graphqlSoup.mockReturnValue(true);
  mocks.row.mockResolvedValue({
    data: { agentSession: { id: 'first', turnState: 'idle' } },
  });
  await Promise.all([
    refreshAgentSessionLists('first'),
    refreshAgentSessionLists('second'),
  ]);

  expect(mocks.spans.map(({ name, parent }) => ({ name, parent }))).toEqual([
    { name: 'agent_session.lists_refresh', parent: null },
    {
      name: 'agent_session.lists_refetch',
      parent: 'agent_session.lists_refresh',
    },
    { name: 'agent_session.row_read', parent: 'agent_session.lists_refresh' },
    { name: 'agent_session.row_read', parent: 'agent_session.lists_refresh' },
  ]);
  expect(mocks.spans[2].attrs).toMatchObject({
    'agent_session.id': 'first',
    'agent_session.turn_state': 'idle',
  });
});

it('leaves soup lists alone when the gateway socket opens', async () => {
  await invalidateAgentSessionMetadata();
  expect(mocks.rest).not.toHaveBeenCalled();
});

it('does not lose metadata committed while a refresh is in flight', async () => {
  let release!: () => void;
  mocks.rest.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      })
  );
  const first = refreshAgentSessionLists('first');
  await Promise.resolve();
  const second = refreshAgentSessionLists('second');
  release();
  await Promise.all([first, second]);
  expect(mocks.rest.mock.calls).toEqual([
    [['first'], { throwOnError: true }],
    [['second'], { throwOnError: true }],
  ]);
});

it('retries a failed batch together with updates queued while it was in flight', async () => {
  let fail!: (error: Error) => void;
  mocks.rest.mockImplementationOnce(
    () =>
      new Promise<void>((_resolve, reject) => {
        fail = reject;
      })
  );
  const first = refreshAgentSessionLists('first');
  await Promise.resolve();
  const second = refreshAgentSessionLists('second');
  fail(new Error('temporary outage'));
  await Promise.all([first, second]);

  expect(mocks.rest.mock.calls.map(([ids]) => ids)).toEqual([
    ['first'],
    ['second', 'first'],
  ]);
});

it('retains failed IDs after a bounded retry for the next refresh', async () => {
  const error = new Error('offline');
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.rest.mockRejectedValueOnce(error).mockRejectedValueOnce(error);
  await expect(refreshAgentSessionLists('failed')).resolves.toBeUndefined();
  expect(mocks.rest).toHaveBeenCalledTimes(2);
  expect(logged).toHaveBeenCalledExactlyOnceWith(
    '[agent-session] failed to refresh session lists',
    error
  );

  await refreshAgentSessionLists('next');
  expect(mocks.rest.mock.calls.map(([ids]) => ids)).toEqual([
    ['failed'],
    ['failed'],
    ['failed', 'next'],
  ]);
});
