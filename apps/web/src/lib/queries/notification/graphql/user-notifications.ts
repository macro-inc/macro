import {
  createUrqlInfiniteQuery,
  createUrqlMutation,
  type UrqlInfiniteQueryResult,
} from '@app/lib/urql-solid';
import type { UnifiedNotification } from '@notifications/types';
import {
  type NotificationUpdateOperation,
  type SoupInput,
  SoupNotificationsDocument,
  type SoupNotificationsQuery,
  type SoupNotificationsQueryVariables,
  UpdateNotificationsDocument,
  type UpdateNotificationsMutation,
  type UpdateNotificationsMutationVariables,
} from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlSoupClient,
  mapGraphqlNotification,
} from '@service-storage/graphql-soup';
import { executeGraphqlUpdateNotifications } from '@service-storage/graphql-update-notifications';
import { CombinedError } from '@urql/core';
import type { Accessor } from 'solid-js';

const DEFAULT_NOTIFICATION_LIMIT = 20;
const MAX_NOTIFICATION_LIMIT = 500;

function normalizeLimit(limit?: number): number {
  return limit && limit > 0 && limit <= MAX_NOTIFICATION_LIMIT
    ? limit
    : DEFAULT_NOTIFICATION_LIMIT;
}

function soupInput(cursor: string | null, limit: number): SoupInput {
  return cursor
    ? { continuation: { cursor, expand: true } }
    : {
        initial: {
          expand: true,
          limit,
          sortMethod: 'UPDATED_AT',
        },
      };
}

/** Flattens and deduplicates notifications returned across Soup entity pages. */
export function selectGraphqlNotifications(
  pages: SoupNotificationsQuery[],
  done = false
): UnifiedNotification[] {
  const notificationsById = new Map<string, UnifiedNotification>();
  for (const page of pages) {
    for (const entity of page.user.soup.items) {
      for (const record of entity.notifications) {
        if (record.done === done && !notificationsById.has(record.id)) {
          notificationsById.set(record.id, mapGraphqlNotification(record));
        }
      }
    }
  }

  return [...notificationsById.values()].sort((left, right) => {
    const leftTimestamp = Date.parse(left.created_at);
    const rightTimestamp = Date.parse(right.created_at);
    const timestampOrder =
      (Number.isNaN(rightTimestamp) ? 0 : rightTimestamp) -
      (Number.isNaN(leftTimestamp) ? 0 : leftTimestamp);
    return timestampOrder || left.id.localeCompare(right.id);
  });
}

/** Live notification query projected from the regular GraphQL Soup query. */
export type GraphqlNotificationsQuery = UrqlInfiniteQueryResult<
  SoupNotificationsQuery,
  SoupNotificationsQueryVariables,
  string | null,
  UnifiedNotification[]
>;

/** Arguments accepted by the GraphQL notification query. */
export type GraphqlNotificationsQueryArgs = {
  limit?: number;
  done?: boolean;
};

/** Reactive options accepted by the GraphQL notification query. */
export type GraphqlNotificationsQueryOptions = { enabled?: boolean };

/** Creates a regular paginated urql query for Soup notification fragments. */
export function createGraphqlNotificationsQuery(
  args: Accessor<GraphqlNotificationsQueryArgs>,
  options?: Accessor<GraphqlNotificationsQueryOptions>
): GraphqlNotificationsQuery {
  const query = createUrqlInfiniteQuery<
    SoupNotificationsQuery,
    SoupNotificationsQueryVariables,
    string | null,
    UnifiedNotification[]
  >(() => {
    const queryArgs = args();
    const limit = normalizeLimit(queryArgs.limit);
    return {
      query: SoupNotificationsDocument,
      client: getGraphqlSoupClient(),
      initialPageParam: null,
      variables: (cursor) => ({ input: soupInput(cursor, limit) }),
      getNextPageParam: (lastPage) => lastPage.user.soup.nextCursor,
      enabled: options?.().enabled !== false,
      requestPolicy: 'cache-and-network',
      keepPreviousData: false,
      select: ({ pages }) =>
        selectGraphqlNotifications(pages, queryArgs.done ?? false),
    };
  });

  return query;
}

/** Variables accepted by the transport-neutral notification mutation facade. */
export type UpdateNotificationsInput = {
  notificationIds: string[];
};

/** Updated notification rows returned by the GraphQL operation. */
export type UpdateNotificationsResult =
  UpdateNotificationsMutation['updateNotifications'];

type GraphqlUpdateNotificationsMutationOptions<Context> = {
  operation: NotificationUpdateOperation;
  onMutate?: (input: UpdateNotificationsInput) => Context | Promise<Context>;
  onSuccess?: (
    data: UpdateNotificationsResult,
    input: UpdateNotificationsInput,
    context: Context | undefined
  ) => void | Promise<void>;
  onError?: (
    error: Error,
    input: UpdateNotificationsInput,
    context: Context | undefined
  ) => void | Promise<void>;
  onSettled?: (
    data: UpdateNotificationsResult | undefined,
    error: Error | null,
    input: UpdateNotificationsInput,
    context: Context | undefined
  ) => void | Promise<void>;
};

/** Creates the urql-solid mutation for one notification status operation. */
export function createGraphqlUpdateNotificationsMutation<Context = void>(
  options: GraphqlUpdateNotificationsMutationOptions<Context>
) {
  return createUrqlMutation<
    UpdateNotificationsMutation,
    UpdateNotificationsMutationVariables,
    UpdateNotificationsInput,
    Context
  >(() => ({
    mutation: UpdateNotificationsDocument,
    client: getGraphqlSoupClient(),
    execute: async ({ client, input }) => {
      const result = await executeGraphqlUpdateNotifications(client, {
        notificationIds: input.notificationIds,
        operation: options.operation,
      });
      if (result.error || result.data) return result;

      return {
        ...result,
        error: new CombinedError({
          networkError: new Error(
            'updateNotifications mutation returned no data'
          ),
        }),
      };
    },
    onMutate: options.onMutate,
    onSuccess: (data, input, context) =>
      options.onSuccess?.(data?.updateNotifications ?? [], input, context),
    onError: (error, input, context) =>
      options.onError?.(error, input, context),
    onSettled: (data, error, input, context) =>
      options.onSettled?.(data?.updateNotifications, error, input, context),
  }));
}
