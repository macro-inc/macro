import type { SoupApiItem } from '@service-storage/generated/schemas';

/**
 * Email-importance insert gate for soup queries that filter emails by
 * importance server-side. `emailImportance` is captured from the same filter
 * state the query key compiles from, so a cached tab keeps gating websocket
 * inserts by its own membership after the user switches tabs. Non-email items
 * and queries without an importance filter pass.
 *
 * Emails are matched on the denormalized `email_threads.is_signal` flag the
 * soup payload carries on both transports — the exact value the server's
 * Importance filter evaluates. A row cached before the field shipped has no
 * value and matches neither tab, so it simply waits for the next server
 * fetch. Registered as `meta.insertFilter`, so fetched rows never run through
 * this — a miss only delays a cache insert.
 */
export function emailItemMatchesImportance(
  item: SoupApiItem,
  emailImportance: boolean | undefined
): boolean {
  if (emailImportance === undefined) return true;
  if (item.tag !== 'emailThread') return true;
  return item.data.isSignal === emailImportance;
}
