import { isTransientRequestError } from '@core/util/request-error';
import type { ClaimedMutation } from '@graphql-cache/protocol';
import type { CombinedError } from '@urql/core';

const DRAFT_WRITES = ['SaveEmailDraft', 'DeleteEmailDraft'];
// The queue head blocks every write behind it while it retries, so a draft
// write the server keeps failing gives up after a few seconds of backoff.
const MAX_DRAFT_SERVER_FAULT_RETRIES = 2;

/**
 * A draft write is a full-state upsert (or an idempotent delete) under its own
 * handle, so sending it again after the server faulted is safe.
 */
function retriesDraftServerFault(
  error: CombinedError,
  mutation: Pick<ClaimedMutation, 'operationName' | 'serverFailureCount'>
): boolean {
  if (!DRAFT_WRITES.includes(mutation.operationName ?? '')) return false;
  if ((mutation.serverFailureCount ?? 0) >= MAX_DRAFT_SERVER_FAULT_RETRIES)
    return false;

  return error.graphQLErrors.every(
    (entry) => entry.extensions.code === 'INTERNAL'
  );
}

/**
 * Retry transport failures. Application errors release the queue head, except
 * a server fault on an email draft write, which is retried a few times.
 */
export function shouldRetryGraphqlMutation(
  error: CombinedError,
  mutation?: Pick<ClaimedMutation, 'operationName' | 'serverFailureCount'>
): boolean {
  if (error.graphQLErrors.length > 0) {
    return !!mutation && retriesDraftServerFault(error, mutation);
  }
  return isTransientRequestError(error);
}
