import {
  UpdateNotificationsDocument,
  type UpdateNotificationsMutation,
  type UpdateNotificationsMutationVariables,
} from '@service-storage/graphql/generated/graphql';
import { type Client, CombinedError, type OperationResult } from '@urql/core';
import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getGraphqlSoupClientMock = vi.hoisted(() => vi.fn());
const mutationMock = vi.hoisted(() => vi.fn());

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: getGraphqlSoupClientMock,
}));

import { createGraphqlUpdateNotificationsMutation } from './user-notifications';

type UpdateResult = OperationResult<
  UpdateNotificationsMutation,
  UpdateNotificationsMutationVariables
>;

function setupMutation(
  callbacks: Parameters<typeof createGraphqlUpdateNotificationsMutation>[0]
) {
  const client = { mutation: mutationMock } as unknown as Client;
  getGraphqlSoupClientMock.mockReturnValue(client);
  return createRoot((dispose) => ({
    dispose,
    mutation: createGraphqlUpdateNotificationsMutation(callbacks),
  }));
}

describe('createGraphqlUpdateNotificationsMutation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps facade input to the generated GraphQL operation', async () => {
    const response = {
      operation: {},
      data: { updateNotifications: [] },
    } as unknown as UpdateResult;
    mutationMock.mockReturnValue({
      toPromise: async () => response,
    });
    const onSuccess = vi.fn();
    const { mutation, dispose } = setupMutation({
      operation: 'MARK_DONE',
      onSuccess,
    });

    try {
      const result = await mutation.mutateAsync({
        notificationIds: ['notification-1'],
      });

      expect(mutationMock).toHaveBeenCalledWith(
        UpdateNotificationsDocument,
        {
          input: {
            notificationIds: ['notification-1'],
            operation: 'MARK_DONE',
          },
        },
        {
          normalizedCacheOptimistic: {
            optimisticResponse: {
              updateNotifications: [
                {
                  __typename: 'GraphqlSoupNotification',
                  id: 'notification-1',
                  done: true,
                },
              ],
            },
            linkPatches: [],
            revalidations: [],
          },
        }
      );
      expect(result).toBe(response);
      expect(onSuccess).toHaveBeenCalledWith(
        [],
        { notificationIds: ['notification-1'] },
        undefined
      );
    } finally {
      dispose();
    }
  });

  it('treats a queued network failure as accepted optimism', async () => {
    const networkError = new CombinedError({
      networkError: new Error('offline'),
    });
    mutationMock.mockReturnValue({
      toPromise: async () =>
        ({
          operation: {},
          error: networkError,
          extensions: {
            normalizedCacheMutationDisposition: {
              kind: 'queued',
              transactionId: 'transaction-1',
            },
          },
        }) as unknown as UpdateResult,
    });
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const { mutation, dispose } = setupMutation({
      operation: 'MARK_DONE',
      onSuccess,
      onError,
    });

    try {
      const result = await mutation.mutateAsync({
        notificationIds: ['notification-1'],
      });

      const optimisticRows = [
        {
          __typename: 'GraphqlSoupNotification',
          id: 'notification-1',
          done: true,
        },
      ];
      expect(result.error).toBeUndefined();
      expect(result.data).toEqual({ updateNotifications: optimisticRows });
      expect(onSuccess).toHaveBeenCalledWith(
        optimisticRows,
        { notificationIds: ['notification-1'] },
        undefined
      );
      expect(onError).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it('converts a missing GraphQL payload into a mutation error', async () => {
    mutationMock.mockReturnValue({
      toPromise: async () => ({ operation: {} }) as unknown as UpdateResult,
    });
    const onError = vi.fn();
    const { mutation, dispose } = setupMutation({
      operation: 'MARK_SEEN',
      onError,
    });

    try {
      const result = await mutation.mutateAsync({
        notificationIds: ['notification-1'],
      });

      expect(mutationMock).toHaveBeenCalledWith(
        UpdateNotificationsDocument,
        {
          input: {
            notificationIds: ['notification-1'],
            operation: 'MARK_SEEN',
          },
        },
        {
          normalizedCacheOptimistic: {
            optimisticResponse: {
              updateNotifications: [
                {
                  __typename: 'GraphqlSoupNotification',
                  id: 'notification-1',
                  seen: true,
                  viewedAt: expect.any(String),
                },
              ],
            },
            linkPatches: [],
            revalidations: [],
          },
        }
      );
      expect(result.error?.message).toContain(
        'updateNotifications mutation returned no data'
      );
      expect(onError).toHaveBeenCalledWith(
        result.error,
        { notificationIds: ['notification-1'] },
        undefined
      );
    } finally {
      dispose();
    }
  });
});
