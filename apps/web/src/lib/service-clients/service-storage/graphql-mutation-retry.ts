import { isTransientRequestError } from '@core/util/request-error';
import type { ClaimedMutation } from '@graphql-cache/protocol';
import type { CombinedError } from '@urql/core';

type QueuedMutation = Pick<
  ClaimedMutation,
  'transactionId' | 'uuid' | 'operationName'
>;

const DRAFT_WRITES = ['SaveEmailDraft', 'DeleteEmailDraft'];
// The queue head blocks every write behind it while it retries, so a draft
// write the server keeps faulting gives up after a few seconds of backoff.
const MAX_SERVER_FAULT_RETRIES = 2;
const MAX_TRACKED_WRITES = 256;
// A server fault, or an inbox that stayed locked past its lock timeout: the
// write rolled back, so sending it again is safe.
const RETRIED_DRAFT_CODES = ['INTERNAL', 'INBOX_BUSY'];
/** Server faults in a row for each queued idempotent write. */
const writeFaults = new Map<string, number>();
// Transaction ids restart when the cache is rebuilt; the draft's key does not.
const writeKey = (mutation: QueuedMutation) =>
  `${mutation.uuid}:${mutation.transactionId}`;

/**
 * Draft writes and SetTaskProperty replace state, so retrying a rolled-back
 * write is safe.
 */
function retriesServerFault(
  error: CombinedError,
  mutation: QueuedMutation
): boolean {
  const draftFault =
    DRAFT_WRITES.includes(mutation.operationName ?? '') &&
    error.graphQLErrors.every((entry) =>
      RETRIED_DRAFT_CODES.includes(String(entry.extensions.code))
    );
  // SetTaskProperty replaces state. Contention rolls back the whole write.
  const dependencyContention =
    mutation.operationName === 'SetTaskProperty' &&
    error.graphQLErrors.every(
      (entry) =>
        entry.extensions.code === 'DEPENDENCY_BUSY' &&
        entry.extensions.retryable === true
    );
  if (!draftFault && !dependencyContention) return false;

  const faults = (writeFaults.get(writeKey(mutation)) ?? 0) + 1;
  if (faults > MAX_SERVER_FAULT_RETRIES) return false;

  // Writes that later succeed never report back; keep their counts bounded.
  if (writeFaults.size >= MAX_TRACKED_WRITES) writeFaults.clear();
  writeFaults.set(writeKey(mutation), faults);
  return true;
}

/**
 * Retry transport failures. Application errors release the queue head, except
 * draft server faults and task dependency contention, retried twice in a row.
 */
export function shouldRetryGraphqlMutation(
  error: CombinedError,
  mutation?: QueuedMutation
): boolean {
  const refused = error.graphQLErrors.length > 0;
  if (refused && mutation && retriesServerFault(error, mutation)) return true;

  // Any other failure ends the write's run of server faults.
  if (mutation) writeFaults.delete(writeKey(mutation));
  return !refused && isTransientRequestError(error);
}
