import { useIsAuthenticated } from '@core/context/user';
import type { EntityData } from '@entity';
import type { AddFavoriteRequest } from '@service-storage/generated/schemas/addFavoriteRequest';
import type { FavoritesList } from '@service-storage/generated/schemas/favoritesList';
import type { ListFavoritesParams } from '@service-storage/generated/schemas/listFavoritesParams';
import type { FavoriteWriteResult } from '@service-storage/graphql-favorites';
import type { Accessor } from 'solid-js';

import {
  createGraphqlAddFavoriteMutation,
  createGraphqlFavoritesQuery,
  createGraphqlRemoveFavoriteMutation,
  createGraphqlReorderFavoritesMutation,
  refreshActiveGraphqlFavoritesQueries,
} from './graphql';
import type { FavoriteMutationCallbacks } from './mutation';

export type FavoriteEntityType = AddFavoriteRequest['entityType'];
export type FavoritesFilter = ListFavoritesParams;

/**
 * Maps a frontend entity to the backend favorites entity type, or undefined
 * for entity kinds that cannot be favorited.
 */
export function favoriteEntityType(
  type: EntityData['type']
): FavoriteEntityType | undefined {
  switch (type) {
    case 'document':
      return 'document';
    case 'agent_session':
      return 'agent_session';
    case 'chat':
      return 'chat';
    case 'project':
      return 'project';
    case 'email':
      return 'email_thread';
    case 'channel':
      return 'channel';
    // Individual channel messages/threads are intentionally not favoritable:
    // their frontend id is a composite `channelId:messageId` that never
    // hydrates or navigates, and the entity-access layer has no access level
    // for a message, so a message favorite can't be authorized like every
    // other type. Favorite the channel instead.
    case 'call':
      return 'call';
    case 'crm_company':
      return 'crm_company';
    case 'crm_contact':
      return 'crm_contact';
    case 'foreign':
      return 'foreign_entity';
    case 'database':
      return 'database';
    case 'form':
      return 'form';
    default:
      return undefined;
  }
}

/** The user's favorites. */
export function useFavoritesQuery(filter?: FavoritesFilter) {
  const authenticated = useIsAuthenticated();
  return createGraphqlFavoritesQuery(filter, () => authenticated() === true);
}

/**
 * Non-suspending, non-throwing view of the favorites list.
 *
 * Favorites are read from broad surfaces (command menu conditions and
 * descriptions, the sidebar, context menus) where a slow or failing request
 * must never take the surface down. Keep cached GraphQL data visible even if a
 * background network request fails.
 */
export function useFavoritesData(
  filter?: FavoritesFilter,
  /** Read only while this holds, so a gated surface makes no request. */
  wanted: Accessor<boolean> = () => true
): Accessor<FavoritesList | undefined> {
  const authenticated = useIsAuthenticated();
  const enabled = () => authenticated() === true && wanted();
  const query = createGraphqlFavoritesQuery(filter, enabled);
  return () => (enabled() ? query.data : undefined);
}

export function invalidateFavorites() {
  return refreshActiveGraphqlFavoritesQueries();
}

type AddFavoriteArgs = AddFavoriteRequest;

export function useAddFavoriteMutation<Context = void>(
  callbacks?: FavoriteMutationCallbacks<
    FavoriteWriteResult,
    AddFavoriteArgs,
    Context
  >
) {
  return createGraphqlAddFavoriteMutation(callbacks);
}

type RemoveFavoriteArgs = {
  entityType: FavoriteEntityType;
  entityId: string;
};

export function useRemoveFavoriteMutation<Context = void>(
  callbacks?: FavoriteMutationCallbacks<
    FavoriteWriteResult,
    RemoveFavoriteArgs,
    Context
  >
) {
  return createGraphqlRemoveFavoriteMutation(callbacks);
}

type ReorderFavoritesArgs = {
  /** The user's favorited entities in the desired order. */
  favorites: { entityType: FavoriteEntityType; entityId: string }[];
};

export function useReorderFavoritesMutation<Context = void>(
  callbacks?: FavoriteMutationCallbacks<
    FavoriteWriteResult,
    ReorderFavoritesArgs,
    Context
  >
) {
  return createGraphqlReorderFavoritesMutation(callbacks);
}
