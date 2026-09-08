import {
  createUrqlMutation,
  createUrqlQuery,
  type UrqlQueryResult,
} from '@app/lib/urql-solid';
import { optimisticMutationDispositionOf } from '@graphql-cache/exchange/optimistic';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import type { FavoriteEntityType } from '@service-storage/generated/schemas/favoriteEntityType';
import type { FavoritesList } from '@service-storage/generated/schemas/favoritesList';
import {
  FavoritesDocument,
  type FavoritesQuery,
  type FavoritesQueryVariables,
  ReorderFavoritesDocument,
  type ReorderFavoritesMutation,
  type ReorderFavoritesMutationVariables,
  SetFavoriteDocument,
  type SetFavoriteMutation,
  type SetFavoriteMutationVariables,
} from '@service-storage/graphql/generated/graphql';
import {
  executeGraphqlReorderFavoritesMutation,
  executeGraphqlSetFavoriteMutation,
  graphqlReorderFavoritesResult,
  mapGraphqlFavorite,
  type ReorderFavoritesResult,
} from '@service-storage/graphql-favorites';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import { CombinedError, type OperationResult } from '@urql/core';
import { onCleanup } from 'solid-js';

export type GraphqlFavoriteMutationArgs = {
  entityType: FavoriteEntityType;
  entityId: string;
};

export type GraphqlReorderFavoritesArgs = {
  favorites: GraphqlFavoriteMutationArgs[];
};

type GraphqlFavoritesQuery = UrqlQueryResult<
  FavoritesList,
  FavoritesQueryVariables,
  FavoritesQuery
>;

const activeFavoritesQueries = new Set<GraphqlFavoritesQuery>();

function selectFavorites(data: FavoritesQuery): FavoritesList {
  return {
    favorites: data.user.favorites
      .map(mapGraphqlFavorite)
      .sort((left, right) => left.sortOrder - right.sortOrder),
  };
}

/** Creates the live urql-solid favorites query. */
export function createGraphqlFavoritesQuery(): GraphqlFavoritesQuery {
  const query = createUrqlQuery<
    FavoritesQuery,
    FavoritesQueryVariables,
    FavoritesList
  >(() => ({
    query: FavoritesDocument,
    client: getGraphqlSoupClient(),
    variables: {},
    requestPolicy: 'cache-and-network',
    keepPreviousData: false,
    select: selectFavorites,
  }));

  activeFavoritesQueries.add(query);
  onCleanup(() => activeFavoritesQueries.delete(query));
  return query;
}

/** Refetches every mounted GraphQL favorites query from the network. */
export async function refreshActiveGraphqlFavoritesQueries(): Promise<
  FavoritesList | undefined
> {
  const results = await Promise.all(
    [...activeFavoritesQueries].map((query) =>
      query.refetch({ requestPolicy: 'network-only' })
    )
  );
  return results.find((result) => result.data)?.data;
}

type SetFavoriteMutationOptions<Context> = {
  favorite: boolean;
  onMutate?: (
    input: GraphqlFavoriteMutationArgs
  ) => Context | undefined | Promise<Context | undefined>;
  onSuccess?: (
    favorite: Favorite | undefined,
    input: GraphqlFavoriteMutationArgs,
    context: Context | undefined
  ) => void | Promise<void>;
  onError?: (
    error: Error,
    input: GraphqlFavoriteMutationArgs,
    context: Context | undefined
  ) => void | Promise<void>;
  onSettled?: (
    favorite: Favorite | undefined,
    error: Error | null,
    input: GraphqlFavoriteMutationArgs,
    context: Context | undefined
  ) => void | Promise<void>;
};

function mutationError(
  result: OperationResult<SetFavoriteMutation, SetFavoriteMutationVariables>
): OperationResult<SetFavoriteMutation, SetFavoriteMutationVariables> {
  if (result.error) return result;
  const payload = result.data?.setFavorite;
  const mutationResult = payload?.result;
  const message =
    mutationResult?.__typename === 'GraphqlMutationError'
      ? mutationResult.message
      : mutationResult
        ? undefined
        : 'setFavorite mutation returned no data';
  if (!message) return result;
  return {
    ...result,
    error: new CombinedError({ graphQLErrors: [new Error(message)] }),
  };
}

