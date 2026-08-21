/** Application-local Solid bindings for urql query operations. */

export {
  UrqlProvider,
  type UrqlProviderProps,
  useUrqlClient,
} from './context';
export { createUrqlInfiniteQuery } from './create-urql-infinite-query';
export { createUrqlMutation } from './create-urql-mutation';
export { createUrqlQuery } from './create-urql-query';
export type {
  UrqlClientSource,
  UrqlInfiniteData,
  UrqlInfiniteQueryOptions,
  UrqlInfiniteQueryPageContext,
  UrqlInfiniteQueryResult,
  UrqlMutationExecutionOptions,
  UrqlMutationExecutor,
  UrqlMutationExecutorArgs,
  UrqlMutationOptions,
  UrqlMutationResult,
  UrqlQueryFetchStatus,
  UrqlQueryOptions,
  UrqlQueryRefetchOptions,
  UrqlQueryResult,
  UrqlQueryStatus,
} from './types';
