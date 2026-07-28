/**
 * Typed entry point for durable optimistic GraphQL mutations.
 *
 * Callers describe relation changes through generated query documents. The
 * fluent selection is compiled to a constrained serializable recipe before
 * it crosses SharedWorker, Tauri IPC, WASM, or durable queue boundaries.
 */

import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import {
  type AnyVariables,
  type Client,
  CombinedError,
  type Operation,
  type OperationResult,
  type OperationResultSource,
  stringifyDocument,
} from '@urql/core';
import type {
  EmbeddedLinkPathSegment,
  OptimisticLinkPatchWire,
  QueryRevalidationWire,
} from '../protocol';
import {
  documentOperationName,
  type Present,
  type StringKey,
} from './generated-selection';

/** Private operation-context field carrying serializable optimistic data. */
const OPTIMISTIC_MUTATION_CONTEXT_KEY = 'normalizedCacheOptimistic';
/** Private result-extension field carrying the queue disposition. */
const OPTIMISTIC_MUTATION_DISPOSITION_KEY =
  'normalizedCacheMutationDisposition';
declare const selectionType: unique symbol;
declare const optimisticUpdateType: unique symbol;

type JsonScalar = string | number | boolean | null;
type ScalarKey<T> = {
  [K in StringKey<T>]-?: Present<T[K]> extends JsonScalar ? K : never;
}[StringKey<T>];
type SelectionState = {
  readonly document: TypedDocumentNode<unknown, AnyVariables>;
  readonly variables: AnyVariables;
  readonly path: readonly EmbeddedLinkPathSegment[];
};

/** A type-generated path through one query result. */
export type Selection<T> = SelectionState & {
  /** Phantom result type retained across fluent path operations. */
  readonly [selectionType]: T;
} & (Present<T> extends readonly (infer TItem)[]
    ? {
        /** Selects exactly one list item by one generated scalar field. */
        item<K extends ScalarKey<Present<TItem>>>(
          field: K,
          equals: Present<Present<TItem>[K]>
        ): Selection<Present<TItem>>;
      }
    : Present<T> extends object
      ? {
          /** Selects a generated response field on the current object. */
          field<K extends StringKey<Present<T>>>(
            field: K
          ): Selection<Present<T>[K]>;
        }
      : object);

/** A generated selection whose current value is a list. */
export type ListSelection<TItem extends object> = Selection<readonly TItem[]>;

/** An idempotent change to a normalized-link list. */
export type LinkDiff =
  | { kind: 'remove'; entityKey: string }
  | { kind: 'prependUnique'; entityKey: string };

/** Opaque serializable cache update produced only by {@link update}. */
export type OptimisticUpdate = OptimisticLinkPatchWire & {
  readonly [optimisticUpdateType]: true;
};

export type QueryRevalidation = {
  document: TypedDocumentNode<unknown, AnyVariables>;
  variables: AnyVariables;
};

export type OptimisticMutationOptions = {
  updates?: readonly OptimisticUpdate[];
  /** Relevant queries that cannot safely be updated still revalidate on success. */
  revalidations?: readonly QueryRevalidation[];
};

export type OptimisticMutationContext<TData = unknown> = {
  optimisticResponse: TData;
  linkPatches: OptimisticLinkPatchWire[];
  revalidations: QueryRevalidationWire[];
};

/** Caller-facing disposition of one durable optimistic mutation submission. */
export type OptimisticMutationDisposition<TData> =
  | { kind: 'committed'; data: TData }
  | { kind: 'queued'; transactionId: string }
  | { kind: 'permanently-failed'; error: CombinedError };

/** Exchange-private metadata attached after queue routing or settlement. */
export type OptimisticMutationDispositionMetadata =
  | { kind: 'committed'; transactionId?: string }
  | { kind: 'queued'; transactionId: string }
  | { kind: 'permanently-failed'; transactionId?: string };

/** Returns a copy of an operation result carrying its queue disposition. */
export function withOptimisticMutationDisposition(
  result: OperationResult,
  disposition: OptimisticMutationDispositionMetadata
): OperationResult {
  return {
    ...result,
    extensions: {
      ...result.extensions,
      [OPTIMISTIC_MUTATION_DISPOSITION_KEY]: disposition,
    },
  };
}

/** Reads the typed caller-facing disposition attached by the cache exchange. */
export function optimisticMutationDispositionOf<
  TData,
  TVariables extends AnyVariables,