function nextFavoriteSortOrder(): number {
  let maximum = -1;
  for (const query of activeFavoritesQueries) {
    for (const favorite of query.data?.favorites ?? []) {
      maximum = Math.max(maximum, favorite.sortOrder);
    }
  }
  return maximum + 1;
}

function findActiveFavorite(
  input: GraphqlFavoriteMutationArgs
): Favorite | undefined {
  for (const query of activeFavoritesQueries) {
    const favorite = query.data?.favorites.find(
      (favorite) =>
        favorite.entityType === input.entityType &&
        favorite.entityId === input.entityId
    );
    if (favorite) return favorite;
  }
  return undefined;
}

/** Creates an urql-solid add/remove favorite mutation. */
export function createGraphqlSetFavoriteMutation<Context = void>(
  options: SetFavoriteMutationOptions<Context>
) {
  return createUrqlMutation<
    SetFavoriteMutation,
    SetFavoriteMutationVariables,
    GraphqlFavoriteMutationArgs,
    Context | undefined
  >(() => ({
    mutation: SetFavoriteDocument,
    client: getGraphqlSoupClient(),
    execute: async ({ client, input }) =>
      mutationError(
        await executeGraphqlSetFavoriteMutation(
          client,
          input,
          options.favorite,
          nextFavoriteSortOrder()
        )
      ),
    onMutate: options.onMutate,
    onSuccess: async (_data, input, context, result) => {
      const disposition = optimisticMutationDispositionOf(result);
      if (disposition?.kind !== 'queued') {
        await refreshActiveGraphqlFavoritesQueries();
      }
      await options.onSuccess?.(findActiveFavorite(input), input, context);
    },
    onError: (error, input, context) =>
      options.onError?.(error, input, context),
    onSettled: (_data, error, input, context) =>
      options.onSettled?.(findActiveFavorite(input), error, input, context),
  }));
}

type ReorderMutationOptions<Context> = {
  onMutate?: (
    input: GraphqlReorderFavoritesArgs
  ) => Context | undefined | Promise<Context | undefined>;
  onSuccess?: (
    result: ReorderFavoritesResult,
    input: GraphqlReorderFavoritesArgs,
    context: Context | undefined
  ) => void | Promise<void>;
  onError?: (
    error: Error,
    input: GraphqlReorderFavoritesArgs,
    context: Context | undefined
  ) => void | Promise<void>;
  onSettled?: (
    result: ReorderFavoritesResult | undefined,
    error: Error | null,
    input: GraphqlReorderFavoritesArgs,
    context: Context | undefined
  ) => void | Promise<void>;
};

/** Creates the durable urql-solid favorites reorder mutation. */
export function createGraphqlReorderFavoritesMutation<Context = void>(
  options: ReorderMutationOptions<Context> = {}
) {
  return createUrqlMutation<
    ReorderFavoritesMutation,
    ReorderFavoritesMutationVariables,
    GraphqlReorderFavoritesArgs,
    Context | undefined
  >(() => ({
    mutation: ReorderFavoritesDocument,
    client: getGraphqlSoupClient(),
    execute: ({ client, input }) =>
      executeGraphqlReorderFavoritesMutation(client, input),
    onMutate: options.onMutate,
    onSuccess: async (_data, input, context, result) => {
      const disposition = graphqlReorderFavoritesResult(result);
      if (disposition.kind === 'committed') {
        await refreshActiveGraphqlFavoritesQueries();
      }
      await options.onSuccess?.(disposition, input, context);
    },
    onError: (error, input, context) =>
      options.onError?.(error, input, context),
    onSettled: (_data, error, input, context, result) =>
      options.onSettled?.(
        !error && result ? graphqlReorderFavoritesResult(result) : undefined,
        error,
        input,
        context
      ),
  }));
}
