import { type Client, CombinedError } from '@urql/core';
import { validate as validateUuid } from 'uuid';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkEmailThreadSeenDocument } from './graphql/generated/graphql';
import {
  markGraphqlEmailThreadSeen,
  markGraphqlEmailThreadUnread,
} from './graphql-email-read-state';

const mutation = vi.fn();
const client = { mutation } as unknown as Client;

beforeEach(() => {
  mutation.mockReset().mockImplementation((document) => ({
    toPromise: async () => ({
      data:
        document === MarkEmailThreadSeenDocument
          ? { markEmailThreadSeen: { id: 'thread', isRead: true } }
          : { updateEmailThreadLabel: { id: 'thread', isRead: false } },
    }),
  }));
});

describe('GraphQL email read-state mutations', () => {
  it('keeps read and unread as distinct ordered optimistic transactions', async () => {
    await expect(markGraphqlEmailThreadSeen(client, 'thread')).resolves.toBe(
      'committed'
    );
    await markGraphqlEmailThreadUnread(client, 'thread', 'inbox-unread');
    const contexts = mutation.mock.calls.map(
      (call) => call[2].normalizedCacheOptimistic
    );
    const uuids = contexts.map((context) => context.uuid);
    expect(uuids.every(validateUuid)).toBe(true);
    expect(new Set(uuids).size).toBe(2);
    expect(contexts[0].optimisticResponse.markEmailThreadSeen).toEqual({
      __typename: 'GraphqlSoupEmailThread',
      id: 'thread',
      isRead: true,
    });
    expect(contexts[1].optimisticResponse.updateEmailThreadLabel).toEqual({
      __typename: 'GraphqlSoupEmailThread',
      id: 'thread',
      isRead: false,
    });
  });

  it.each(['seen', 'unread'] as const)(
    'propagates a permanent %s error for the exchange-owned rollback',
    async (action) => {
      const error = new CombinedError({
        graphQLErrors: [new Error('forbidden')],
      });
      mutation.mockReturnValue({
        toPromise: async () => ({
          error,
          extensions: {
            normalizedCacheMutationDisposition: { kind: 'permanently-failed' },
          },
        }),
      });
      await expect(
        action === 'seen'
          ? markGraphqlEmailThreadSeen(client, 'thread')
          : markGraphqlEmailThreadUnread(client, 'thread', 'unread')
      ).rejects.toBe(error);
    }
  );

  it('accepts a durable queue result without claiming it committed remotely', async () => {
    mutation.mockReturnValue({
      toPromise: async () => ({
        extensions: {
          normalizedCacheMutationDisposition: {
            kind: 'queued',
            transactionId: 'tx',
          },
        },
      }),
    });
    await expect(markGraphqlEmailThreadSeen(client, 'thread')).resolves.toBe(
      'queued'
    );
  });

  it('rejects an empty response payload instead of claiming the write committed', async () => {
    mutation.mockReturnValue({ toPromise: async () => ({ data: {} }) });
    await expect(markGraphqlEmailThreadSeen(client, 'thread')).rejects.toThrow(
      'returned no data'
    );
    await expect(
      markGraphqlEmailThreadUnread(client, 'thread', 'unread')
    ).rejects.toThrow('returned no data');
  });

  it('rejects a response with neither data nor a queue disposition', async () => {
    mutation.mockReturnValue({ toPromise: async () => ({}) });
    await expect(markGraphqlEmailThreadSeen(client, 'thread')).rejects.toThrow(
      'returned no data'
    );
  });
});
