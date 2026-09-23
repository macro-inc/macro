import {
  QueryClient,
  type QueryKey,
  QueryObserver,
} from '@tanstack/query-core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let client: QueryClient;
const dependencies = vi.hoisted(() => vi.fn<() => QueryKey[]>(() => []));
vi.mock('@queries/client', () => ({
  get queryClient() {
    return client;
  },
}));
vi.mock('./normalized-cache/normalizer', () => ({
  getSoupNormalizer: () => ({ getDependentQueriesByIds: dependencies }),
  soupNormKey: (id: string) => `soup:${id}`,
}));

import { refreshAgentSessionLists } from '../agent-session/list-sync';
import { soupKeys } from './keys';
import { refreshSoupEntities } from './refresh';

const key = [
  ...soupKeys.items._def,
  { agent_session_filters: { include: true } },
];
const unsubscribers: Array<() => void> = [];

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  dependencies.mockReset();
  dependencies.mockReturnValue([]);
});
afterEach(() => {
  for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
  client.clear();
});

function mountList(
  queryKey: QueryKey,
  queryFn: () => Promise<string>,
  initialData?: string
) {
  const observer = new QueryObserver(client, {
    queryKey,
    queryFn,
    ...(initialData === undefined ? {} : { initialData, staleTime: Infinity }),
  });
  unsubscribers.push(observer.subscribe(() => {}));
}

it('leaves loading and loaded lists alone for a session no list holds', async () => {
  const loading = vi.fn(() => new Promise<string>(() => {}));
  const loaded = vi.fn(async () => 'refetched');
  mountList(key, loading);
  mountList([...soupKeys.items._def, { documents: true }], loaded, 'loaded');

  await refreshSoupEntities(['session']);

  expect(loading).toHaveBeenCalledOnce();
  expect(loaded).not.toHaveBeenCalled();
});

it('leaves unrelated loaded REST lists alone for a known session', async () => {
  dependencies.mockReturnValue([key]);
  const otherKey = [...soupKeys.items._def, { documents: true }];
  const unrelated = vi.fn(async () => 'unrelated');
  mountList(otherKey, unrelated, 'already loaded');
  mountList(key, async () => 'updated', 'old');

  await refreshSoupEntities(['session']);

  expect(unrelated).not.toHaveBeenCalled();
  expect(client.getQueryData(otherKey)).toBe('already loaded');
  expect(client.getQueryData(key)).toBe('updated');
});

it('awaits REST and repeats when another update arrives during revalidation', async () => {
  dependencies.mockReturnValue([key]);
  const responses: Array<(state: string) => void> = [];
  const queryFn = vi.fn(
    () => new Promise<string>((resolve) => responses.push(resolve))
  );
  mountList(key, queryFn, 'idle');

  const first = refreshAgentSessionLists('session');
  await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));
  const second = refreshAgentSessionLists('session');
  responses[0]('running');
  await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
  responses[1]('blocked');
  await Promise.all([first, second]);

  expect(client.getQueryData(key)).toBe('blocked');
});

it('retries a real query failure so persisted metadata can replace the cached row', async () => {
  dependencies.mockReturnValue([key]);
  const queryFn = vi.fn(async () => 'updated branch');
  queryFn.mockRejectedValueOnce(new Error('temporary outage'));
  mountList(key, queryFn, 'old branch');

  await refreshAgentSessionLists('session');

  expect(queryFn).toHaveBeenCalledTimes(2);
  expect(client.getQueryData(key)).toBe('updated branch');
});
