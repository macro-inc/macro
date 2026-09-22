import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rest: vi.fn(async () => {}),
  graphql: vi.fn(async () => {}),
}));

vi.mock('@queries/soup/refresh', () => ({
  refreshSoupEntities: mocks.rest,
}));
vi.mock('@queries/soup/graphql/active-queries', () => ({
  refreshActiveGraphqlSoupQueries: mocks.graphql,
}));

import { refreshAgentSessionLists } from './list-sync';

beforeEach(() => vi.clearAllMocks());

it('coalesces a metadata burst and refreshes both list transports', async () => {
  await Promise.all([
    refreshAgentSessionLists('first'),
    refreshAgentSessionLists('first'),
    refreshAgentSessionLists('second'),
  ]);
  expect(mocks.rest.mock.calls).toEqual([[['first', 'second']]]);
  expect(mocks.graphql).toHaveBeenCalledOnce();
});

it('reconnect refreshes all lists to recover missed events', async () => {
  await Promise.all([
    refreshAgentSessionLists('first'),
    refreshAgentSessionLists(),
  ]);
  expect(mocks.rest.mock.calls).toEqual([[undefined]]);
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
  expect(mocks.rest.mock.calls).toEqual([[['first']], [['second']]]);
});
