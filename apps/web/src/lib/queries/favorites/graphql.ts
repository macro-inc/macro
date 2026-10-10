import {
  createUrqlMutation,
  createUrqlQuery,
  type UrqlMutationExecutorArgs,
  type UrqlQueryResult,
} from '@app/lib/urql-solid';
import { optimisticMutationDispositionOf } from '@graphql-cache/exchange/optimistic';
import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import type { FavoritesList } from '@service-storage/generated/schemas/favoritesList';
import type { ListFavoritesParams } from '@service-storage/generated/schemas/listFavoritesParams';
import {
  FavoritesDocument,
  type FavoritesQuery,
  type FavoritesQueryVariables,
  ReorderFavoritesDocument,
  SetFavoriteDocument,
} from '@service-storage/graphql/generated/graphql';
import {
  executeGraphqlReorderFavoritesMutation,
  executeGraphqlSetFavoriteMutation,
  graphqlReorderFavoritesResult,
  graphqlSetFavoriteResult,
  mapGraphqlFavorite,
  type ReorderFavoritesResult,
  type SetFavoriteArgs,
  toGraphqlFavoriteEntityType,
  UNFILTERED_FAVORITES_VARIABLES,
} from '@service-storage/graphql-favorites';
import {
  getGraphqlCacheHost,
  getGraphqlSoupClient,
} from '@service-storage/graphql-soup';
import type { AnyVariables, Client, OperationResult } from '@urql/core';
import { onCleanup } from 'solid-js';
import type { FavoriteMutationCallbacks } from './mutation';

type GraphqlReorderFavoritesArgs = { favorites: SetFavoriteArgs[] };
type GraphqlFavoritesQuery = UrqlQueryResult<
  FavoritesList,
  FavoritesQueryVariables,
  FavoritesQuery
>;

type ActiveFavoritesQuery = { query: GraphqlFavoritesQuery };

const activeFavoritesQueries = new Set<ActiveFavoritesQuery>();

function selectFavorites(data: FavoritesQuery): FavoritesList {
  return {
    favorites: data.user.favorites
      .map(mapGraphqlFavorite)
      .sort((left, right) => left.sortOrder - right.sortOrder),
  };
}

function favoritesQueryVariables(
  filter: ListFavoritesParams | undefined
): FavoritesQueryVariables {
  return filter
    ? {
        filter: {
          entityTypes: filter.entityType?.map(toGraphqlFavoriteEntityType),
          entityIds: filter.entityId,
        },
      }
    : UNFILTERED_FAVORITES_VARIABLES;
}

/**
 * Creates the live urql-solid favorites query. The cache derives each list's
 * members and order from favorite records, so mutations, pushes and other
 * tabs reach every mounted list without per-list recipes.
 */
export function createGraphqlFavoritesQuery(
  filter?: ListFavoritesParams
): GraphqlFavoritesQuery {
  const variables = favoritesQueryVariables(filter);
  const query = createUrqlQuery<
    FavoritesQuery,
    FavoritesQueryVariables,
    FavoritesList
  >(() => ({
    query: FavoritesDocument,
    client: getGraphqlSoupClient(),
    variables,
    requestPolicy: 'cache-and-network',
    keepPreviousData: false,
    select: selectFavorites,
  }));

  const active = { query };
  activeFavoritesQueries.add(active);
  onCleanup(() => activeFavoritesQueries.delete(active));
  return query;
}

/** Refetches mounted lists, including clients running without the cache exchange. */
export async function refreshActiveGraphqlFavoritesQueries(): Promise<void> {
  await Promise.all(
    [...activeFavoritesQueries].map(({ query }) =>
      // Refetch replaces the observer's subscription. Read through the cache
      // to register its dependencies even if the network request fails, so
      // later offline optimistic writes still update this mounted list.
      query.refetch({ requestPolicy: 'cache-and-network' })
    )
  );
}

/**
 * The sort order the server assigns: an existing favorite keeps its own, and
 * a new one appends after the user's highest. Mounted lists already include
 * pending favorites, so consecutive adds keep their order.
 */
