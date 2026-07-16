/**
 * Typed entry point for durable optimistic GraphQL mutations.
 *
 * Relation updates are declarative because callbacks cannot cross or survive
 * SharedWorker, Tauri IPC, WASM, and durable queue boundaries.
 */

import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import {
  type AnyVariables,
  type Client,
  type Operation,
  type OperationResult,
  type OperationResultSource,
  stringifyDocument,
} from '@urql/core';
import { Kind, type OperationDefinitionNode } from 'graphql';
import type {
  EmbeddedLinkPathSegment,
  OptimisticLinkPatchWire,
  QueryRevalidationWire,
} from '../protocol';

/** Private operation-context field carrying serializable optimistic data. */
const OPTIMISTIC_MUTATION_CONTEXT_KEY = 'normalizedCacheOptimistic';

export type QueryRevalidation = {
  document: TypedDocumentNode<unknown, AnyVariables>;
  variables: AnyVariables;
};

export type OptimisticLinkPatch = {
  parentEntityKey: string;
  fieldKey: string;
  path: readonly EmbeddedLinkPathSegment[];
  operation:
    | { kind: 'remove'; entityKey: string }
    | { kind: 'prependUnique'; entityKey: string };
  revalidate?: QueryRevalidation;
};

export type OptimisticMutationOptions = {
  linkPatches?: readonly OptimisticLinkPatch[];
  /** Relevant fields that cannot safely be patched still revalidate on success. */
  revalidations?: readonly QueryRevalidation[];
};

export type OptimisticMutationContext<TData = unknown> = {
  optimisticResponse: TData;
  linkPatches: OptimisticLinkPatchWire[];
  revalidations: QueryRevalidationWire[];
};

function documentOperationName(
  document: TypedDocumentNode<unknown, AnyVariables>
): string | undefined {
  for (const definition of document.definitions) {
    if (definition.kind === Kind.OPERATION_DEFINITION) {
      return (definition as OperationDefinitionNode).name?.value;
    }
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

function serializePatch(patch: OptimisticLinkPatch): OptimisticLinkPatchWire {
  return {
    parentEntityKey: patch.parentEntityKey,
    fieldKey: patch.fieldKey,
    path: [...patch.path],
    operation: patch.operation,
    revalidate: patch.revalidate
      ? serializeRevalidation(patch.revalidate)
      : undefined,
  };
}

/** Creates a constrained removal from an existing GroupSoup bin. */
export function removeGroupedSoupItemLink(args: {
  parentEntityKey: string;
  fieldKey: string;
  binKey: string;
  itemEntityKey: string;
  revalidate?: QueryRevalidation;
}): OptimisticLinkPatch {
  return groupedSoupItemLinkPatch(args, 'remove');
}

/** Creates a constrained unique prepend into an existing GroupSoup bin. */
export function prependGroupedSoupItemLink(args: {
  parentEntityKey: string;
  fieldKey: string;
  binKey: string;
  itemEntityKey: string;
  revalidate?: QueryRevalidation;
}): OptimisticLinkPatch {
  return groupedSoupItemLinkPatch(args, 'prependUnique');
}

function groupedSoupItemLinkPatch(
  args: {
    parentEntityKey: string;
    fieldKey: string;
    binKey: string;
    itemEntityKey: string;
    revalidate?: QueryRevalidation;
  },
  kind: 'remove' | 'prependUnique'
): OptimisticLinkPatch {
  return {
    parentEntityKey: args.parentEntityKey,
    fieldKey: args.fieldKey,
    path: [
      { field: 'bins' },
      { listItem: { whereField: 'key', equals: args.binKey } },
      { field: 'items' },
    ],
    operation: { kind, entityKey: args.itemEntityKey },
    revalidate: args.revalidate,
  };
}

/**
 * Executes `document` with one durable optimistic entity/link transaction.
 * The source resolves only with the real network result.
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
    linkPatches: (options.linkPatches ?? []).map(serializePatch),
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
