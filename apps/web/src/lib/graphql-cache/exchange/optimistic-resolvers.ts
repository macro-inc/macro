import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import {
  type AnyVariables,
  type Exchange,
  makeOperation,
  stringifyDocument,
} from '@urql/core';
import { getOperationAST, Kind } from 'graphql';
import {
  type OptimisticCallOptions,
  type OptimisticPatch,
  optimisticContextOf,
  optimisticMutationContext,
} from './optimistic';
import { prepareOptimisticExchange } from './prepare-optimistic';

type LocalMutation = {
  response: unknown;
  options?: OptimisticCallOptions;
};

type MutationValue<TData> = TData[Exclude<keyof TData, '__typename'>];

export type OptimisticResolver = {
  document: string;
  resolve: (variables: AnyVariables) => LocalMutation | undefined;
};

/**
 * Predict the value of one unconditional top-level mutation field. The document
 * supplies its response key (including aliases); return undefined to skip the
 * prediction. Define optional queue/link behavior separately from field values.
 */
export function optimisticResolver<
  TData,
  TVariables extends AnyVariables,
  const TPatch extends OptimisticPatch<NoInfer<MutationValue<TData>>>,
>(
  document: TypedDocumentNode<TData, TVariables>,
  resolve: (variables: TVariables) => TPatch | undefined,
  options?: (variables: TVariables) => OptimisticCallOptions
): OptimisticResolver {
  const operation = getOperationAST(document);
  if (operation?.operation !== 'mutation') {
    throw new TypeError('An optimistic resolver requires one mutation');
  }
  const fields = operation.selectionSet.selections.filter(
    (selection) =>
      selection.kind !== Kind.FIELD ||
      selection.name.value !== '__typename' ||
      selection.alias !== undefined
  );
  const [field] = fields;
  if (
    fields.length !== 1 ||
    field.kind !== Kind.FIELD ||
    field.name.value === '__typename' ||
    field.directives?.length
  ) {
    throw new TypeError(
      'An optimistic resolver requires one unconditional top-level mutation field'
    );
  }
  const responseKey = field.alias?.value ?? field.name.value;
  return {
    document: stringifyDocument(document),
    // Type erasure is private to the document/variables binding above.
    resolve: (variables) => {
      const typedVariables = variables as TVariables;
      const value = resolve(typedVariables);
      if (value === undefined) return undefined;
      return {
        response: { [responseKey]: value },
        options: options?.(typedVariables),
      };
    },
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
