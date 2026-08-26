import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { stringifyDocument } from '@urql/core';
import { type FragmentDefinitionNode, Kind } from 'graphql';
import type { CacheHost } from '../host/types';
import type { CacheRevision } from '../protocol';

const recordResultType: unique symbol = Symbol('recordResultType');

type RecordSelectionState = {
  readonly document: string;
  readonly fragmentName: string;
};

/** A generated fragment prepared for normalized-record selection. */
export type RecordSelection<TResult> = RecordSelectionState & {
  /** Phantom generated fragment result type. */
  readonly [recordResultType]: TResult;
};

/** Prepares a generated, fragment-only document for record selection. */
export function selectRecords<TResult, TVariables>(
  document: TypedDocumentNode<TResult, TVariables>
): RecordSelection<TResult> {
  if (
    document.definitions.some(
      (definition) => definition.kind === Kind.OPERATION_DEFINITION
    )
  ) {
    throw new Error('cache record selection requires a fragment-only document');
  }
  const fragment = document.definitions.find(
    (definition): definition is FragmentDefinitionNode =>
      definition.kind === Kind.FRAGMENT_DEFINITION
  );
  if (!fragment?.name?.value) {
    throw new Error('cache record selection requires a named fragment');
  }
  return {
    document: stringifyDocument(document),
    fragmentName: fragment.name.value,
  } as RecordSelection<TResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Projects a bounded explicit key set through a prepared fragment. */
export async function readRecordsByKeys<TResult>(
  host: Pick<CacheHost, 'readRecordsByKeys'>,
  selection: RecordSelection<TResult>,
  keys: string[]
): Promise<{
  revision: CacheRevision;
  records: Array<{ recordKey: string; record: TResult }>;
}> {
  const result = await host.readRecordsByKeys({
    document: selection.document,
    fragmentName: selection.fragmentName,
    keys,
  });
  return {
    revision: result.revision,
    records: result.records.map(({ recordKey, record }) => {
      if (!recordKey || !isRecord(record)) {
        throw new Error('invalid cache selected record by key');
      }
      return { recordKey, record: record as TResult };
    }),
  };
}
