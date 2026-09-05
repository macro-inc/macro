import type { SoupApiItem } from '@service-storage/generated/schemas';

// Mirrors the label arm of the server's `email_threads.is_signal` heuristic
// (`sync_thread_signal_flag` in email_db_client): a message counts as signal
// when it is a draft, carries a personal/sent/draft label, or carries no
// deprioritizing category label. Label names are compared exactly, the same
// way the server query matches them. The mirror stays an approximation in two
// ways it cannot close: sender importance policies (`email_filters`) also
// feed the server flag but are not visible on the soup item, and the soup
// labels are a thread-wide union while the server checks each non-trash
// message on its own. It is therefore only used to gate optimistic cache
// inserts, where a miss delays a row until the next server fetch — never to
// filter fetched rows. Gmail's IMPORTANT label deliberately does not count:
// the server ignores it, and GitHub notification mail often carries IMPORTANT
// next to CATEGORY_UPDATES.
const PRIORITY_LABELS = ['CATEGORY_PERSONAL', 'SENT', 'DRAFT'];

const DEPRIORITY_LABELS = [
  'CATEGORY_UPDATES',
  'CATEGORY_PROMOTIONS',
  'CATEGORY_SOCIAL',
  'CATEGORY_FORUMS',
];

type EmailSignalSource = {
  isDraft: boolean;
  labels?: Array<{ name?: string }>;
};

export function emailItemLooksSignal(email: EmailSignalSource): boolean {
  if (email.isDraft) return true;

  const names = (email.labels ?? []).map((label) => label.name);

  if (PRIORITY_LABELS.some((name) => names.includes(name))) return true;

  return !DEPRIORITY_LABELS.some((name) => names.includes(name));
}

/**
 * Email-importance insert gate for soup queries that filter emails by
 * importance server-side. `emailImportance` is captured from the same filter
 * state the query key compiles from, so a cached tab keeps gating websocket
 * inserts by its own membership after the user switches tabs. Non-email items
 * and queries without an importance filter pass. Registered as
 * `meta.insertFilter`, so fetched rows never run through it — a
 * misclassification only delays a cache insert until the next server fetch.
 */
export function emailItemMatchesImportance(
  item: SoupApiItem,
  emailImportance: boolean | undefined
): boolean {
  if (emailImportance === undefined) return true;
  if (item.tag !== 'emailThread') return true;
  return emailItemLooksSignal(item.data) === emailImportance;
}
