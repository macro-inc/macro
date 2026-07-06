import { throwOnErr } from '@core/util/result';
import type { EntityData } from '@entity';
import { storageServiceClient } from '@service-storage/client';
import type { AddFavoriteRequest } from '@service-storage/generated/schemas/addFavoriteRequest';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import type { FavoritesList } from '@service-storage/generated/schemas/favoritesList';
import { useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';

import { queryClient } from '../client';
import { type MutationCallbacks, withCallbacks } from '../utils';

import { favoriteKeys } from './keys';

export type FavoriteEntityType = AddFavoriteRequest['entityType'];

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
    default:
      return undefined;
  }
}

export function favoriteEntityKey(
  entityType: FavoriteEntityType,
  entityId: string
): string {
  return `${entityType}:${entityId}`;
}

/** The user's favorites. */
export function useFavoritesQuery() {
  return useQuery(() => ({
    queryKey: favoriteKeys.list.queryKey,
    queryFn: async () =>
      await throwOnErr(() => storageServiceClient.favorites.getFavorites()),
    staleTime: 60_000,
  }));
}

/**
 * Non-suspending, non-throwing view of the favorites list.
 *
 * Reading `query.data` off the solid-query proxy suspends the nearest
 * Suspense boundary while the query is pending and throws once it errors.
 * Favorites are read from broad surfaces (command menu conditions and
 * descriptions, the sidebar, context menus) where a slow or failing
 * favorites request must never take the surface down. Gating on `isSuccess`
 * keeps the read reactive without either behavior; callers see `undefined`
 * until the list has loaded.
 */
export function useFavoritesData(): Accessor<FavoritesList | undefined> {
  const query = useFavoritesQuery();
  return () => (query.isSuccess ? query.data : undefined);
}

function readList(): FavoritesList | undefined {
  return queryClient.getQueryData<FavoritesList>(favoriteKeys.list.queryKey);
}

function writeList(update: (prev: FavoritesList) => FavoritesList) {
  queryClient.setQueryData<FavoritesList>(favoriteKeys.list.queryKey, (prev) =>
    prev ? update(prev) : prev
  );
}

export function invalidateFavorites() {
  return queryClient.invalidateQueries({
    queryKey: favoriteKeys.list.queryKey,
  });
}

type FavoriteMutationContext = { rollback: () => void };

type AddFavoriteArgs = AddFavoriteRequest;
type AddFavoriteCallbacks = MutationCallbacks<
  Favorite,
  Error,
  AddFavoriteArgs,
  FavoriteMutationContext
>;

export function useAddFavoriteMutation(callbacks?: AddFavoriteCallbacks) {
  return useMutation(() => ({
    mutationFn: async (args: AddFavoriteArgs) =>
      await throwOnErr(() => storageServiceClient.favorites.addFavorite(args)),
    ...withCallbacks<Favorite, Error, AddFavoriteArgs, FavoriteMutationContext>(
      {
        onMutate: async (args: AddFavoriteArgs) => {
          await queryClient.cancelQueries({
            queryKey: favoriteKeys.list.queryKey,
          });
          const previous = readList();
          const optimistic: Favorite = {
            id: `optimistic-${args.entityType}-${args.entityId}`,
            entityType: args.entityType,
            entityId: args.entityId,
            sortOrder: Number.MAX_SAFE_INTEGER,
            createdAt: new Date().toISOString(),
          };
          writeList((prev) => ({
            ...prev,
            favorites: [...prev.favorites, optimistic],
          }));
          return {
            rollback: () => {
              if (previous) {
                queryClient.setQueryData(favoriteKeys.list.queryKey, previous);
              }
            },
          };
        },
        onError: (_error, _args, context) => {
          context?.rollback();
        },
        onSettled: () => invalidateFavorites(),
      },
      callbacks
    ),
  }));
}

type RemoveFavoriteArgs = {
  entityType: FavoriteEntityType;
  entityId: string;
};
type RemoveFavoriteCallbacks = MutationCallbacks<
  void,
  Error,
  RemoveFavoriteArgs,
  FavoriteMutationContext
>;

export function useRemoveFavoriteMutation(callbacks?: RemoveFavoriteCallbacks) {
  return useMutation(() => ({
    mutationFn: async (args: RemoveFavoriteArgs) => {
      await throwOnErr(() =>
        storageServiceClient.favorites.removeFavoriteByEntity(args)
      );
    },
    ...withCallbacks<void, Error, RemoveFavoriteArgs, FavoriteMutationContext>(
      {
        onMutate: async (args: RemoveFavoriteArgs) => {
          await queryClient.cancelQueries({
            queryKey: favoriteKeys.list.queryKey,
          });
          const previous = readList();
          const keep = (favorite: Favorite) =>
            !(
              favorite.entityType === args.entityType &&
              favorite.entityId === args.entityId
            );
          writeList((prev) => ({
            ...prev,
            favorites: prev.favorites.filter(keep),
          }));
          return {
            rollback: () => {
              if (previous) {
                queryClient.setQueryData(favoriteKeys.list.queryKey, previous);
              }
            },
          };
        },
        onError: (_error, _args, context) => {
          context?.rollback();
        },
        onSettled: () => invalidateFavorites(),
      },
      callbacks
    ),
  }));
}

type ReorderFavoritesArgs = {
  favoriteIds: string[];
};
type ReorderFavoritesCallbacks = MutationCallbacks<
  void,
  Error,
  ReorderFavoritesArgs,
  FavoriteMutationContext
>;

export function useReorderFavoritesMutation(
  callbacks?: ReorderFavoritesCallbacks
) {
  return useMutation(() => ({
    mutationFn: async (args: ReorderFavoritesArgs) => {
      // A reorder can race an in-flight add whose optimistic row carries a
      // placeholder id the server has never seen. Sending it would fail the
      // whole reorder (the backend expects real UUIDs); drop it and reorder
      // the persisted ids only.
      const favoriteIds = args.favoriteIds.filter(
        (id) => !id.startsWith('optimistic-')
      );
      if (favoriteIds.length === 0) return;
      await throwOnErr(() =>
        storageServiceClient.favorites.reorderFavorites({ favoriteIds })
      );
    },
    ...withCallbacks<
      void,
      Error,
      ReorderFavoritesArgs,
      FavoriteMutationContext
    >(
      {
        onMutate: async (args: ReorderFavoritesArgs) => {
          await queryClient.cancelQueries({
            queryKey: favoriteKeys.list.queryKey,
          });
          const previous = readList();
          const reorder = (favorites: Favorite[]) => {
            const byId = new Map(favorites.map((f) => [f.id, f]));
            const ordered = args.favoriteIds
              .map((id) => byId.get(id))
              .filter((f): f is Favorite => !!f);
            const leftover = favorites.filter(
              (f) => !args.favoriteIds.includes(f.id)
            );
            return [...ordered, ...leftover];
          };
          writeList((prev) => ({
            ...prev,
            favorites: reorder(prev.favorites),
          }));
          return {
            rollback: () => {
              if (previous) {
                queryClient.setQueryData(favoriteKeys.list.queryKey, previous);
              }
            },
          };
        },
        onError: (_error, _args, context) => {
          context?.rollback();
        },
        onSettled: () => invalidateFavorites(),
      },
      callbacks
    ),
  }));
}
