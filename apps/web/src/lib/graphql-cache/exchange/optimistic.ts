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
import type { DocumentNode } from 'graphql';
import { validate as validateUuid } from 'uuid';
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
type NumberKey<T> = {
  [K in StringKey<T>]-?: Present<T[K]> extends number ? K : never;
}[StringKey<T>];
type ScalarInsertFields<T, TExcluded extends StringKey<T>> = Partial<{
  [K in Exclude<ScalarKey<T>, TExcluded>]: Extract<
    Exclude<T[K], undefined>,
    JsonScalar
  >;
}>;
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

/** The only fields used to identify a normalized GraphQL entity. */
export type NormalizedEntityIdentity = {
  __typename: string;
  id: string;
};
type NormalizedEntityListKey<T> = {
  [K in StringKey<T>]-?: Present<T[K]> extends readonly (infer TItem)[]
    ? Present<TItem> extends NormalizedEntityIdentity
      ? K
      : never
    : never;
}[StringKey<T>];

/** An idempotent change to a normalized-link list. */
export type LinkDiff =
  | { kind: 'remove'; entity: NormalizedEntityIdentity }
  | { kind: 'prependUnique'; entity: NormalizedEntityIdentity };

/** Opaque serializable cache update produced only by {@link update}. */
export type OptimisticUpdate = OptimisticLinkPatchWire & {
  readonly [optimisticUpdateType]: true;
};

export type QueryRevalidation = {
  document: DocumentNode;
  variables: AnyVariables;
};

export type OptimisticMutationOptions = {
  /** Required RFC UUID; reuse only when the newer intent safely replaces the older one. */
  uuid: string;
  updates?: readonly OptimisticUpdate[];
  /** Relevant queries that cannot safely be updated still revalidate on success. */
  revalidations?: readonly QueryRevalidation[];
};

export type OptimisticMutationContext<TData = unknown> = {
  uuid: string;
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
  | {
      kind: 'superseded';
      transactionId: string;
      replacementTransactionId: string;
    }
  | { kind: 'permanently-failed'; transactionId?: string };

/** Returns a copy of an operation result carrying its queue disposition. */
export function withOptimisticMutationDisposition(
  result: OperationResult,
  disposition: OptimisticMutationDispositionMetadata
): OperationResult {
  const queuedData =
    disposition.kind === 'queued'
      ? optimisticContextOf(result.operation)?.optimisticResponse
      : undefined;
  return {
    ...result,
    ...(disposition.kind === 'queued'
      ? {
          data: queuedData ?? result.data,
          // A durable queued mutation is an accepted local write. Preserve the
          // network failure in queue diagnostics, not as a caller-facing error
          // that would roll back UI state or block the next edit.
          error: undefined,
        }
      : disposition.kind === 'superseded'
        ? {
            // The replacement's optimistic payload is already visible in the
            // cache. Never expose this older operation's stale response.
            data: undefined,
            error: undefined,
          }
        : {}),
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
  if (metadata.kind === 'superseded' && metadata.replacementTransactionId) {
    return {
      kind: 'queued',
      transactionId: metadata.replacementTransactionId,
    };
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

function definedScalarFields(
  fields: Readonly<Record<string, JsonScalar | undefined>>
): Record<string, JsonScalar> {
  return Object.fromEntries(
    Object.entries(fields).filter(
      (entry): entry is [string, JsonScalar] => entry[1] !== undefined
    )
  );
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

/** Construct the wire key for one normalized `id: ID!` GraphQL entity. */
export function normalizedEntityKey(entity: NormalizedEntityIdentity): string {
  return `${entity.__typename}:${entity.id}`;
}

/** Removes every occurrence of one normalized entity from a selected list. */
export function remove(entity: NormalizedEntityIdentity): LinkDiff {
  return { kind: 'remove', entity };
}

/** Uniquely prepends one normalized entity to a selected list. */
export function prependUnique(entity: NormalizedEntityIdentity): LinkDiff {
  return { kind: 'prependUnique', entity };
}

/** Compiles a generated graph selection and list diff into a durable update. */
export function update<TItem extends object>(
  selection: ListSelection<TItem>,
  operation: LinkDiff
): OptimisticUpdate {
  return {
    query: stringifyDocument(selection.document),
    operationName: documentOperationName(selection.document),
    variablesJson: JSON.stringify(selection.variables ?? {}),
    path: [...selection.path],
    operation: {
      kind: operation.kind,
      entityKey: normalizedEntityKey(operation.entity),
    },
  } as OptimisticUpdate;
}

/**
 * Removes an entity link from a selected embedded list item and decrements
 * its count only when the link was present.
 */
export function removeEmbeddedLink<
  TItem extends object,
  TSelectorField extends ScalarKey<TItem>,
  TLinkField extends NormalizedEntityListKey<TItem>,
  TCountField extends NumberKey<TItem>,
>(
  selection: ListSelection<TItem>,
  args: {
    listItem: {
      whereField: TSelectorField;
      equals: Extract<Present<TItem[TSelectorField]>, JsonScalar>;
    };
    linkField: TLinkField;
    countField: TCountField;
    entity: NormalizedEntityIdentity;
  }
): OptimisticUpdate {
  const update: OptimisticLinkPatchWire = {
    query: stringifyDocument(selection.document),
    operationName: documentOperationName(selection.document),
    variablesJson: JSON.stringify(selection.variables ?? {}),
    path: [...selection.path],
    operation: {
      kind: 'removeEmbeddedLink',
      listItem: args.listItem,
      linkField: args.linkField,
      countField: args.countField,
      entityKey: normalizedEntityKey(args.entity),
    },
  };
  return update as OptimisticUpdate;
}

/**
 * Prepends an entity link inside a selected embedded list item, creating the
 * embedded item from scalar fields when its selector does not exist. Its
 * count is initialized or incremented only when the link is newly inserted.
 */
export function upsertEmbeddedLink<
  TItem extends object,
  TSelectorField extends ScalarKey<TItem>,
  TLinkField extends NormalizedEntityListKey<TItem>,
  TCountField extends NumberKey<TItem>,
>(
  selection: ListSelection<TItem>,
  args: {
    listItem: {
      whereField: TSelectorField;
      equals: Extract<Present<TItem[TSelectorField]>, JsonScalar>;
    };
    linkField: TLinkField;
    countField: TCountField;
    entity: NormalizedEntityIdentity;
    insertFields: ScalarInsertFields<
      TItem,
      TSelectorField | TCountField | TLinkField
    >;
  }
): OptimisticUpdate {
  const update: OptimisticLinkPatchWire = {
    query: stringifyDocument(selection.document),
    operationName: documentOperationName(selection.document),
    variablesJson: JSON.stringify(selection.variables ?? {}),
    path: [...selection.path],
    operation: {
      kind: 'upsertEmbeddedLink',
      listItem: args.listItem,
      linkField: args.linkField,
      countField: args.countField,
      entityKey: normalizedEntityKey(args.entity),
      insertFields: definedScalarFields(args.insertFields),
    },
  };
  return update as OptimisticUpdate;
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
  options: OptimisticMutationOptions
): OperationResultSource<OperationResult<TData, TVariables>> {
  if (!validateUuid(options.uuid)) {
    throw new TypeError(`invalid optimistic mutation UUID: ${options.uuid}`);
  }
  const context: OptimisticMutationContext<TData> = {
    uuid: options.uuid,
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
    if (typeof context.uuid !== 'string' || !validateUuid(context.uuid)) {
      throw new TypeError(
        'invalid optimistic mutation UUID in operation context'
      );
    }
    return {
      uuid: context.uuid,
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
