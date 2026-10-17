import { CombinedError } from '@urql/core';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  graphql: true,
  cache: true,
  archive: vi.fn(),
  mutation: vi.fn(),
  refresh: vi.fn(),
  reminders: vi.fn(),
  revalidations: vi.fn(() => [] as unknown[]),
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableGraphqlSoup: {},
  isFeatureEnabled: () => mocks.graphql,
}));
vi.mock('@service-email/client', () => ({
  emailClient: { flagArchived: mocks.archive },
}));
vi.mock('@service-storage/client', () => ({ storageServiceClient: {} }));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => ({ mutation: mocks.mutation }),
  graphqlCacheEnabled: () => mocks.cache,
}));
vi.mock('../reminders/email-collection', () => ({
  invalidateEmailReminderCollection: mocks.reminders,
}));
vi.mock('../soup/graphql/active-queries', () => ({
  refreshActiveGraphqlSoupQueries: mocks.refresh,
  getActiveGraphqlSoupRevalidations: mocks.revalidations,
}));

import { predictOptimisticMutation } from '@graphql-cache/exchange/optimistic-resolvers';
import {
  SetEmailThreadArchivedDocument,
  SoupDocument,
} from '@service-storage/graphql/generated/graphql';
import { soupOptimisticResolvers } from '../optimistic-resolvers';
import { archiveEmailThread } from './integration';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.graphql = true;
  mocks.cache = true;
  mocks.refresh.mockResolvedValue(undefined);
  mocks.revalidations.mockReturnValue([]);
});

describe('GraphQL email archive writes', () => {
  it.each([true, false])(
    'writes inboxVisible optimistically for archive=%s before the request settles',
    async (value) => {
      let finish!: () => void;
      const network = new Promise<void>((resolve) => {
        finish = resolve;
      });
      mocks.mutation.mockReturnValue({
        toPromise: async () => {
          await network;
          return {
            data: {
              setEmailThreadArchived: {
                __typename: 'GraphqlSoupEmailThread',
                id: 'thread',
                inboxVisible: !value,
              },
            },
          };
        },
      });
      const result = archiveEmailThread({ id: 'thread', value }, 'secondary');
      expect(mocks.mutation).toHaveBeenCalledWith(
        SetEmailThreadArchivedDocument,
        { input: { threadId: 'thread', archived: value } },
        expect.objectContaining({ optimisticMutation: { revalidations: [] } })
      );
      expect(
        predictOptimisticMutation(
          soupOptimisticResolvers,
          SetEmailThreadArchivedDocument,
          { input: { threadId: 'thread', archived: value } }
        )?.response
      ).toEqual({
        setEmailThreadArchived: {
          __typename: 'GraphqlSoupEmailThread',
          id: 'thread',
          inboxVisible: !value,
        },
      });
      expect(mocks.archive).not.toHaveBeenCalled();
      expect(mocks.refresh).not.toHaveBeenCalled();
      expect(mocks.reminders).not.toHaveBeenCalled();
      finish();
      await expect(result).resolves.toBe('committed');
      expect(mocks.reminders).toHaveBeenCalledOnce();
      // The cached record carries the change to every list the cache
      // maintains; only the others are read again, by the exchange.
      expect(mocks.refresh).not.toHaveBeenCalled();
      expect(mocks.revalidations).toHaveBeenCalledExactlyOnceWith(undefined, {
        unmaintainedOnly: true,
      });
    }
  );

  it('refreshes lists after the write only without the normalized cache', async () => {
    mocks.cache = false;
    mocks.mutation.mockReturnValue({
      toPromise: async () => ({
        data: { setEmailThreadArchived: { id: 'thread' } },
      }),
    });
    await expect(
      archiveEmailThread({ id: 'thread', value: true })
    ).resolves.toBe('committed');
    expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith({
      target: { kind: 'email-archive', threadId: 'thread' },
    });
  });

  it('gives Done, Undo and Redo distinct ordered mutation intents', async () => {
    mocks.mutation.mockReturnValue({
      toPromise: async () => ({
        data: { setEmailThreadArchived: { id: 'thread' } },
      }),
    });
    for (const value of [true, false, true])
      await archiveEmailThread({ id: 'thread', value });
    const calls = mocks.mutation.mock.calls;
    expect(calls.map(([, variables]) => variables.input.archived)).toEqual([
      true,
      false,
      true,
    ]);
    expect(calls).toHaveLength(3);
    // No caller-supplied UUID coalesces these separate intents. The resolver
    // exchange assigns their transaction IDs when each operation is prepared.
    expect(
      calls.every(
        ([, , context]) => context.optimisticMutation.uuid === undefined
      )
    ).toBe(true);
  });

  it('queues an offline write that reads only unmaintained lists on replay', async () => {
    const unmaintained = [
      { document: SoupDocument, variables: { input: { initial: {} } } },
    ];
    mocks.revalidations.mockReturnValue(unmaintained);
    mocks.mutation.mockReturnValue({
      toPromise: async () => ({
        extensions: {
          normalizedCacheMutationDisposition: {
            kind: 'queued',
            transactionId: 'tx',
          },
        },
      }),
    });
    await expect(
      archiveEmailThread({ id: 'thread', value: true })
    ).resolves.toBe('queued');
    // Replay commits the record; only lists the cache does not maintain are
    // read again, even after a reload.
    expect(mocks.revalidations).toHaveBeenCalledWith(undefined, {
      unmaintainedOnly: true,
    });
    expect(
      mocks.mutation.mock.calls[0][2].optimisticMutation.revalidations
    ).toEqual(unmaintained);
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.reminders).not.toHaveBeenCalled();
  });

  it.each([
    { error: new CombinedError({ graphQLErrors: ['not authorized'] }) },
    {
      extensions: {
        normalizedCacheMutationDisposition: {
          kind: 'permanently-failed',
          error: new Error('rejected'),
        },
      },
    },
    { data: {} },
  ])(
    'does not report a rejected/missing mutation reply as success: %j',
    async (reply) => {
      mocks.mutation.mockReturnValue({ toPromise: async () => reply });
      await expect(
        archiveEmailThread({ id: 'thread', value: true })
      ).rejects.toThrow();
      expect(mocks.refresh).not.toHaveBeenCalled();
      expect(mocks.reminders).not.toHaveBeenCalled();
      expect(mocks.archive).not.toHaveBeenCalled();
    }
  );

  it.each([true, false])(
    'keeps archive=%s on REST when GraphQL is disabled',
    async (value) => {
      mocks.graphql = false;
      mocks.archive.mockResolvedValue(ok(undefined));
      await expect(
        archiveEmailThread({ id: 'thread', value }, 'secondary')
      ).resolves.toBe('committed');
      expect(mocks.archive).toHaveBeenCalledWith(
        { id: 'thread', value },
        'secondary'
      );
      expect(mocks.mutation).not.toHaveBeenCalled();
      expect(mocks.refresh).not.toHaveBeenCalled();
      expect(mocks.reminders).toHaveBeenCalledOnce();
    }
  );

  it('preserves REST failure behavior', async () => {
    mocks.graphql = false;
    mocks.archive.mockResolvedValue(err(new Error('archive failed')));
    await expect(
      archiveEmailThread({ id: 'thread', value: true })
    ).rejects.toThrow();
  });
});
