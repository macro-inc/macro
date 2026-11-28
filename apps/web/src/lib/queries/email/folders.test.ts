import {
  TRACE_PARENT_CONTEXT_KEY,
  traceParentExchange,
} from '@app/lib/urql-solid/trace-parent-exchange';
import { emailMailboxEffectsExchange } from '@service-storage/email-mailbox-effects-exchange';
import {
  ChannelListSoupDocument,
  MailFolderSoupDocument,
  SetEmailThreadFolderStatesDocument,
  type SetEmailThreadFolderStatesInput,
  SoupDocument,
} from '@service-storage/graphql/generated/graphql';
import { type Client, createClient, fetchExchange } from '@urql/core';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { registerGraphqlSoupRevalidations } from '../soup/graphql/active-queries';

const mocks = vi.hoisted(() => ({
  client: undefined as Client | undefined,
  update: vi.fn(),
  mutation: vi.fn(),
  invalidate: vi.fn(),
  invalidateSoup: vi.fn(),
  spanActive: false,
}));
vi.mock('@service-storage/graphql-soup', () => {
  const client = { mutation: mocks.mutation };
  return {
    getGraphqlSoupClient: () => mocks.client ?? client,
    getGraphqlCacheHost: () => undefined,
  };
});
vi.mock('../client', () => ({
  queryClient: { invalidateQueries: mocks.invalidate },
}));
vi.mock('../soup/normalized-cache', () => ({
  invalidateAllSoup: mocks.invalidateSoup,
}));
vi.mock('@macro-inc/observability', () => {
  // Match the browser context manager: active context ends at an await.
  const run = <T>(work: () => T): T => {
    const previous = mocks.spanActive;
    mocks.spanActive = true;
    try {
      return work();
    } finally {
      mocks.spanActive = previous;
    }
  };
  return {
    Telemetry: {
      captureContext: () => ({
        run: mocks.spanActive ? run : <T>(work: () => T) => work(),
      }),
      span: (_name: string, work: (span: unknown) => unknown) =>
        run(() => work({ setAttr: vi.fn(), error: vi.fn(), run })),
    },
  };
});

import { restoreEmailFolderThreads } from './folders';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.client = undefined;
  mocks.mutation.mockImplementation(
    (_document, { input }: { input: SetEmailThreadFolderStatesInput }) => ({
      toPromise: async () => {
        const outcomes = await Promise.allSettled(
          input.threadIds.map((threadId) =>
            mocks.update({ threadId, field: input.field, value: input.value })
          )
        );
        return {
          data: {
            setEmailThreadFolderStates: input.threadIds.map(
              (threadId, index) => ({
                threadId,
                error:
                  outcomes[index].status === 'rejected' ? 'Write failed' : null,
                effect: { id: threadId },
              })
            ),
          },
        };
      },
    })
  );
});

