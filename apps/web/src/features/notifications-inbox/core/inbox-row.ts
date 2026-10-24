/** The kinds of notification inbox row this build knows. */
export type InboxRowType =
  | 'agent'
  | 'email'
  | 'channel_mention'
  | 'channel_messages'
  | 'channel_thread'
  | 'discussion_mention'
  | 'discussion_messages'
  | 'discussion_thread'
  | 'task'
  | 'pull_request'
  | 'calendar_event'
  | 'calendar_join_request'
  | 'access_requested'
  | 'access_granted';

/** Who a row is from, per its newest notification. */
export type InboxActor =
  | { kind: 'user'; id: string }
  | { kind: 'agent'; name?: string }
  | { kind: 'macro' }
  /** A kind this build doesn't know; the row names no author. */
  | { kind: 'other' };

/** A decision on the access or join request a row carries. */
export type InboxDecision = 'approve' | 'deny' | 'accept' | 'decline';

/** Something the viewer can do from a row. */
export type InboxRowAction =
  /** Open what the row is about. */
  | { kind: 'open' }
  /** Answer the agent waiting for the viewer. */
  | { kind: 'answer' }
  /** Review the pull request at `url`, outside Macro. */
  | { kind: 'review'; url: string }
  /** Approve or deny an access request, accept or decline a join request. */
  | { kind: InboxDecision; targetId: string };

export type InboxDecisionAction = Extract<InboxRowAction, { targetId: string }>;

/**
 * One notification inbox row: the notifications that present together, such
 * as one thread or one access request. `Content` is what the row shows; the
 * data source's adapter decides its shape.
 */
export type InboxRow<Content> = {
  /** Stable, opaque row id. */
  id: string;
  /** `other` for a kind this build doesn't know, shown as a generic row. */
  type: InboxRowType | 'other';
  /** What a done of this row acknowledges. */
  revision: string;
  /** When the row's newest notification was created, epoch milliseconds. */
  latestAt: number;
  /** Absent when the row is from no one in Macro, such as an email sender. */
  actor?: InboxActor;
  /** What the viewer can do from the row, in button order. */
  actions: readonly InboxRowAction[];
  unseen: boolean;
  /** How many notifications the row shows. */
  count: number;
  content: Content;
};

export const isDecisionAction = (
  action: InboxRowAction
): action is InboxDecisionAction =>
  action.kind === 'approve' ||
  action.kind === 'deny' ||
  action.kind === 'accept' ||
  action.kind === 'decline';

/** Newest first; equal times keep a stable order by row id. */
export function compareInboxRows<Content>(
  a: InboxRow<Content>,
  b: InboxRow<Content>
): number {
  if (a.latestAt !== b.latestAt) return b.latestAt - a.latestAt;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * Rows the viewer marked done or seen here, with the revision each
 * acknowledged. The mark holds while a loaded row still shows that revision,
 * until the server's change lands; a newer notification lifts it.
 */
export type RowMarks = ReadonlyMap<string, string>;

/** The rows without the ones marked done. */
export function withoutDoneRows<Content>(
  rows: readonly InboxRow<Content>[],
  done: RowMarks
): InboxRow<Content>[] {
  return rows.filter((row) => done.get(row.id) !== row.revision);
}

/** The rows, with the ones marked seen read. */
export function withSeenRows<Content>(
  rows: readonly InboxRow<Content>[],
  seen: RowMarks
): InboxRow<Content>[] {
  if (seen.size === 0) return [...rows];
  return rows.map((row) =>
    row.unseen && seen.get(row.id) === row.revision
      ? { ...row, unseen: false }
      : row
  );
}

/** Mark rows at the revision each acknowledged. */
export function markRows(
  marks: RowMarks,
  rows: readonly Pick<InboxRow<unknown>, 'id' | 'revision'>[]
): RowMarks {
  const next = new Map(marks);
  for (const row of rows) next.set(row.id, row.revision);
  return next;
}

/** Lift marks after an undone or failed change. */
export function unmarkRows(
  marks: RowMarks,
  rowIds: readonly string[]
): RowMarks {
  const next = new Map(marks);
  for (const rowId of rowIds) next.delete(rowId);
  return next;
}

/**
 * Forget marks a fresh read settled: the feed no longer holds the row, or
 * holds it with newer notifications. Only rows still shown at the
 * acknowledged revision stay marked.
 */
export function settleRowMarks<Content>(
  marks: RowMarks,
  rows: readonly InboxRow<Content>[]
): RowMarks {
  if (marks.size === 0) return marks;
  const next = new Map<string, string>();
  for (const row of rows) {
    if (marks.get(row.id) === row.revision) next.set(row.id, row.revision);
  }
  return next;
}
