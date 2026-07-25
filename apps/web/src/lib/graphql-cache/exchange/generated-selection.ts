import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import type { AnyVariables } from '@urql/core';
import { Kind, type OperationDefinitionNode } from 'graphql';

/** Removes nullable wrappers while traversing generated operation results. */
export type Present<T> = Exclude<T, null | undefined>;
/** String response keys generated for an operation result object. */
export type StringKey<T> = Extract<keyof T, string>;
/** Fields available to a field-only generated result selection. */
export type ObjectFieldKey<T> =
  Present<T> extends readonly unknown[]
    ? never
    : Present<T> extends object
      ? StringKey<Present<T>>
      : never;

/** Extracts the selected operation name transported with generated queries. */
export function documentOperationName(
  document: TypedDocumentNode<unknown, AnyVariables>
): string | undefined {
  for (const definition of document.definitions) {
    if (definition.kind === Kind.OPERATION_DEFINITION) {
      return (definition as OperationDefinitionNode).name?.value;
    }
  }
  return undefined;
}
