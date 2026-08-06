/**
 * Generated-operation cache inspection.
 *
 * Callers select one response field without supplying concrete variables.
 * They can recover typed cached variable variants without materialization, or
 * request selected effective values for complete cached queries.
 */

import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { type AnyVariables, stringifyDocument } from '@urql/core';
import type { CacheHost } from '../host/types';
import type {
  CachedQueryInstanceWire,
  CachedQueryVariantWire,
  QueryVariableFilter,
} from '../protocol';
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

/** One cached generated operation-variable variant. */
export type CachedVariant<TVariables> = {
  variables: TVariables;
};

/** One cached generated operation-variable instance and selected value. */
export type CachedSelection<TValue, TVariables> = CachedVariant<TVariables> & {
  /** Absent when the field exists but the complete generated query is a miss. */
  value?: TValue;
};

/** Recursive partial match over generated operation variables. */
export type InspectionVariableFilter<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: InspectionVariableFilter<T[K]> }
    : T;

/** Limits which cached variants an inspection materializes. */
export type InspectionOptions<TVariables> = {
  /** OR-ed recursive partial matches; omitted or empty means every variant. */
  variableFilters?: readonly InspectionVariableFilter<TVariables>[];
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

function validateVariants(value: unknown): CachedQueryVariantWire[] {
  if (!Array.isArray(value)) {
    throw new Error('invalid cache query variant inspection result');
  }
  return value.map((variant) => {
    if (!isRecord(variant) || !isRecord(variant.variables)) {
      throw new Error('invalid cache query inspection variant');
    }
    return { variables: variant.variables };
  });
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
 * Recovers every cached variable variant without materializing selected
 * values. Only the serialized document, operation name, and response-key path
 * cross the host boundary.
 */
export async function inspectVariants<TValue, TVariables extends AnyVariables>(
  host: CacheHost,
  selection: InspectionSelection<TValue, TVariables>
): Promise<CachedVariant<TVariables>[]> {
  if (selection.path.length === 0) {
    throw new Error('cache query inspection requires a selected field');
  }
  const result: unknown = await host.inspectQueryVariants({
    query: stringifyDocument(selection.document),
    operationName: documentOperationName(selection.document),
    path: [...selection.path],
  });
  return validateVariants(result) as CachedVariant<TVariables>[];
}

/**
 * Enumerates matching cached argument variants of one generated selected
 * field. Only the serialized document, operation name, response-key path, and
 * optional partial-variable filters cross the host boundary.
 */
export async function inspect<TValue, TVariables extends AnyVariables>(
  host: CacheHost,
  selection: InspectionSelection<TValue, TVariables>,
  options: InspectionOptions<TVariables> = {}
): Promise<CachedSelection<TValue, TVariables>[]> {
  if (selection.path.length === 0) {
    throw new Error('cache query inspection requires a selected field');
  }
  const result: unknown = await host.inspectQuery({
    query: stringifyDocument(selection.document),
    operationName: documentOperationName(selection.document),
    path: [...selection.path],
    ...(options.variableFilters
      ? {
          variableFilters: options.variableFilters.map(
            (filter) => filter as QueryVariableFilter
          ),
        }
      : {}),
  });
  return validateInstances(result) as CachedSelection<TValue, TVariables>[];
}
