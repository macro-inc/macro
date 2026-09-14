import {
  createUrqlMutation,
  createUrqlQuery,
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
  type FavoritesCacheTarget,
  graphqlReorderFavoritesResult,
  graphqlSetFavoriteResult,
  mapGraphqlFavorite,
  type ReorderFavoritesResult,
  type SetFavoriteArgs,
  toGraphqlFavoriteEntityType,
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

type ActiveFavoritesQuery = {
  query: GraphqlFavoritesQuery;
  filter: ListFavoritesParams | undefined;
  variables: FavoritesQueryVariables;
};

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
    : {};
}

function favoriteMatchesFilter(
  favorite: SetFavoriteArgs,
  filter: ListFavoritesParams | undefined
): boolean {
  return (
    (!filter?.entityType || filter.entityType.includes(favorite.entityType)) &&
    (!filter?.entityId || filter.entityId.includes(favorite.entityId))
  );
}

function activeFavoritesCacheTargets(
  favorite?: SetFavoriteArgs
): FavoritesCacheTarget[] {
  const targets = new Map<string, FavoritesCacheTarget>([
    [JSON.stringify({}), { variables: {}, updateCachedList: false }],
  ]);
  for (const active of activeFavoritesQueries) {
    if (favorite && !favoriteMatchesFilter(favorite, active.filter)) continue;
    const key = JSON.stringify(active.variables);
    targets.set(key, {
      variables: active.variables,
      updateCachedList:
        Boolean(active.query.data) ||
        Boolean(targets.get(key)?.updateCachedList),
    });
  }
  return [...targets.values()];
}

/** Creates the live urql-solid favorites query. */
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

  const active = { query, filter, variables };
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

function nextFavoriteSortOrder(): number {
  let maximum = -1;
  for (const { query } of activeFavoritesQueries) {
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
        activeFavoritesCacheTargets(input)
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
        activeFavoritesCacheTargets(input)
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
    execute: (client, input) =>
      executeGraphqlReorderFavoritesMutation(
        client,
        input,
        activeFavoritesCacheTargets().map((target) => target.variables)
      ),
    select: graphqlReorderFavoritesResult,
    callbacks,
  });
}
