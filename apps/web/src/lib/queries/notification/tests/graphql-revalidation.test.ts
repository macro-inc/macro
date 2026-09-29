import type { Client } from '@urql/core';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  client: {} as Client,
  query: {
    isEnabled: false,
    get data(): never {
      throw new Error('revalidation must not read the suspense resource');
    },
    refetch: vi.fn(async () => undefined),
  },
}));

vi.mock('@app/lib/urql-solid', () => ({
  createUrqlInfiniteQuery: () => mocks.query,
  createUrqlMutation: vi.fn(),
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => mocks.client,
  mapGraphqlNotification: vi.fn(),
}));

import { createGraphqlNotificationsQuery } from '../graphql/user-notifications';
import { revalidateNotificationReaders } from '../revalidation';

const cleanup: Array<() => void> = [];
beforeEach(() => {
  mocks.query.isEnabled = false;
  vi.clearAllMocks();
});
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose();
});

it('leaves an uncreated lazy notification feed dormant', async () => {
  await revalidateNotificationReaders(mocks.client);
  expect(mocks.query.refetch).not.toHaveBeenCalled();
});

it('tracks enabled state without reading data, preserves the query pagination, and unregisters on cleanup', async () => {
  const dispose = createRoot((dispose) => {
    createGraphqlNotificationsQuery(() => ({ limit: 20 }));
    return dispose;
  });
  cleanup.push(dispose);

  await revalidateNotificationReaders(mocks.client);
  expect(mocks.query.refetch).not.toHaveBeenCalled();

  mocks.query.isEnabled = true;
  await revalidateNotificationReaders(mocks.client);
  expect(mocks.query.refetch).toHaveBeenCalledExactlyOnceWith({
    requestPolicy: 'network-only',
    throwOnError: true,
  });

  dispose();
  await revalidateNotificationReaders(mocks.client);
  expect(mocks.query.refetch).toHaveBeenCalledOnce();
});