describe('restore provider folders', () => {
  it.each([
    ['spam', 'JUNK'],
    ['trash', 'TRASHED'],
  ] as const)(
    'restores %s and invalidates mailbox operations for successful threads',
    async (folder, field) => {
      mocks.update.mockResolvedValue(undefined);
      const result = await restoreEmailFolderThreads({
        folder,
        threadIds: ['one', 'one', 'two'],
      });
      expect(mocks.update.mock.calls).toEqual([
        [{ threadId: 'one', field, value: false }],
        [{ threadId: 'two', field, value: false }],
      ]);
      expect(result).toEqual({ restoredIds: ['one', 'two'], failedIds: [] });
      expect(mocks.mutation.mock.calls[0]?.[0]).toBe(
        SetEmailThreadFolderStatesDocument
      );
      expect(mocks.invalidate).toHaveBeenCalledTimes(2);
      expect(mocks.invalidateSoup).toHaveBeenCalledOnce();
    }
  );

  it('keeps failed IDs separate without undoing successful restores', async () => {
    mocks.update
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Access denied'));
    const result = await restoreEmailFolderThreads({
      folder: 'spam',
      threadIds: ['one', 'two'],
    });
    expect(result).toEqual({ restoredIds: ['one'], failedIds: ['two'] });
    expect(mocks.invalidate).toHaveBeenCalledOnce();
  });

  it('keeps a committed restore when only its returned Mail row fails', async () => {
    mocks.mutation.mockReturnValueOnce({
      toPromise: async () => ({
        data: {
          setEmailThreadFolderStates: [
            { threadId: 'one', error: null, effect: null },
          ],
        },
      }),
    });

    await expect(
      restoreEmailFolderThreads({ folder: 'trash', threadIds: ['one'] })
    ).resolves.toEqual({ restoredIds: ['one'], failedIds: [] });
  });

  it.each([true, false])(
    'reads only the missing row by ID and preserves the write acknowledgement (repair succeeds=%s)',
    async (repairSucceeds) => {
      const requests: Array<{
        operation: string;
        variables: unknown;
        traced: boolean;
      }> = [];
      mocks.client = createClient({
        url: 'http://localhost/graphql',
        preferGetMethod: false,
        exchanges: [
          emailMailboxEffectsExchange,
          traceParentExchange,
          fetchExchange,
        ],
        fetch: async (_input, init) => {
          const { operationName, variables } = JSON.parse(String(init?.body));
          requests.push({
            operation: operationName,
            variables,
            traced: mocks.spanActive,
          });
          if (operationName === 'RecoverEmailThreadFolderRow') {
            if (!repairSucceeds)
              return Response.json({
                errors: [{ message: 'Read unavailable' }],
              });
            return Response.json({
              data: {
                user: {
                  id: 'viewer',
                  soupEntity: {
                    __typename: 'GraphqlSoupEmailThread',
                    id: 'one',
                  },
                },
              },
            });
          }
          return Response.json({
            data: {
              setEmailThreadFolderStates: [
                { threadId: 'one', error: null, effect: null },
                { threadId: 'two', error: 'Rejected', effect: null },
              ],
            },
            errors: [
              {
                message: 'Preview unavailable',
                path: [
                  'setEmailThreadFolderStates',
                  0,
                  'effect',
                  'mailAllPreview',
                ],
              },
            ],
          });
        },
      });
      expect(
        await restoreEmailFolderThreads({
          folder: 'trash',
          threadIds: ['one', 'two'],
        })
      ).toEqual({ restoredIds: ['one'], failedIds: ['two'] });
      expect(requests).toEqual([
        {
          operation: 'SetEmailThreadFolderStates',
          variables: {
            input: {
              threadIds: ['one', 'two'],
              field: 'TRASHED',
              value: false,
            },
          },
          traced: true,
        },
        {
          operation: 'RecoverEmailThreadFolderRow',
          variables: { threadId: 'one' },
          traced: true,
        },
      ]);
    }
  );

  it('does not refresh lists when every request fails', async () => {
    mocks.update.mockRejectedValue(new Error('Offline'));
    const result = await restoreEmailFolderThreads({
      folder: 'trash',
      threadIds: ['one'],
    });
    expect(result.failedIds).toEqual(['one']);
    expect(mocks.invalidate).not.toHaveBeenCalled();
    expect(mocks.invalidateSoup).not.toHaveBeenCalled();
  });
  it('sends one bounded mutation and folder revalidation per batch through partial failure', async () => {
    const folder = {
      document: MailFolderSoupDocument,
      variables: {
        input: { initial: { emailView: 'TRASH', limit: 25 } },
        page: 'TRASH:test',
      },
    };
    onTestFinished(registerGraphqlSoupRevalidations(() => [folder]));
    mocks.update.mockImplementation(
      async ({ threadId }: { threadId: string }) => {
        if (threadId === '3') throw new Error('Provider unavailable');
      }
    );
    const ids = Array.from({ length: 65 }, (_, i) => String(i));
    expect(
      await restoreEmailFolderThreads({ folder: 'trash', threadIds: ids })
    ).toEqual({
      restoredIds: ids.filter((id) => id !== '3'),
      failedIds: ['3'],
    });
    expect(
      mocks.mutation.mock.calls.map(
        ([, variables]) => variables.input.threadIds.length
      )
    ).toEqual([32, 32, 1]);
    for (const [, , context] of mocks.mutation.mock.calls) {
      expect(context.optimisticMutation.revalidations).toEqual([folder]);
    }
    expect(mocks.invalidateSoup).toHaveBeenCalledOnce();
  });

  it('attaches only server-owned lists to a queued restore', async () => {
    const folder = {
      document: MailFolderSoupDocument,
      variables: {
        input: { initial: { emailView: 'TRASH', limit: 25 } },
        page: 'TRASH:test',
      },
    };
    const inbox = {
      document: SoupDocument,
      variables: {
        input: { initial: { emailView: 'INBOX', limit: 25 } },
      },
    };
    onTestFinished(registerGraphqlSoupRevalidations(() => [folder]));
    onTestFinished(
      registerGraphqlSoupRevalidations(() => [
        {
          document: ChannelListSoupDocument,
          variables: { input: { initial: { limit: 25 } } },
        },
      ])
    );
    onTestFinished(
      registerGraphqlSoupRevalidations(
        () => [inbox],
        undefined,
        () => true
      )
    );
    mocks.mutation.mockReturnValueOnce({
      toPromise: async () => ({
        extensions: {
          normalizedCacheMutationDisposition: {
            kind: 'queued',
            transactionId: '1',
          },
        },
      }),
    });

    await expect(
      restoreEmailFolderThreads({ folder: 'trash', threadIds: ['one'] })
    ).resolves.toEqual({ restoredIds: ['one'], failedIds: [] });
    expect(mocks.mutation).toHaveBeenCalledWith(
      SetEmailThreadFolderStatesDocument,
      { input: { threadIds: ['one'], field: 'TRASHED', value: false } },
      expect.objectContaining({
        [TRACE_PARENT_CONTEXT_KEY]: expect.anything(),
        optimisticMutation: expect.objectContaining({
          revalidations: [folder],
        }),
      })
    );
  });

  it('preserves accepted restores when refreshing one thread fails', async () => {
    mocks.update.mockResolvedValue(undefined);
    mocks.invalidate.mockRejectedValueOnce(new Error('Refresh timed out'));
    expect(
      await restoreEmailFolderThreads({
        folder: 'spam',
        threadIds: ['one', 'two'],
      })
    ).toEqual({ restoredIds: ['one', 'two'], failedIds: [] });
    expect(mocks.invalidateSoup).toHaveBeenCalledOnce();
  });

  it('keeps writes and follow-up reads in the restore trace across batches', async () => {
    const dispatched: boolean[] = [];
    mocks.update.mockImplementation(async () => {
      dispatched.push(mocks.spanActive);
      await Promise.resolve();
    });
    for (const request of [mocks.invalidate, mocks.invalidateSoup]) {
      request.mockImplementation(async () => {
        dispatched.push(mocks.spanActive);
        await Promise.resolve();
      });
    }
    const ids = Array.from({ length: 9 }, (_, index) => String(index));
    expect(
      await restoreEmailFolderThreads({ folder: 'trash', threadIds: ids })
    ).toEqual({ restoredIds: ids, failedIds: [] });
    expect(dispatched).toHaveLength(19);
    expect(dispatched.every(Boolean)).toBe(true);
    expect(mocks.spanActive).toBe(false);
  });
});
