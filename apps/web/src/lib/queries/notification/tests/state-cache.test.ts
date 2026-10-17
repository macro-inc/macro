import type { Client } from '@urql/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  host: undefined as { writeQuery: ReturnType<typeof vi.fn> } | undefined,
  revalidate: vi.fn(async (..._args: unknown[]) => {}),
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlCacheHost: () => mocks.host,
}));
vi.mock('../revalidation', () => ({
  revalidateNotificationReaders: mocks.revalidate,
}));

import {
  confirmEntityNotificationsDone,
  reconcileNotificationsDone,
  writeNotificationStates,
} from '../state-cache';

beforeEach(() => {
  mocks.host = { writeQuery: vi.fn(async () => ({ kind: 'written' })) };
  mocks.revalidate.mockClear();
});

it('writes only the state of each notification', async () => {
  const host = { writeQuery: vi.fn(async (_args: unknown) => ({}) as never) };
  await writeNotificationStates(host, ['n1', 'n2'], 'SEEN');
  expect(host.writeQuery.mock.calls.map(([args]) => args)).toEqual(
    ['n1', 'n2'].map((id) =>
      expect.objectContaining({
        operationName: 'NotificationStateCacheWrite',
        variables: {},
        data: {
          notificationUpdates: {
            __typename: 'GraphqlUpdatedNotification',
            notification: {
              __typename: 'GraphqlNotification',
              id,
              state: 'SEEN',
            },
          },
        },
      })
    )
  );
});

it('writes nothing for no notifications', async () => {
  const host = { writeQuery: vi.fn() };
  await writeNotificationStates(host, [], 'DONE');
  expect(host.writeQuery).not.toHaveBeenCalled();
});

it('confirms done in the cache when there is one', async () => {
  expect(confirmEntityNotificationsDone(['n1'])).toBe(true);
  await vi.waitFor(() =>
    expect(mocks.host?.writeQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          notificationUpdates: expect.objectContaining({
            notification: expect.objectContaining({ id: 'n1', state: 'DONE' }),
          }),
        },
      })
    )
  );
});

it('reports that it cannot confirm without a cache or notifications', () => {
  expect(confirmEntityNotificationsDone([])).toBe(false);
  mocks.host = undefined;
  expect(confirmEntityNotificationsDone(['n1'])).toBe(false);
});

it('keeps a failed cache write from escaping', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.host = {
    writeQuery: vi.fn(async () => Promise.reject(new Error('closed'))),
  };
  expect(confirmEntityNotificationsDone(['n1'])).toBe(true);
  await vi.waitFor(() => expect(error).toHaveBeenCalledOnce());
  error.mockRestore();
});

describe('reconcileNotificationsDone', () => {
  it('records the done rows, then reads only readers the cache does not maintain', async () => {
    const client = {} as Client;
    await reconcileNotificationsDone(client, ['n1']);
    expect(mocks.host?.writeQuery).toHaveBeenCalledOnce();
    expect(mocks.revalidate).toHaveBeenCalledExactlyOnceWith(client, {
      unmaintainedOnly: true,
    });
  });

  it('reads every reader again without done rows or a cache', async () => {
    const client = {} as Client;
    await reconcileNotificationsDone(client);
    mocks.host = undefined;
    await reconcileNotificationsDone(client, ['n1']);
    expect(mocks.revalidate.mock.calls).toEqual([[client], [client]]);
  });
});
