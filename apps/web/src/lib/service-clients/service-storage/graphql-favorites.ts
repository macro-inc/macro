import {
  enableGraphqlSoup,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { throwOnErr } from '@core/util/result';
import {
  executeOptimisticMutation,
  optimisticMutationDispositionOf,
} from '@graphql-cache/exchange/optimistic';
import type { Client, OperationResult } from '@urql/core';
import { storageServiceClient } from './client';
import type { Favorite } from './generated/schemas/favorite';
import type { FavoriteEntityType } from './generated/schemas/favoriteEntityType';
import type { ReorderFavoritesRequest } from './generated/schemas/reorderFavoritesRequest';
import {
  type FavoriteFieldsFragment,
  FavoritesDocument,
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

const GRAPHQL_ENTITY_TYPE_TO_FAVORITE = {
  AGENT_SESSION: 'agent_session',
  CALENDAR_EVENT: 'calendar_event',
  CALL: 'call',
  CHANNEL: 'channel',
  CHANNEL_MESSAGE: 'channel_message',
  CHAT: 'chat',
  CRM_COMPANY: 'crm_company',
  CRM_CONTACT: 'crm_contact',
  DOCUMENT: 'document',
  EMAIL_THREAD: 'email_thread',
  FOREIGN_ENTITY: 'foreign_entity',
  PROJECT: 'project',
  REMINDER: 'reminder',
  SKILL: 'skill',
  STATIC_FILE: 'static_file',
  TEAM: 'team',
  USER: 'user',
} satisfies Record<GraphqlEntityType, FavoriteEntityType>;

/** Convert a REST favorite entity type into its GraphQL equivalent. */
export function toGraphqlFavoriteEntityType(
  entityType: FavoriteEntityType
): GraphqlEntityType {
  return FAVORITE_ENTITY_TYPE_TO_GRAPHQL[entityType];
}

/** Convert one GraphQL favorite into the shared favorites-list shape. */
export function mapGraphqlFavorite(favorite: FavoriteFieldsFragment): Favorite {
  return {
    channelId: favorite.channelId,
    channelType: favorite.channelType,
    createdAt: favorite.createdAt,
    documentSubType: favorite.documentSubType,
    entityId: favorite.entityId,
    entityType: GRAPHQL_ENTITY_TYPE_TO_FAVORITE[favorite.entityType],
    fileType: favorite.fileType,
    sortOrder: favorite.sortOrder,
  };
}

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

/** Submit a durable optimistic GraphQL favorites reorder. */
export function executeGraphqlReorderFavoritesMutation(
  client: Client,
  args: ReorderFavoritesRequest
): Promise<
  OperationResult<ReorderFavoritesMutation, ReorderFavoritesMutationVariables>
> {
  const favorites = args.favorites.map((favorite, sortOrder) => ({
    __typename: 'GraphqlFavorite' as const,
    id: `${favorite.entityType}:${favorite.entityId}`,
    entityType: toGraphqlFavoriteEntityType(favorite.entityType),
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
  return executeOptimisticMutation(
    client,
    ReorderFavoritesDocument,
    variables,
    optimisticData,
    {
      uuid: REORDER_FAVORITES_OPTIMISTIC_UUID,
      revalidations: [{ document: FavoritesDocument, variables: {} }],
    }
  ).toPromise();
}

/** Interpret a GraphQL reorder operation as a caller-facing disposition. */
export function graphqlReorderFavoritesResult(
  result: OperationResult<
    ReorderFavoritesMutation,
    ReorderFavoritesMutationVariables
  >
): ReorderFavoritesResult {
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

/** Execute a durable optimistic GraphQL favorites reorder. */
export async function executeGraphqlReorderFavorites(
  client: Client,
  args: ReorderFavoritesRequest
): Promise<ReorderFavoritesResult> {
  return graphqlReorderFavoritesResult(
    await executeGraphqlReorderFavoritesMutation(client, args)
  );
}

/** Reorder favorites through the configured REST or GraphQL transport. */
export async function reorderFavorites(
  args: ReorderFavoritesRequest,
  graphqlSoupEnabled = isFeatureEnabled(enableGraphqlSoup)
): Promise<ReorderFavoritesResult> {
  if (!graphqlSoupEnabled) {
    await throwOnErr(() =>
      storageServiceClient.favorites.reorderFavorites(args)
    );
    return { kind: 'committed' };
  }

  return await executeGraphqlReorderFavorites(getGraphqlSoupClient(), args);
}
