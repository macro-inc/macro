import type { OperationResult } from '@urql/core';
import { getOperationAST } from 'graphql';

/** Evict known document records only after complete, fresh authorization responses. */
export function authorizedDocumentDeletionKeys(
  result: OperationResult
): string[] {
  if (result.error || result.hasNext || result.stale || !result.data) return [];
  const name = getOperationAST(result.operation.query)?.name?.value;
  const data = result.data as {
    user?: {
      document?: { id: string } | null;
      documents?: Array<{ id: string }>;
    };
  };
  const variables = result.operation.variables;
  if (name === 'EntityProperties' || name === 'EntityActivity') {
    const id: unknown = variables?.documentId;
    return variables?.isDocument === true &&
      data.user?.document === null &&
      typeof id === 'string' &&
      id.length > 0
      ? [`GraphqlSoupDocument:${id}`]
      : [];
  }
  if (name !== 'ItemPreview' && name !== 'ItemPreviews') return [];
  const documents = data.user?.documents;
  const ids: unknown = variables?.documentIds;
  if (!documents || !Array.isArray(ids)) return [];
  const returned = new Set(documents.map((document) => document.id));
  return [...new Set(ids)]
    .filter(
      (id): id is string =>
        typeof id === 'string' && id.length > 0 && !returned.has(id)
    )
    .map((id) => `GraphqlSoupDocument:${id}`);
}
