import { isTransientRequestError } from '@core/util/request-error';
import type { ClaimedMutation } from '@graphql-cache/protocol';
import type { CombinedError } from '@urql/core';

type QueuedMutation = Pick<
  ClaimedMutation,
  'transactionId' | 'uuid' | 'operationName'
>;

const DRAFT_WRITES = ['SaveEmailDraft', 'DeleteEmailDraft'];
/** The channel message writes the queue delivers; each is replay safe. */
export const CHANNEL_MESSAGE_WRITES: readonly string[] = [
  'PostChannelMessage',
  'EditChannelMessage',
  'DeleteChannelMessage',
  'ReactToChannelMessage',
];
// The queue head blocks every write behind it while it retries, so a draft
// write the server keeps faulting gives up after a few seconds of backoff.
const MAX_DRAFT_SERVER_FAULT_RETRIES = 2;
const MAX_TRACKED_WRITES = 256;
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
    !error.graphQLErrors.every((entry) => entry.extensions.code === 'INTERNAL')
  )
    return false;

  const faults = (draftFaults.get(writeKey(mutation)) ?? 0) + 1;
  if (faults > MAX_DRAFT_SERVER_FAULT_RETRIES) return false;

  // Writes that later succeed never report back; keep their counts bounded.
  if (draftFaults.size >= MAX_TRACKED_WRITES) draftFaults.clear();
  draftFaults.set(writeKey(mutation), faults);
  return true;
}

/**
 * The server turned a channel message write away because too many writes
 * were in flight. Nothing was written, so the write is sent again for as long
 * as it takes: the refusal is not a failure of the write.
 */
export function isGraphqlMutationBackPressure(
  error: CombinedError,
  mutation?: QueuedMutation
): boolean {
  return (
    CHANNEL_MESSAGE_WRITES.includes(mutation?.operationName ?? '') &&
    error.graphQLErrors.length > 0 &&
    error.graphQLErrors.every((entry) => entry.extensions.code === 'BUSY')
  );
}

/**
 * Retry transport failures. Application errors release the queue head, except
 * a server fault on an email draft write, which is retried twice in a row, and
 * a channel message write the server was too busy to take.
 */
export function shouldRetryGraphqlMutation(
  error: CombinedError,
  mutation?: QueuedMutation
): boolean {
  if (isGraphqlMutationBackPressure(error, mutation)) return true;
  const refused = error.graphQLErrors.length > 0;
  if (refused && mutation && retriesDraftServerFault(error, mutation))
    return true;

  // Any other failure ends the write's run of server faults.
  if (mutation) draftFaults.delete(writeKey(mutation));
  return !refused && isTransientRequestError(error);
}
