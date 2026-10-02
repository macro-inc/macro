import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import {
  type AnyVariables,
  type Exchange,
  makeOperation,
  stringifyDocument,
} from '@urql/core';
import { getOperationAST } from 'graphql';
import {
  type OptimisticCallOptions,
  type OptimisticPatch,
  optimisticContextOf,
  optimisticMutationContext,
} from './optimistic';
import { prepareOptimisticExchange } from './prepare-optimistic';

type LocalMutation<T> = {
  response: OptimisticPatch<T>;
  options?: OptimisticCallOptions;
};

export type OptimisticResolver = {
  document: string;
  resolve: (variables: AnyVariables) => LocalMutation<unknown> | undefined;
};

/** Define local semantics once; every ordinary execution of this document uses them. */
export function optimisticResolver<TData, TVariables extends AnyVariables>(
  document: TypedDocumentNode<TData, TVariables>,
  resolve: (variables: TVariables) => LocalMutation<NoInfer<TData>> | undefined
): OptimisticResolver {
  if (getOperationAST(document)?.operation !== 'mutation') {
    throw new TypeError('An optimistic resolver requires one mutation');
  }
  return {
    document: stringifyDocument(document),
    // Type erasure is private to the document/variables binding above.
    resolve: (variables) => resolve(variables as TVariables),
  };
}

/** Install immediately before normalizedCacheExchange, which owns settlement. */
export function optimisticResolversExchange(
  resolvers: readonly OptimisticResolver[]
): Exchange {
  const byDocument = new Map<string, OptimisticResolver>();
  for (const resolver of resolvers) {
    if (byDocument.has(resolver.document)) {
      throw new TypeError('Duplicate optimistic mutation resolver');
    }
    byDocument.set(resolver.document, resolver);
  }
  return prepareOptimisticExchange((operation) => {
    if (
      operation.kind !== 'mutation' ||
      operation.context.optimisticMutation === false ||
      optimisticContextOf(operation)
    ) {
      return operation;
    }
    const local = byDocument
      .get(stringifyDocument(operation.query))
      ?.resolve(operation.variables);
    if (!local) return operation;
    const options = operation.context.optimisticMutation as
      | OptimisticCallOptions
      | undefined;
    return makeOperation('mutation', operation, {
      ...operation.context,
      ...optimisticMutationContext(local.response, {
        ...local.options,
        ...options,
        updates: [
          ...(local.options?.updates ?? []),
          ...(options?.updates ?? []),
        ],
        revalidations: [
          ...(local.options?.revalidations ?? []),
          ...(options?.revalidations ?? []),
        ],
        identityBindings: [
          ...(local.options?.identityBindings ?? []),
          ...(options?.identityBindings ?? []),
        ],
      }),
    });
  });
}
