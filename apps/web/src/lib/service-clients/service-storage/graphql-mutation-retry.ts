import { isTransientRequestError } from '@core/util/request-error';
import type { ClaimedMutation } from '@graphql-cache/protocol';
import type { CombinedError } from '@urql/core';

type QueuedMutation = Pick<
  ClaimedMutation,
  'transactionId' | 'uuid' | 'operationName'
>;

/** A refusal the server answers before writing anything, worth sending again. */
type RefusalRetry = {
  operations: readonly string[];
  code: string;
  attempts: number;
};

// The queue head blocks every write behind it while it retries, so a write
// the server keeps faulting on gives up after a few seconds of backoff.
const REFUSAL_RETRIES: readonly RefusalRetry[] = [
  // A draft write is a full-state upsert (or an idempotent delete) under its
  // own handle, so sending it again after the server faulted is safe.
  {
    operations: ['SaveEmailDraft', 'DeleteEmailDraft'],
    code: 'INTERNAL',
    attempts: 2,
  },
  // The channel write guard turns a write away before it runs when too many
  // are in flight for the channel, and asks for another try. Nothing was
  // refused, so the message waits like one typed offline: the queue backs
  // off and never counts these toward its server-failure limit.
  {
    operations: [
      'SendChannelMessage',
      'EditChannelMessage',
      'DeleteChannelMessage',
      'ReactToChannelMessage',
    ],
    code: 'SERVICE_UNAVAILABLE',
    attempts: Number.POSITIVE_INFINITY,
  },
];
const MAX_TRACKED_WRITES = 256;
/** Retried refusals in a row for each queued write. */
const refusals = new Map<string, number>();
// Transaction ids restart when the cache is rebuilt; the write's key does not.
const writeKey = (mutation: QueuedMutation) =>
  `${mutation.uuid}:${mutation.transactionId}`;

function retriesRefusal(
  error: CombinedError,
  mutation: QueuedMutation
): boolean {
  const retry = REFUSAL_RETRIES.find(
    (entry) =>
      entry.operations.includes(mutation.operationName ?? '') &&
      error.graphQLErrors.every(
        (refusal) => refusal.extensions.code === entry.code
      )
  );
  if (!retry) return false;

  if (retry.attempts === Number.POSITIVE_INFINITY) return true;
  const count = (refusals.get(writeKey(mutation)) ?? 0) + 1;
  if (count > retry.attempts) return false;

  // Writes that later succeed never report back; keep their counts bounded.
  if (refusals.size >= MAX_TRACKED_WRITES) refusals.clear();
  refusals.set(writeKey(mutation), count);
  return true;
}

/**
 * Retry transport failures. Application errors release the queue head, except
 * a server fault on an email draft write (retried twice in a row) and a busy
 * channel turning a message write away (retried until it is let in).
 */
export function shouldRetryGraphqlMutation(
  error: CombinedError,
  mutation?: QueuedMutation
): boolean {
  const refused = error.graphQLErrors.length > 0;
  if (refused && mutation && retriesRefusal(error, mutation)) return true;

  // Any other failure ends the write's run of retried refusals.
  if (mutation) refusals.delete(writeKey(mutation));
  return !refused && isTransientRequestError(error);
}
