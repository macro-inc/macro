/**
 * Generated-operation cache inspection.
 *
 * Callers select one response field without supplying variables. Cache-core
 * discovers every cached argument variant and returns generated variables
 * plus the selected effective value when the complete query is available.
 */

import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { type AnyVariables, stringifyDocument } from '@urql/core';
import type { CacheHost } from '../host/types';
import type { CachedQueryInstanceWire } from '../protocol';
import {
  documentOperationName,
  type ObjectFieldKey,
  type Present,
} from './generated-selection';

declare const inspectionValueType: unique symbol;
declare const inspectionVariablesType: unique symbol;

type InspectionSelectionState = {
  readonly document: TypedDocumentNode<unknown, AnyVariables>;
  readonly path: readonly { field: string }[];
};

/** A field-only path generated from an operation result and variables type. */
export type InspectionSelection<TValue, TVariables> =
  InspectionSelectionState & {
    /** Phantom selected value type retained across fluent field operations. */
    readonly [inspectionValueType]: TValue;
    /** Phantom generated variables type returned by inspection. */
    readonly [inspectionVariablesType]: TVariables;
  } & (ObjectFieldKey<TValue> extends never
      ? object
      : {
          /** Selects a generated response field on the current object. */
          field<K extends ObjectFieldKey<TValue>>(
            field: K
          ): InspectionSelection<Present<TValue>[K], TVariables>;
        });

/** One cached generated operation-variable instance and selected value. */
export type CachedSelection<TValue, TVariables> = {
  variables: TVariables;
  /** Absent when the field exists but the complete generated query is a miss. */
  value?: TValue;
};

function createInspectionSelection<TValue, TVariables>(
  state: InspectionSelectionState
): InspectionSelection<TValue, TVariables> {
  return {
    ...state,
    field(field: string) {
      return createInspectionSelection({
        ...state,
        path: [...state.path, { field }],
      });
    },
  } as unknown as InspectionSelection<TValue, TVariables>;
}

/** Starts a generated field-only selection without concrete variables. */
export function selectAll<TData, TVariables extends AnyVariables>(
  document: TypedDocumentNode<TData, TVariables>
): InspectionSelection<TData, TVariables> {
  return createInspectionSelection<TData, TVariables>({
    document: document as TypedDocumentNode<unknown, AnyVariables>,
    path: [],
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateInstances(value: unknown): CachedQueryInstanceWire[] {
  if (!Array.isArray(value)) {
    throw new Error('invalid cache query inspection result');
  }
  return value.map((instance) => {
    if (!isRecord(instance) || !isRecord(instance.variables)) {
      throw new Error('invalid cache query inspection instance');
    }
    return {
      variables: instance.variables,
      ...('value' in instance ? { value: instance.value } : {}),
    };
  });
}

/**
 * Enumerates every cached argument variant of one generated selected field.
 * Only the serialized document, operation name, and response-key path cross
 * the host boundary.
 */
export async function inspect<TValue, TVariables extends AnyVariables>(
  host: CacheHost,
  selection: InspectionSelection<TValue, TVariables>
): Promise<CachedSelection<TValue, TVariables>[]> {
  if (selection.path.length === 0) {
    throw new Error('cache query inspection requires a selected field');
  }
  const result: unknown = await host.inspectQuery({
    query: stringifyDocument(selection.document),
    operationName: documentOperationName(selection.document),
    path: [...selection.path],
  });
  return validateInstances(result) as CachedSelection<TValue, TVariables>[];
}
