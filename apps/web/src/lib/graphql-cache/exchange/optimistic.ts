/**
 * Typed entry point for optimistic GraphQL mutations through the
 * normalized cache exchange.
 *
 * The optimistic response rides in a private urql operation-context slot;
 * the exchange installs it as an in-memory cache layer before the mutation
 * is forwarded to the network, commits the layer with the real response on
 * success, and rolls it back on error. Construction is strongly typed
 * against the generated operation (`TData` must exactly match the mutation
 * selection), while the exchange boundary reads the slot as `unknown`.
 */

import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import type {
  AnyVariables,
  Client,
  Operation,
  OperationResult,
  OperationResultSource,
} from '@urql/core';

/** Private operation-context field carrying the optimistic response. */
const OPTIMISTIC_MUTATION_CONTEXT_KEY = 'normalizedCacheOptimistic';

export type OptimisticMutationContext<TData = unknown> = {
  optimisticResponse: TData;
};

/**
 * Executes `document` as a mutation whose `optimisticData` is applied to
 * the normalized cache immediately. Dependent cached queries update right
 * away; the returned source still resolves only with the real network
 * result (never the optimistic one).
 *
 * On clients without the normalized cache exchange the context slot is
 * ignored and this behaves exactly like `client.mutation`.
 */
export function executeOptimisticMutation<
  TData,
  TVariables extends AnyVariables,
>(
  client: Client,
  document: TypedDocumentNode<TData, TVariables>,
  variables: TVariables,
  optimisticData: TData
): OperationResultSource<OperationResult<TData, TVariables>> {
  const context: OptimisticMutationContext<TData> = {
    optimisticResponse: optimisticData,
  };
  return client.mutation(document, variables, {
    [OPTIMISTIC_MUTATION_CONTEXT_KEY]: context,
  });
}

/**
 * Reads the optimistic context off an operation at the exchange boundary,
 * where the payload is necessarily `unknown`.
 */
export function optimisticContextOf(
  op: Operation
): OptimisticMutationContext | undefined {
  const value: unknown = op.context[OPTIMISTIC_MUTATION_CONTEXT_KEY];
  if (
    value !== null &&
    typeof value === 'object' &&
    'optimisticResponse' in value
  ) {
    return value as OptimisticMutationContext;
  }
  return undefined;
}
