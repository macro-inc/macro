import { ChannelUnreadPresenceDocument } from '@service-storage/graphql/generated/graphql';
import { createClient, type Operation, type OperationResult } from '@urql/core';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { makeSubject, pipe, subscribe } from 'wonka';
import {
  getChannelListRevalidations,
  revalidateChannelLists,
} from '../soup/graphql/channel-list-revalidation';
import { createChannelUnreadQuery } from './unread-presence';

const clientMock = vi.hoisted(() => vi.fn());
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: clientMock,
}));

function setup() {
  const operations: Operation[] = [];
  const network = makeSubject<OperationResult>();
  const client = createClient({
    url: 'http://test/graphql',
    exchanges: [
      () => (ops) => {
        pipe(
          ops,
          subscribe((op) => operations.push(op))
        );
        return network.source;
      },
    ],
  });
  clientMock.mockReturnValue(client);
  const root = createRoot((dispose) => {
    const [enabled, setEnabled] = createSignal(false);
    const query = createChannelUnreadQuery(
      { initial: { limit: 500 } },
      enabled
    );
    return { dispose, query, setEnabled };
  });
  const respond = (state: 'UNSEEN' | 'SEEN') =>
    network.next({
      operation: operations.filter((op) => op.kind === 'query').at(-1)!,
      stale: false,
      hasNext: false,
      data: {
        user: {
          id: 'viewer',
          soup: {
            items: [
              {
                __typename: 'GraphqlSoupChannel',
                id: 'channel',
                unreadNotifications: [{ id: 'one', state }],
              },
            ],
          },
        },
      },
    });
  return { ...root, operations, respond, client };
}

describe('channel unread presence query', () => {
  it('loads only when enabled and retains reactive witness states', async () => {
    const f = setup();
    try {
      expect(f.operations.filter((op) => op.kind === 'query')).toHaveLength(0);
      expect(getChannelListRevalidations()).toHaveLength(0);
      f.setEnabled(true);
      expect(f.query.isLoading).toBe(true);
      await vi.waitFor(() =>
        expect(f.operations.filter((op) => op.kind === 'query')).toHaveLength(1)
      );
      expect(f.operations[0].query).toEqual(ChannelUnreadPresenceDocument);
      f.respond('UNSEEN');
      expect(f.query.data).toEqual([{ id: 'one', state: 'UNSEEN' }]);
      f.respond('SEEN');
      expect(f.query.data).toEqual([{ id: 'one', state: 'SEEN' }]);
      expect(getChannelListRevalidations()).toEqual([
        {
          document: ChannelUnreadPresenceDocument,
          variables: { input: { initial: { limit: 500 } } },
        },
      ]);
      f.setEnabled(false);
      expect(getChannelListRevalidations()).toHaveLength(0);
    } finally {
      f.dispose();
    }
  });

  it('shares bounded notification revalidation and unregisters on disposal', async () => {
    const f = setup();
    try {
      f.setEnabled(true);
      await vi.waitFor(() =>
        expect(f.operations.filter((op) => op.kind === 'query')).toHaveLength(1)
      );
      f.respond('UNSEEN');
      const query = vi.fn(() => ({ toPromise: async () => ({ data: {} }) }));
      await revalidateChannelLists({ query } as unknown as Pick<
        typeof f.client,
        'query'
      >);
      expect(query).toHaveBeenCalledWith(
        ChannelUnreadPresenceDocument,
        { input: { initial: { limit: 500 } } },
        { requestPolicy: 'network-only' }
      );
    } finally {
      f.dispose();
    }
    expect(getChannelListRevalidations()).toHaveLength(0);
  });
});
