import {
  createUrqlMutation,
  createUrqlQuery,
  type UrqlQueryResult,
} from '@app/lib/urql-solid';
import { optimisticMutationDispositionOf } from '@graphql-cache/exchange/optimistic';
import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import type { FavoritesList } from '@service-storage/generated/schemas/favoritesList';
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
} from '@service-storage/graphql-favorites';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import type { AnyVariables, Client, OperationResult } from '@urql/core';
import { onCleanup } from 'solid-js';
import type { FavoriteMutationCallbacks } from './mutation';

type GraphqlReorderFavoritesArgs = { favorites: SetFavoriteArgs[] };
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

/** Refetches mounted lists, including clients running without the cache exchange. */
export async function refreshActiveGraphqlFavoritesQueries(): Promise<void> {
  await Promise.all(
    [...activeFavoritesQueries].map((query) =>
      // Refetch replaces the observer's subscription. Read through the cache
      // to register its dependencies even if the network request fails, so
      // later offline optimistic writes still update this mounted list.
      query.refetch({ requestPolicy: 'cache-and-network' })
    )
  );
}

function hasCachedFavoritesList(): boolean {
  return [...activeFavoritesQueries].some((query) => query.data !== undefined);
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
    execute: async ({ client, input }) => {
      const result = await options.execute(client, input);
      // Validate before onSuccess, so malformed responses take the error
      // lifecycle too. Server-side failures are already transport errors,
      // allowing the cache exchange to roll back live and replayed writes.
      if (!result.error) select(result);
      return result;
    },
    onMutate: callbacks.onMutate,
    onSuccess: async (_data, input, context, result) => {
      if (optimisticMutationDispositionOf(result)?.kind !== 'queued') {
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
        nextFavoriteSortOrder(),
        hasCachedFavoritesList()
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
      executeGraphqlSetFavoriteMutation(
        client,
        input,
        false,
        0,
        hasCachedFavoritesList()
      ),
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
    execute: executeGraphqlReorderFavoritesMutation,
    select: graphqlReorderFavoritesResult,
    callbacks,
  });
}
