import {
  executeOptimisticMutation,
  optimisticMutationDispositionOf,
  prependUnique,
  remove,
  select,
  update,
} from '@graphql-cache/exchange/optimistic';
import { type Client, createRequest, type OperationResult } from '@urql/core';
import { v4 as uuidv4 } from 'uuid';
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
  SetFavoriteDocument,
  type SetFavoriteMutation,
  type SetFavoriteMutationVariables,
} from './graphql/generated/graphql';

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

/** Input for setting one entity's favorite state. */
export type SetFavoriteArgs = {
  entityType: FavoriteEntityType;
  entityId: string;
};

/** Submit a durable optimistic GraphQL add/remove favorite mutation. */
export function executeGraphqlSetFavoriteMutation(
  client: Client,
  args: SetFavoriteArgs,
  favorite: boolean,
  optimisticSortOrder: number,
  updateCachedList = true
): Promise<OperationResult<SetFavoriteMutation, SetFavoriteMutationVariables>> {
  const entityType = toGraphqlFavoriteEntityType(args.entityType);
  const optimisticFavorite: FavoriteFieldsFragment = {
    __typename: 'GraphqlFavorite',
    id: `${args.entityType}:${args.entityId}`,
    entityType,
    entityId: args.entityId,
    sortOrder: optimisticSortOrder,
    createdAt: new Date().toISOString(),
    fileType: null,
    documentSubType: null,
    channelType: null,
    channelId: null,
  };
  const identity = {
    __typename: optimisticFavorite.__typename,
    id: optimisticFavorite.id,
  };
  const favorites = select(FavoritesDocument, {})
    .field('user')
    .field('favorites');
  const optimisticData: SetFavoriteMutation = {
    setFavorite: {
      __typename: 'SetFavoritePayload',
      result: { __typename: 'GraphqlMutationSuccess' },
      favorite: favorite ? optimisticFavorite : null,
    },
  };

  return executeOptimisticMutation(
    client,
    SetFavoriteDocument,
    {
      entity: { type: entityType, id: args.entityId },
      favorite,
    },
    optimisticData,
    {
      // Membership changes also affect ordering: removing then re-adding
      // appends a favorite. Coalescing that pair into an add would preserve
      // the server's old position instead. Keep each toggle in queue order.
      uuid: uuidv4(),
      // A cold offline cache has no user.favorites field to patch. The
      // optimistic mutation itself can still be durably queued; replay
      // revalidation populates the list once the network is available.
      updates: updateCachedList
        ? [
            update(
              favorites,
              favorite ? prependUnique(identity) : remove(identity)
            ),
          ]
        : [],
      revalidations: [{ document: FavoritesDocument, variables: {} }],
    }
  ).toPromise();
}

/** Read an accepted toggle's own payload, never a mounted query's snapshot. */
export function graphqlSetFavoriteResult(
  result: OperationResult<SetFavoriteMutation, SetFavoriteMutationVariables>
): Favorite | undefined {
  const disposition = optimisticMutationDispositionOf(result);
  // Superseded operations intentionally carry no data. They are accepted via
  // their replacement, not missing-data errors. Also supports older queued work.
  if (disposition?.kind === 'queued') {
    const favorite = result.data?.setFavorite.favorite;
    return favorite ? mapGraphqlFavorite(favorite) : undefined;
  }
  if (disposition?.kind === 'permanently-failed') throw disposition.error;
  if (result.error) throw result.error;
  const payload = result.data?.setFavorite;
  if (!payload) throw new Error('setFavorite mutation returned no data');
  if (payload.result.__typename === 'GraphqlMutationError') {
    throw new Error(payload.result.message);
  }
  return payload.favorite ? mapGraphqlFavorite(payload.favorite) : undefined;
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
  // An empty reorder is a no-op, not a replacement for an existing queued order.
  if (favorites.length === 0) {
    return Promise.resolve({
      operation: client.createRequestOperation(
        'mutation',
        createRequest(ReorderFavoritesDocument, variables)
      ),
      data: optimisticData,
      stale: false,
      hasNext: false,
    });
  }
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
