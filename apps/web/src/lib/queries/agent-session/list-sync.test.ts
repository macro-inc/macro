import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rest: vi.fn<
    (ids?: string[], options?: { throwOnError?: boolean }) => Promise<void>
  >(async () => {}),
  graphql: vi.fn<(options?: { throwOnError?: boolean }) => Promise<void>>(
    async () => {}
  ),
}));

vi.mock('@queries/soup/refresh', () => ({
  refreshSoupEntities: mocks.rest,
}));
vi.mock('@queries/soup/graphql/active-queries', () => ({
  refreshActiveGraphqlSoupQueries: mocks.graphql,
}));

import { refreshAgentSessionLists } from './list-sync';

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

it('coalesces a metadata burst and refreshes both list transports', async () => {
  await Promise.all([
    refreshAgentSessionLists('first'),
    refreshAgentSessionLists('first'),
    refreshAgentSessionLists('second'),
  ]);
  expect(mocks.rest.mock.calls).toEqual([
    [['first', 'second'], { throwOnError: true }],
  ]);
  expect(mocks.graphql).toHaveBeenCalledExactlyOnceWith({ throwOnError: true });
});

it('reconnect refreshes all lists to recover missed events', async () => {
  await Promise.all([
    refreshAgentSessionLists('first'),
    refreshAgentSessionLists(),
  ]);
  expect(mocks.rest.mock.calls).toEqual([[undefined, { throwOnError: true }]]);
  expect(mocks.graphql).toHaveBeenCalledOnce();
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
  expect(mocks.graphql).toHaveBeenCalledOnce();
  release();
  await Promise.all([first, second]);
  expect(mocks.graphql).toHaveBeenCalledTimes(2);
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
  expect(mocks.graphql).toHaveBeenCalledTimes(2);
});

it('waits for both transports before retrying after either one fails', async () => {
  let release!: () => void;
  mocks.rest.mockRejectedValueOnce(new Error('REST outage'));
  mocks.graphql.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      })
  );
  const refresh = refreshAgentSessionLists('session');
  await Promise.resolve();
  await Promise.resolve();
  expect(mocks.rest).toHaveBeenCalledOnce();
  release();
  await refresh;
  expect(mocks.rest).toHaveBeenCalledTimes(2);
  expect(mocks.graphql).toHaveBeenCalledTimes(2);
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

it('preserves a failed reconnect refresh across later session-specific updates', async () => {
  const error = new Error('GraphQL offline');
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.graphql.mockRejectedValueOnce(error).mockRejectedValueOnce(error);
  await expect(refreshAgentSessionLists()).resolves.toBeUndefined();

  await refreshAgentSessionLists('next');
  expect(mocks.rest.mock.calls.map(([ids]) => ids)).toEqual([
    undefined,
    undefined,
    undefined,
  ]);
  expect(logged).toHaveBeenCalledOnce();
});
