import {
  ChannelListSoupDocument,
  ChannelUnreadPresenceDocument,
  HomeUnreadPresenceDocument,
} from '@service-storage/graphql/generated/graphql';
import type { Client } from '@urql/core';
import { expect, it, onTestFinished, vi } from 'vitest';
import { registerGraphqlSoupRevalidations } from './active-queries';
import { revalidateChannelLists } from './channel-list-revalidation';

it('reconciles only uncovered channel lists after the import queues updates', async () => {
  const query = vi.fn(() => ({ toPromise: async () => ({ data: {} }) }));
  const client = { query } as unknown as Pick<Client, 'query'>;
  const first = { input: { initial: { limit: 20 } } };
  const second = { input: { cursor: 'second' } };
  onTestFinished(
    registerGraphqlSoupRevalidations(
      () => [
        { document: ChannelListSoupDocument, variables: first },
        { document: ChannelUnreadPresenceDocument, variables: first },
        { document: HomeUnreadPresenceDocument, variables: first },
      ],
      () => client,
      () => true
    )
  );
  onTestFinished(
    registerGraphqlSoupRevalidations(
      () => [{ document: ChannelListSoupDocument, variables: second }],
      () => client
    )
  );

  await revalidateChannelLists(client, { importedRowsQueued: true });
  expect(query.mock.calls).toEqual([
    [ChannelUnreadPresenceDocument, first, { requestPolicy: 'network-only' }],
    [HomeUnreadPresenceDocument, first, { requestPolicy: 'network-only' }],
    [ChannelListSoupDocument, second, { requestPolicy: 'network-only' }],
  ]);

  query.mockClear();
  await revalidateChannelLists(client);
  expect(query).toHaveBeenCalledTimes(4);
});
