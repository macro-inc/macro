import { CombinedError, stringifyDocument } from '@urql/core';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  graphql: true,
  archive: vi.fn(),
  mutation: vi.fn(),
  refresh: vi.fn(),
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
}));
vi.mock('../soup/graphql/active-queries', () => ({
  refreshActiveGraphqlSoupQueries: mocks.refresh,
  getActiveGraphqlSoupRevalidations: mocks.revalidations,
}));

import {
  SetEmailThreadArchivedDocument,
  SoupDocument,
} from '@service-storage/graphql/generated/graphql';
import { archiveEmailThread } from './integration';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.graphql = true;
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
        expect.objectContaining({
          normalizedCacheOptimistic: expect.objectContaining({
            optimisticResponse: {
              setEmailThreadArchived: {
                __typename: 'GraphqlSoupEmailThread',
                id: 'thread',
                inboxVisible: !value,
              },
            },
          }),
        })
      );
      expect(mocks.archive).not.toHaveBeenCalled();
      expect(mocks.refresh).not.toHaveBeenCalled();
      finish();
      await expect(result).resolves.toBe('committed');
      expect(mocks.refresh).toHaveBeenCalledOnce();
    }
  );

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
    expect(
      new Set(
        calls.map(([, , context]) => context.normalizedCacheOptimistic.uuid)
      ).size
    ).toBe(3);
  });

  it('preserves replay revalidations, including continuation pages, without refetching queued writes', async () => {
    const variables = [
      { input: { initial: { limit: 100 } } },
      { input: { continuation: { cursor: 'next' } } },
    ];
    mocks.revalidations.mockReturnValue(
      variables.map((variables) => ({ document: SoupDocument, variables }))
    );
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
    expect(
      mocks.mutation.mock.calls[0][2].normalizedCacheOptimistic.revalidations
    ).toEqual(
      variables.map((variables) => ({
        query: stringifyDocument(SoupDocument),
        operationName: 'Soup',
        variablesJson: JSON.stringify(variables),
      }))
    );
    expect(mocks.refresh).not.toHaveBeenCalled();
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
