import type { OperationResult } from '@urql/core';
import { getOperationAST } from 'graphql';

/** Server-confirmed absent threads must leave both the index and record store. */
export function emailCacheDeletionKeys(result: OperationResult): string[] {
  if (result.error || result.hasNext || !result.data) return [];
  const name = getOperationAST(result.operation.query)?.name?.value;
  const data = result.data as {
    user?: { emailThread?: unknown };
    deleteEmailDraft?: { threadDeleted?: boolean; threadId?: unknown };
  };
  const id =
    name === 'EmailThreadPage' && data.user?.emailThread === null
      ? result.operation.variables?.threadId
      : name === 'DeleteEmailDraft' &&
          data.deleteEmailDraft?.threadDeleted === true
        ? data.deleteEmailDraft.threadId
        : undefined;
  return typeof id === 'string' && id.length > 0
    ? [`GraphqlSoupEmailThread:${id}`]
    : [];
}
