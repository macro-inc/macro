import {
  enableGraphqlSoup,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { throwOnErr } from '@core/util/result';
import type { EntityData } from '@entity';
import { storageServiceClient } from '@service-storage/client';
import type { AddFavoriteRequest } from '@service-storage/generated/schemas/addFavoriteRequest';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import type { FavoritesList } from '@service-storage/generated/schemas/favoritesList';
import {
  graphqlReorderFavoritesResult,
  type ReorderFavoritesResult,
} from '@service-storage/graphql-favorites';
import { useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';

import { queryClient } from '../client';
import { type MutationCallbacks, withCallbacks } from '../utils';

import {
  createGraphqlFavoritesQuery,
  createGraphqlReorderFavoritesMutation,
  createGraphqlSetFavoriteMutation,
  refreshActiveGraphqlFavoritesQueries,
} from './graphql';
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

/** The user's favorites from the transport selected at hook creation. */
export function useFavoritesQuery() {
  if (isFeatureEnabled(enableGraphqlSoup)) {
    return createGraphqlFavoritesQuery();
  }

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
 * The REST query's `data` property suspends while pending and throws on error,
 * while the urql-solid result does neither. Favorites are read from broad
 * surfaces (command menu conditions and descriptions, the sidebar, context
 * menus) where a slow or failing request must never take the surface down.
 * Gating on the shared `isSuccess` status keeps both transports reactive and
 * returns `undefined` until the list has loaded.
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
  if (isFeatureEnabled(enableGraphqlSoup)) {
    return refreshActiveGraphqlFavoritesQueries().then(() => undefined);
  }

  return queryClient.invalidateQueries({
    queryKey: favoriteKeys.list.queryKey,
  });
}

type FavoriteMutationContext = { rollback: () => void } | undefined;

type AddFavoriteArgs = AddFavoriteRequest;
type AddFavoriteCallbacks = MutationCallbacks<
  Favorite,
  Error,
  AddFavoriteArgs,
  FavoriteMutationContext
>;

function pendingFavorite(args: AddFavoriteArgs): Favorite {
  return {
    entityType: args.entityType,
    entityId: args.entityId,
    sortOrder: Number.MAX_SAFE_INTEGER,
    createdAt: new Date().toISOString(),
  };
}

export function useAddFavoriteMutation(callbacks?: AddFavoriteCallbacks) {
  if (isFeatureEnabled(enableGraphqlSoup)) {
    const mutation = createGraphqlSetFavoriteMutation<FavoriteMutationContext>({
      favorite: true,
      onMutate: async (args) =>
        await callbacks?.onMutate?.(args, undefined as never),
      onSuccess: async (favorite, args, context) => {
        await callbacks?.onSuccess?.(
          favorite ?? pendingFavorite(args),
          args,
          context,
          undefined as never
        );
      },
      onError: async (error, args, context) => {
        await callbacks?.onError?.(error, args, context, undefined as never);
      },
      onSettled: async (favorite, error, args, context) => {
        await callbacks?.onSettled?.(
          favorite,
          error,
          args,
          context,
          undefined as never
        );
      },
    });
    return {
      get isPending() {
        return mutation.isPending;
      },
      get error() {
        return mutation.error;
      },
      mutate: mutation.mutate,
      async mutateAsync(args: AddFavoriteArgs): Promise<Favorite> {
        const result = await mutation.mutateAsync(args);
        if (result.error) throw result.error;
        return pendingFavorite(args);
      },
    };
  }

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
          const optimistic = pendingFavorite(args);
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
  if (isFeatureEnabled(enableGraphqlSoup)) {
    const mutation = createGraphqlSetFavoriteMutation<FavoriteMutationContext>({
      favorite: false,
      onMutate: async (args) =>
        await callbacks?.onMutate?.(args, undefined as never),
      onSuccess: async (_favorite, args, context) => {
        await callbacks?.onSuccess?.(
          undefined,
          args,
          context,
          undefined as never
        );
      },
      onError: async (error, args, context) => {
        await callbacks?.onError?.(error, args, context, undefined as never);
      },
      onSettled: async (_favorite, error, args, context) => {
        await callbacks?.onSettled?.(
          undefined,
          error,
          args,
          context,
          undefined as never
        );
      },
    });
    return {
      get isPending() {
        return mutation.isPending;
      },
      get error() {
        return mutation.error;
      },
      mutate: mutation.mutate,
      async mutateAsync(args: RemoveFavoriteArgs): Promise<void> {
        const result = await mutation.mutateAsync(args);
        if (result.error) throw result.error;
      },
    };
  }

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
  /** The user's favorited entities in the desired order. */
  favorites: { entityType: FavoriteEntityType; entityId: string }[];
};
type ReorderFavoritesCallbacks = MutationCallbacks<
  ReorderFavoritesResult,
  Error,
  ReorderFavoritesArgs,
  FavoriteMutationContext
>;

export function useReorderFavoritesMutation(
  callbacks?: ReorderFavoritesCallbacks
) {
  if (isFeatureEnabled(enableGraphqlSoup)) {
    const mutation =
      createGraphqlReorderFavoritesMutation<FavoriteMutationContext>({
        onMutate: async (args) =>
          await callbacks?.onMutate?.(args, undefined as never),
        onSuccess: async (result, args, context) => {
          await callbacks?.onSuccess?.(
            result,
            args,
            context,
            undefined as never
          );
        },
        onError: async (error, args, context) => {
          await callbacks?.onError?.(error, args, context, undefined as never);
        },
        onSettled: async (result, error, args, context) => {
          await callbacks?.onSettled?.(
            result,
            error,
            args,
            context,
            undefined as never
          );
        },
      });
    return {
      get isPending() {
        return mutation.isPending;
      },
      get error() {
        return mutation.error;
      },
      mutate: mutation.mutate,
      async mutateAsync(
        args: ReorderFavoritesArgs
      ): Promise<ReorderFavoritesResult> {
        if (args.favorites.length === 0) return { kind: 'committed' };
        return graphqlReorderFavoritesResult(await mutation.mutateAsync(args));
      },
    };
  }

  return useMutation(() => ({
    mutationFn: async (
      args: ReorderFavoritesArgs
    ): Promise<ReorderFavoritesResult> => {
      // Entities the user has not favorited (e.g. an optimistic row whose add
      // is still in flight) are ignored by the backend.
      if (args.favorites.length === 0) return { kind: 'committed' };
      await throwOnErr(() =>
        storageServiceClient.favorites.reorderFavorites({
          favorites: args.favorites,
        })
      );
      return { kind: 'committed' };
    },
    ...withCallbacks<
      ReorderFavoritesResult,
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
            const byKey = new Map(
              favorites.map((f) => [
                favoriteEntityKey(f.entityType, f.entityId),
                f,
              ])
            );
            const orderedKeys = args.favorites.map((f) =>
              favoriteEntityKey(f.entityType, f.entityId)
            );
            const ordered = orderedKeys
              .map((key) => byKey.get(key))
              .filter((f): f is Favorite => !!f);
            const orderedSet = new Set(orderedKeys);
            const leftover = favorites.filter(
              (f) =>
                !orderedSet.has(favoriteEntityKey(f.entityType, f.entityId))
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