>(
  result: OperationResult<TData, TVariables>
): OptimisticMutationDisposition<TData> | undefined {
  const value: unknown =
    result.extensions?.[OPTIMISTIC_MUTATION_DISPOSITION_KEY];
  if (value === null || typeof value !== 'object' || !('kind' in value)) {
    return undefined;
  }

  const metadata = value as OptimisticMutationDispositionMetadata;
  if (metadata.kind === 'queued' && metadata.transactionId) {
    return { kind: 'queued', transactionId: metadata.transactionId };
  }
  if (metadata.kind === 'committed' && result.data != null) {
    return { kind: 'committed', data: result.data };
  }
  if (metadata.kind === 'permanently-failed') {
    return {
      kind: 'permanently-failed',
      error:
        result.error ??
        new CombinedError({
          graphQLErrors: [new Error('mutation returned no data')],
        }),
    };
  }
  return undefined;
}

function serializeRevalidation(
  revalidation: QueryRevalidation
): QueryRevalidationWire {
  return {
    query: stringifyDocument(revalidation.document),
    operationName: documentOperationName(revalidation.document),
    variablesJson: JSON.stringify(revalidation.variables ?? {}),
  };
}

function createSelection<T>(state: SelectionState): Selection<T> {
  const selection = {
    ...state,
    field(field: string) {
      return createSelection({
        ...state,
        path: [...state.path, { field }],
      });
    },
    item(field: string, equals: JsonScalar) {
      return createSelection({
        ...state,
        path: [...state.path, { listItem: { whereField: field, equals } }],
      });
    },
  };
  return selection as unknown as Selection<T>;
}

/**
 * Starts a strongly typed graph selection at a generated query operation.
 * Variables and every subsequent path segment are inferred from the
 * `TypedDocumentNode` generated by GraphQL Code Generator.
 */
export function select<TData, TVariables extends AnyVariables>(
  document: TypedDocumentNode<TData, TVariables>,
  variables: TVariables
): Selection<TData> {
  return createSelection<TData>({
    document: document as TypedDocumentNode<unknown, AnyVariables>,
    variables,
    path: [],
  });
}

/** Removes every occurrence of one normalized entity from a selected list. */
export function remove(entityKey: string): LinkDiff {
  return { kind: 'remove', entityKey };
}

/** Uniquely prepends one normalized entity to a selected list. */
export function prependUnique(entityKey: string): LinkDiff {
  return { kind: 'prependUnique', entityKey };
}

function compileUpdate<TItem extends object>(
  selection: ListSelection<TItem>,
  operation: OptimisticLinkPatchWire['operation']
): OptimisticUpdate {
  return {
    query: stringifyDocument(selection.document),
    operationName: documentOperationName(selection.document),
    variablesJson: JSON.stringify(selection.variables ?? {}),
    path: [...selection.path],
    operation,
  } as OptimisticUpdate;
}

/** Compiles a generated graph selection and list diff into a durable update. */
export function update<TItem extends object>(
  selection: ListSelection<TItem>,
  operation: LinkDiff
): OptimisticUpdate {
  return compileUpdate(selection, operation);
}

/**
 * Executes `document` with one durable optimistic entity/link transaction.
 * The source resolves with the head's network result or a synthetic queued
 * disposition when an older mutation currently blocks the operation.
 */
export function executeOptimisticMutation<
  TData,
  TVariables extends AnyVariables,
>(
  client: Client,
  document: TypedDocumentNode<TData, TVariables>,
  variables: TVariables,
  optimisticData: TData,
  options: OptimisticMutationOptions = {}
): OperationResultSource<OperationResult<TData, TVariables>> {
  const context: OptimisticMutationContext<TData> = {
    optimisticResponse: optimisticData,
    linkPatches: [...(options.updates ?? [])],
    revalidations: (options.revalidations ?? []).map(serializeRevalidation),
  };
  return client.mutation(document, variables, {
    [OPTIMISTIC_MUTATION_CONTEXT_KEY]: context,
  });
}

/** Reads and defensively validates the private context at the exchange edge. */
export function optimisticContextOf(
  op: Operation
): OptimisticMutationContext | undefined {
  const value: unknown = op.context[OPTIMISTIC_MUTATION_CONTEXT_KEY];
  if (
    value !== null &&
    typeof value === 'object' &&
    'optimisticResponse' in value
  ) {
    const context = value as Partial<OptimisticMutationContext> & {
      optimisticResponse: unknown;
    };
    return {
      optimisticResponse: context.optimisticResponse,
      linkPatches: Array.isArray(context.linkPatches)
        ? context.linkPatches
        : [],
      revalidations: Array.isArray(context.revalidations)
        ? context.revalidations
        : [],
    };
  }
  return undefined;
}