function predictedFavoriteSortOrder(favorite: SetFavoriteArgs): number {
  let maximum = -1;
  for (const { query } of activeFavoritesQueries) {
    for (const listed of query.data?.favorites ?? []) {
      if (
        listed.entityType === favorite.entityType &&
        listed.entityId === favorite.entityId
      )
        return listed.sortOrder;
      maximum = Math.max(maximum, listed.sortOrder);
    }
  }
  return maximum + 1;
}

/** Adapt urql results and callbacks to the same small contract as REST favorites. */
function createFavoriteMutation<
  Data,
  Variables extends AnyVariables,
  Input,
  Result,
  Context,
>(options: {
  mutation: TypedDocumentNode<Data, Variables>;
  execute: (
    client: Client,
    input: Input
  ) => Promise<OperationResult<Data, Variables>>;
  select: (result: OperationResult<Data, Variables>) => Result;
  callbacks: FavoriteMutationCallbacks<Result, Input, Context>;
}) {
  const { callbacks, select } = options;
  const mutation = createUrqlMutation<
    Data,
    Variables,
    Input,
    Context | undefined
  >(() => ({
    mutation: options.mutation,
    client: getGraphqlSoupClient(),
    execute: async ({
      client,
      input,
    }: UrqlMutationExecutorArgs<Data, Variables, Input>) => {
      const result = await options.execute(client, input);
      // Validate before onSuccess, so malformed responses take the error
      // lifecycle too. Server-side failures are already transport errors,
      // allowing the cache exchange to roll back live and replayed writes.
      if (!result.error) select(result);
      return result;
    },
    onMutate: callbacks.onMutate,
    onSuccess: async (_data, input, context, result) => {
      // With the normalized cache, mounted lists derive their members from
      // the settled records. Without it, only a refetch can update them.
      if (
        !getGraphqlCacheHost() &&
        optimisticMutationDispositionOf(result)?.kind !== 'queued'
      ) {
        await refreshActiveGraphqlFavoritesQueries();
      }
      await callbacks.onSuccess?.(select(result), input, context);
    },
    onError: (error, input, context) =>
      callbacks.onError?.(error, input, context),
    onSettled: (_data, error, input, context, result) =>
      callbacks.onSettled?.(
        !error && result ? select(result) : undefined,
        error,
        input,
        context
      ),
  }));
  return {
    get isPending() {
      return mutation.isPending;
    },
    get error() {
      return mutation.error;
    },
    mutate(input: Input): void {
      mutation.mutate(input);
    },
    async mutateAsync(input: Input): Promise<Result> {
      return select(await mutation.mutateAsync(input));
    },
  };
}

/** Add a favorite, returning its persisted or queued optimistic payload. */
export function createGraphqlAddFavoriteMutation<Context = void>(
  callbacks: FavoriteMutationCallbacks<
    Favorite | undefined,
    SetFavoriteArgs,
    Context
  > = {}
) {
  return createFavoriteMutation({
    mutation: SetFavoriteDocument,
    execute: (client, input: SetFavoriteArgs) =>
      executeGraphqlSetFavoriteMutation(
        client,
        input,
        true,
        predictedFavoriteSortOrder(input)
      ),
    select: graphqlSetFavoriteResult,
    callbacks,
  });
}

/** Remove a favorite without requiring any mounted favorites query. */
export function createGraphqlRemoveFavoriteMutation<Context = void>(
  callbacks: FavoriteMutationCallbacks<void, SetFavoriteArgs, Context> = {}
) {
  return createFavoriteMutation({
    mutation: SetFavoriteDocument,
    execute: (client, input: SetFavoriteArgs) =>
      executeGraphqlSetFavoriteMutation(client, input, false, 0),
    select: (result) => {
      graphqlSetFavoriteResult(result);
    },
    callbacks,
  });
}

/** Creates the durable urql-solid favorites reorder mutation. */
export function createGraphqlReorderFavoritesMutation<Context = void>(
  callbacks: FavoriteMutationCallbacks<
    ReorderFavoritesResult,
    GraphqlReorderFavoritesArgs,
    Context
  > = {}
) {
  return createFavoriteMutation({
    mutation: ReorderFavoritesDocument,
    execute: (client, input) =>
      executeGraphqlReorderFavoritesMutation(client, input),
    select: graphqlReorderFavoritesResult,
    callbacks,
  });
}
