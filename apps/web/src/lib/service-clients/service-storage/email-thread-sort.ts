import { match, P } from 'ts-pattern';
import type { GraphqlEmailView } from './graphql/generated/graphql';

function latestTimestamp(
  ...timestamps: (string | null | undefined)[]
): string | undefined {
  return timestamps.reduce<string | undefined>(
    (latest, timestamp) =>
      typeof timestamp === 'string' &&
      (latest === undefined || Date.parse(timestamp) > Date.parse(latest))
        ? timestamp
        : latest,
    undefined
  );
}

/** The server's per-view sort key, recomputed from the thread's own facts so a
 * cache re-read never dates a row by the view that fetched the thread last.
 * Mirrors `get_sort_timestamp_field` in crates/email; INBOX is the server's
 * default view. */
export function emailThreadSortTs(
  thread: {
    latestInboundMessageTs?: string | null;
    reminderReturnedAt?: string | null;
    latestOutboundMessageTs?: string | null;
    latestNonSpamMessageTs?: string | null;
    updatedAt: string;
  },
  emailView: GraphqlEmailView | null | undefined
): string {
  const key = match(emailView)
    .with('SENT', () => thread.latestOutboundMessageTs)
    .with('INBOX', P.nullish, () =>
      latestTimestamp(thread.latestInboundMessageTs, thread.reminderReturnedAt)
    )
    .otherwise(() => thread.latestNonSpamMessageTs);
  return key ?? thread.updatedAt;
}
