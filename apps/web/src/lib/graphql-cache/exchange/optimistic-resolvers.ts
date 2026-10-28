import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { type AnyVariables, type Exchange, makeOperation } from '@urql/core';
import {
  type DocumentNode,
  type FieldNode,
  getOperationAST,
  Kind,
  type OperationDefinitionNode,
  valueFromASTUntyped,
} from 'graphql';
import {
  type OptimisticCallOptions,
  type OptimisticPatch,
  optimisticContextOf,
  optimisticMutationContext,
} from './optimistic';
import { prepareOptimisticExchange } from './prepare-optimistic';

type FieldPrediction = {
  value: unknown;
  options?: OptimisticCallOptions;
};

type LocalMutation = {
  response: Record<string, unknown>;
  options: OptimisticCallOptions;
};

type MutationValue<TData> = TData[Exclude<keyof TData, '__typename'>];

export type OptimisticResolver = {
  /** Mutation root field predicted in every document that selects it. */
  field: string;
  /** Representative document whose variables type the field's arguments. */
  document: DocumentNode;
  resolve: (args: Record<string, unknown>) => FieldPrediction | undefined;
};

/**
 * Predict one mutation root field for every document that selects it. The
 * representative document must pass each field argument as a same-named
 * variable, so its variables type the evaluated arguments. The value is typed
 * by the representative's selection and placed under each document's own
 * response key; normalization ignores fields that document does not select,
 * including nested aliases it does not share. Return undefined to skip the
 * prediction. Define optional queue/link behavior separately from field values.
 */
export function optimisticResolver<
  TData,
  TVariables extends AnyVariables,
  const TPatch extends OptimisticPatch<NoInfer<MutationValue<TData>>>,
>(
  document: TypedDocumentNode<TData, TVariables>,
  resolve: (args: TVariables) => TPatch | undefined,
  options?: (args: TVariables) => OptimisticCallOptions
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
  const variables = new Set(
    operation.variableDefinitions?.map(({ variable }) => variable.name.value)
  );
  const args = field.arguments ?? [];
  if (
    args.length !== variables.size ||
    args.some(
      ({ name, value }) =>
        value.kind !== Kind.VARIABLE ||
        value.name.value !== name.value ||
        !variables.has(name.value)
    )
  ) {
    throw new TypeError(
      'An optimistic resolver document must pass each field argument as a same-named variable'
    );
  }
  return {
    field: field.name.value,
    document,
    // Type erasure is private to the argument/variable binding checked above.
    resolve: (args) => {
      const typedArgs = args as TVariables;
      const value = resolve(typedArgs);
      if (value === undefined) return undefined;
      return { value, options: options?.(typedArgs) };
    },
  };
}

function resolversByField(
  resolvers: readonly OptimisticResolver[]
): ReadonlyMap<string, OptimisticResolver> {
  const byField = new Map<string, OptimisticResolver>();
  for (const resolver of resolvers) {
    if (byField.has(resolver.field)) {
      throw new TypeError(
        `Duplicate optimistic resolver for mutation field ${resolver.field}`
      );
    }
    byField.set(resolver.field, resolver);
  }
  return byField;
}

function mergeOptions(
  base: OptimisticCallOptions,
  next: OptimisticCallOptions = {}
): OptimisticCallOptions {
  return {
    ...base,
    ...next,
    updates: [...(base.updates ?? []), ...(next.updates ?? [])],
    revalidations: [
      ...(base.revalidations ?? []),
      ...(next.revalidations ?? []),
    ],
    identityBindings: [
      ...(base.identityBindings ?? []),
      ...(next.identityBindings ?? []),
    ],
  };
}

/** Runtime variables, with the operation's defaults for omitted ones. */
function variableValues(
  operation: OperationDefinitionNode,
  variables: AnyVariables
): Record<string, unknown> {
  const values: Record<string, unknown> = { ...(variables ?? {}) };
  for (const { variable, defaultValue } of operation.variableDefinitions ??
    []) {
    if (defaultValue && values[variable.name.value] === undefined) {
      values[variable.name.value] = valueFromASTUntyped(defaultValue);
    }
  }
  return values;
}

/** An argument bound to an omitted variable is omitted, as on the server. */
function fieldArguments(
  field: FieldNode,
  variables: Record<string, unknown>
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const argument of field.arguments ?? []) {
    const value = valueFromASTUntyped(argument.value, variables);
    if (value !== undefined) args[argument.name.value] = value;
  }
  return args;
}

function predict(
  byField: ReadonlyMap<string, OptimisticResolver>,
  document: DocumentNode,
  variables: AnyVariables
): LocalMutation | undefined {
  const operation = getOperationAST(document);
  if (operation?.operation !== 'mutation') return undefined;
  // All or nothing: a queued mutation reports its prediction as the result,
  // so an unpredicted root field would surface as missing data.
  const fields: [FieldNode, OptimisticResolver][] = [];
  for (const selection of operation.selectionSet.selections) {
    if (selection.kind !== Kind.FIELD) return undefined;
    if (selection.name.value === '__typename') continue;
    const resolver = byField.get(selection.name.value);
    if (!resolver || selection.directives?.length) return undefined;
    fields.push([selection, resolver]);
  }
  if (!fields.length) return undefined;
  const values = variableValues(operation, variables);
  const response: Record<string, unknown> = {};
  let options: OptimisticCallOptions = {};
  for (const [field, resolver] of fields) {
    const local = resolver.resolve(fieldArguments(field, values));
    if (!local) return undefined;
    response[field.alias?.value ?? field.name.value] = local.value;
    options = mergeOptions(options, local.options);
  }
  return { response, options };
}

/** The prediction the exchange attaches to one mutation, if any. */
export function predictOptimisticMutation(
  resolvers: readonly OptimisticResolver[],
  document: DocumentNode,
  variables: AnyVariables
): LocalMutation | undefined {
  return predict(resolversByField(resolvers), document, variables);
}

/** Install immediately before normalizedCacheExchange, which owns settlement. */
export function optimisticResolversExchange(
  resolvers: readonly OptimisticResolver[]
): Exchange {
  const byField = resolversByField(resolvers);
  return prepareOptimisticExchange((operation) => {
    if (
      operation.kind !== 'mutation' ||
      operation.context.optimisticMutation === false ||
      optimisticContextOf(operation)
    ) {
      return operation;
    }
    const local = predict(byField, operation.query, operation.variables);
    if (!local) return operation;
    const options = operation.context.optimisticMutation as
      | OptimisticCallOptions
      | undefined;
    return makeOperation('mutation', operation, {
      ...operation.context,
      ...optimisticMutationContext(
        local.response,
        mergeOptions(local.options, options)
      ),
    });
  });
}
