import {
  enableGraphqlSoup,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { throwOnErr } from '@core/util/result';
import {
  executeOptimisticMutation,
  optimisticMutationDispositionOf,
} from '@graphql-cache/exchange/optimistic';
import type { Client } from '@urql/core';
import { storageServiceClient } from './client';
import type { FavoriteEntityType } from './generated/schemas/favoriteEntityType';
import type { ReorderFavoritesRequest } from './generated/schemas/reorderFavoritesRequest';
import {
  type GraphqlEntityType,
  ReorderFavoritesDocument,
  type ReorderFavoritesMutation,
  type ReorderFavoritesMutationVariables,
} from './graphql/generated/graphql';
import { getGraphqlSoupClient } from './graphql-soup';

const FAVORITE_ENTITY_TYPE_TO_GRAPHQL = {
  user: 'USER',
  chat: 'CHAT',
  channel: 'CHANNEL',
  channel_message: 'CHANNEL_MESSAGE',
  document: 'DOCUMENT',
  project: 'PROJECT',
  email_thread: 'EMAIL_THREAD',
  calendar_event: 'CALENDAR_EVENT',
  team: 'TEAM',
  call: 'CALL',
  foreign_entity: 'FOREIGN_ENTITY',
  static_file: 'STATIC_FILE',
  crm_company: 'CRM_COMPANY',
  crm_contact: 'CRM_CONTACT',
  reminder: 'REMINDER',
  skill: 'SKILL',
  agent_session: 'AGENT_SESSION',
} satisfies Record<FavoriteEntityType, GraphqlEntityType>;

/**
 * Reorders describe the complete value of one user-owned slot, so a newer
 * offline reorder can safely replace an older queued reorder.
 */
const REORDER_FAVORITES_OPTIMISTIC_UUID =
  '86cc4bfe-c45a-4e28-880a-6ba5ca921d35';

/** Whether the reorder committed remotely or was accepted by the offline queue. */
export type ReorderFavoritesResult =
  | { kind: 'committed' }
  | { kind: 'queued'; transactionId: string };

/** Execute a durable optimistic GraphQL favorites reorder. */
export async function executeGraphqlReorderFavorites(
  client: Client,
  args: ReorderFavoritesRequest
): Promise<ReorderFavoritesResult> {
  const favorites = args.favorites.map((favorite, sortOrder) => ({
    __typename: 'GraphqlFavorite' as const,
    entityType: FAVORITE_ENTITY_TYPE_TO_GRAPHQL[favorite.entityType],
    entityId: favorite.entityId,
    sortOrder,
  }));
  const variables: ReorderFavoritesMutationVariables = {
    input: {
      favorites: favorites.map((favorite) => ({
        type: favorite.entityType,
        id: favorite.entityId,
      })),
    },
  };
  const optimisticData: ReorderFavoritesMutation = {
    reorderFavorites: favorites,
  };
  const result = await executeOptimisticMutation(
    client,
    ReorderFavoritesDocument,
    variables,
    optimisticData,
    { uuid: REORDER_FAVORITES_OPTIMISTIC_UUID }
  ).toPromise();

  const disposition = optimisticMutationDispositionOf(result);
  if (disposition?.kind === 'queued') {
    return {
      kind: 'queued',
      transactionId: disposition.transactionId,
    };
  }
  if (disposition?.kind === 'permanently-failed') {
    throw disposition.error;
  }
  if (result.error) throw result.error;
  if (!result.data) {
    throw new Error('reorderFavorites mutation returned no data');
  }

  return { kind: 'committed' };
}

/** Reorder favorites through the configured REST or GraphQL transport. */
export async function reorderFavorites(
  args: ReorderFavoritesRequest
): Promise<ReorderFavoritesResult> {
  if (!isFeatureEnabled(enableGraphqlSoup)) {
    await throwOnErr(() =>
      storageServiceClient.favorites.reorderFavorites(args)
    );
    return { kind: 'committed' };
  }

  return await executeGraphqlReorderFavorites(getGraphqlSoupClient(), args);
}
