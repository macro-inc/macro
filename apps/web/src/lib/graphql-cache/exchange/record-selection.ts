import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { stringifyDocument } from '@urql/core';
import { type FragmentDefinitionNode, Kind } from 'graphql';
import type { CacheHost } from '../host/types';
import type { RecordCursor } from '../protocol';

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

/** One typed page of complete selected records. */
export type SelectedRecordPage<TResult> = {
  records: TResult[];
  nextCursor: RecordCursor | null;
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

function validatePage(value: unknown): SelectedRecordPage<unknown> {
  if (!isRecord(value) || !Array.isArray(value.records)) {
    throw new Error('invalid cache record-selection page');
  }
  if (value.nextCursor !== null && typeof value.nextCursor !== 'string') {
    throw new Error('invalid cache record-selection cursor');
  }
  if (value.records.some((record) => !isRecord(record))) {
    throw new Error('invalid cache selected record');
  }
  return {
    records: value.records,
    nextCursor: value.nextCursor,
  };
}

/** Reads one typed page from a cache host using a prepared fragment. */
export async function readRecords<TResult>(
  host: Pick<CacheHost, 'readRecords'>,
  selection: RecordSelection<TResult>,
  options: { cursor?: RecordCursor; limit: number }
): Promise<SelectedRecordPage<TResult>> {
  const page: unknown = await host.readRecords({
    document: selection.document,
    fragmentName: selection.fragmentName,
    cursor: options.cursor,
    limit: options.limit,
  });
  return validatePage(page) as SelectedRecordPage<TResult>;
}
