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
const MAX_DRAFT_SERVER_FAULT_RETRIES = 2;
const MAX_TRACKED_WRITES = 256;
// A server fault, or an inbox that stayed locked past its lock timeout: the
// write rolled back, so sending it again is safe.
const RETRIED_DRAFT_CODES = ['INTERNAL', 'INBOX_BUSY'];
// A send carries the message id the client chose and the server answers a
// replay of it without writing again, and a repeated delete answers with the
// tombstone: one the server committed but could not read back, or a
// conversation that stayed busy, is sent again rather than rolled back, which
// for a send would invite a resend under a new id. Edits and reactions are
// not: a replay after another device changed the message would undo that
// change. The queue runner bounds how many server failures it retries.
const CHANNEL_WRITES = ['SendChannelMessage', 'DeleteChannelMessage'];
const RETRIED_CHANNEL_CODES = ['SERVICE_UNAVAILABLE'];
/** Server faults in a row for each queued draft write. */
const draftFaults = new Map<string, number>();
// Transaction ids restart when the cache is rebuilt; the draft's key does not.
const writeKey = (mutation: QueuedMutation) =>
  `${mutation.uuid}:${mutation.transactionId}`;

/**
 * A draft write is a full-state upsert (or an idempotent delete) under its own
 * handle, so sending it again after the server faulted is safe.
 */
function retriesDraftServerFault(
  error: CombinedError,
  mutation: QueuedMutation
): boolean {
  if (
    !DRAFT_WRITES.includes(mutation.operationName ?? '') ||
    !error.graphQLErrors.every((entry) =>
      RETRIED_DRAFT_CODES.includes(String(entry.extensions.code))
    )
  )
    return false;

  const faults = (draftFaults.get(writeKey(mutation)) ?? 0) + 1;
  if (faults > MAX_DRAFT_SERVER_FAULT_RETRIES) return false;

  // Writes that later succeed never report back; keep their counts bounded.
  if (draftFaults.size >= MAX_TRACKED_WRITES) draftFaults.clear();
  draftFaults.set(writeKey(mutation), faults);
  return true;
}

function retriesChannelWrite(
  error: CombinedError,
  mutation: QueuedMutation
): boolean {
  return (
    CHANNEL_WRITES.includes(mutation.operationName ?? '') &&
    error.graphQLErrors.every((entry) =>
      RETRIED_CHANNEL_CODES.includes(String(entry.extensions.code))
    )
  );
}

/**
 * Retry transport failures. Application errors release the queue head, except
 * a server fault on an email draft write, which is retried twice in a row, and
 * an unavailable server on a channel write.
 */
export function shouldRetryGraphqlMutation(
  error: CombinedError,
  mutation?: QueuedMutation
): boolean {
  const refused = error.graphQLErrors.length > 0;
  if (refused && mutation && retriesDraftServerFault(error, mutation))
    return true;
  if (refused && mutation && retriesChannelWrite(error, mutation)) return true;

  // Any other failure ends the write's run of server faults.
  if (mutation) draftFaults.delete(writeKey(mutation));
  return !refused && isTransientRequestError(error);
}
