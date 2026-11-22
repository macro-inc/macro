import {
  type CacheHost,
  readRecordsByKeys,
  selectRecords,
} from '@graphql-cache/index';
import { ChannelMessageFieldsFragmentDoc } from '@service-storage/graphql/generated/graphql';
import type {
  Message,
  MessageThread,
  MessageTimelineEntry,
  MessageTimelinePage,
} from '@service-storage/messages';
import { ResultAsync } from 'neverthrow';
import { z } from 'zod';
import { insertReplyIntoThreadPreview } from '../thread-preview';
import { mapChannelMessage } from './map';
import { rereadAfterDeviceFault } from './rereads';
import { channelMessageKey, timestampMicros } from './sort-key';

/**
 * Replies the device holds that their root's record does not show yet.
 *
 * A root's record carries its reply count and preview as the server last
 * sent them. A reply written on this device changes neither: while it waits
 * in the queue only its own record exists, and once delivered the root is
 * brought up to date a moment later, with the channel's next changes. A page
 * read from the device in between would draw the root without the reply, and
 * take a reply already on screen off it. Such replies are put into the page
 * as it is read.
 *
 * A thread read has the same gap: the server's copy of a thread cannot carry
 * a reply still waiting, and one fetched while the reply was on its way
 * lacks it. Such replies are put into the thread as it is read, too.
 */

export type UnsettledRepliesHost = Pick<
  CacheHost,
  'readRecordsByKeys' | 'inspectMutations'
>;

interface OwnReply {
  channelId: string;
  rootId: string;
  /** The row as sent, then as the server stored it. */
  reply: Message;
  delivered: boolean;
}

/** Replies this window sent, by id, until their root's record shows them. */
const ownReplies = new Map<string, OwnReply>();
/** Notes are dropped oldest first past this many. */
const MAX_OWN_REPLIES = 200;

const SEND_OPERATION = 'SendChannelMessage';

const messageSelection = selectRecords(ChannelMessageFieldsFragmentDoc);

const queuedReplySchema = z.object({
  operationName: z.literal(SEND_OPERATION),
  superseded: z.literal(false),
  variables: z.object({
    input: z.object({
      channelId: z.string(),
      id: z.string(),
      threadId: z.string(),
    }),
  }),
});

/** Notes a reply this window is sending, before the queue is asked. */
export function noteOwnReply(
  channelId: string,
  rootId: string,
  reply: Message
): void {
  ownReplies.delete(reply.id);
  ownReplies.set(reply.id, { channelId, rootId, reply, delivered: false });
  for (const id of ownReplies.keys()) {
    if (ownReplies.size <= MAX_OWN_REPLIES) break;
    ownReplies.delete(id);
  }
}

/** The server stored the reply; its root's record follows. */
export function ownReplyDelivered(reply: Message): void {
  const note = ownReplies.get(reply.id);
  if (!note) return;
  note.reply = reply;
  note.delivered = true;
}

/** The reply was refused, and the device rolled its row back. */
export function forgetOwnReply(replyId: string): void {
  ownReplies.delete(replyId);
}

/** The ids of the channel's replies waiting in the device queue, by root. */
async function queuedReplies(
  host: UnsettledRepliesHost,
  channelId: string
): Promise<Map<string, string>> {
  const rootOf = new Map<string, string>();
  if (!host.inspectMutations) return rootOf;
  // The page is still right without them; the queue reports its own faults.
  const queued = await ResultAsync.fromPromise(
    host.inspectMutations(),
    (error) => error
  );
  // A reply waiting there is missing from this answer: read again shortly.
  if (queued.isErr()) rereadAfterDeviceFault(channelId);
  for (const mutation of queued.unwrapOr([])) {
    const parsed = queuedReplySchema.safeParse(mutation);
    if (!parsed.success) continue;
    const { input } = parsed.data.variables;
    if (input.channelId === channelId) rootOf.set(input.id, input.threadId);
  }
  return rootOf;
}

/** Whether a reply to one of the page's roots waits in the device queue. */
export async function pageHasQueuedReplies(
  host: UnsettledRepliesHost,
  channelId: string,
  page: MessageTimelinePage
): Promise<boolean> {
  const roots = rootIdsOf(page.entries);
  if (roots.size === 0) return false;
  const rootOf = await queuedReplies(host, channelId);
  return [...rootOf.values()].some((rootId) => roots.has(rootId));
}

function isBefore(earlier: string | null | undefined, later: string): boolean {
  if (earlier == null) return true;
  const [left, right] = [timestampMicros(earlier), timestampMicros(later)];
  // A time that cannot be read proves nothing; the reply is kept on screen.
  if (left === undefined || right === undefined) return true;
  return left < right;
}

function byTimeWritten(left: Message, right: Message): number {
  const [first, second] = [
    timestampMicros(left.created_at),
    timestampMicros(right.created_at),
  ];
  if (first === undefined || second === undefined || first === second) {
    return 0;
  }
  return first < second ? -1 : 1;
}

function rootIdsOf(entries: readonly MessageTimelineEntry[]): Set<string> {
  return new Set(
    entries.flatMap((entry) =>
      entry.type === 'activity' ? [] : [entry.message.id]
    )
  );
}

/** Lists the channel's waiting replies, for a page read to take in. */
export function listQueuedReplies(
  host: UnsettledRepliesHost,
  channelId: string
): Promise<Map<string, string>> {
  return queuedReplies(host, channelId);
}

/**
 * The page with the replies its roots' records do not show yet: the ones
 * waiting in the device queue, from any window, and the ones this window
 * sent whose root the device has not brought up to date.
 */
export async function withUnsettledReplies(
  host: UnsettledRepliesHost,
  channelId: string,
  page: MessageTimelinePage,
  /** The queue as it was listed while the page was being read. */
  queued: Promise<Map<string, string>> = queuedReplies(host, channelId)
): Promise<MessageTimelinePage> {
  const roots = rootIdsOf(page.entries);
  const rootOf = new Map(await queued);
  const queuedIds = new Set(rootOf.keys());
  for (const [id, note] of ownReplies) {
    if (note.channelId === channelId) rootOf.set(id, note.rootId);
  }
  for (const [id, rootId] of rootOf) {
    if (!roots.has(rootId)) rootOf.delete(id);
  }
  if (rootOf.size === 0) return page;

  const { records } = await readRecordsByKeys(
    host,
    messageSelection,
    [...rootOf.keys()].map(channelMessageKey)
  );
  const held = new Map(records.map(({ record }) => [record.id, record]));
  const byRoot = new Map<string, { reply: Message; placed: boolean }[]>();
  for (const [id, rootId] of rootOf) {
    const record = held.get(id);
    const note = ownReplies.get(id);
    // A reply the queue has not stored yet is only what this window noted.
    const noted = note && !note.delivered ? note.reply : undefined;
    const reply = record ? mapChannelMessage(record) : noted;
    if (!reply) {
      // Delivered and no longer held: it was removed.
      ownReplies.delete(id);
      continue;
    }
    if (reply.deleted_at) {
      if (note?.delivered) ownReplies.delete(id);
      continue;
    }
    const placed = !queuedIds.has(id) && note?.delivered === true;
    byRoot.set(rootId, [...(byRoot.get(rootId) ?? []), { reply, placed }]);
  }
  if (byRoot.size === 0) return page;

  return {
    ...page,
    entries: page.entries.map((entry) => {
      if (entry.type === 'activity') return entry;
      const replies = byRoot.get(entry.message.id);
      if (!replies) return entry;
      let thread = entry.message.thread;
      // The server previews a thread's first replies only. A root that counts
      // more than it previews may count a waiting reply already, when the
      // answer to its send was lost; nothing here can tell.
      const cutShort = thread.preview.length < thread.reply_count;
      const ordered = [...replies].sort((left, right) =>
        byTimeWritten(left.reply, right.reply)
      );
      for (const { reply, placed } of ordered) {
        if (thread.preview.some((shown) => shown.id === reply.id)) {
          ownReplies.delete(reply.id);
          continue;
        }
        // The server has placed the reply: a root whose latest reply is at
        // or after it has been brought up to date, and counts it already.
        if (placed && !isBefore(thread.latest_reply_at, reply.created_at)) {
          ownReplies.delete(reply.id);
          continue;
        }
        if (!placed && cutShort) continue;
        thread = { ...thread, ...insertReplyIntoThreadPreview(thread, reply) };
      }
      return thread === entry.message.thread
        ? entry
        : { ...entry, message: { ...entry.message, thread } };
    }),
  };
}

/** Where a reply the server has placed goes among a thread's replies. */
function placeAmong(replies: readonly Message[], reply: Message): number {
  const index = replies.findIndex((shown) => byTimeWritten(reply, shown) < 0);
  return index === -1 ? replies.length : index;
}

/**
 * The thread with the replies to its root that it does not hold yet: the ones
 * waiting in the device queue, from any window, and the ones this window sent
 * that the thread was read too early to carry. A thread lists every reply, so
 * one it already holds is never added twice.
 */
export async function withUnsettledThreadReplies(
  host: UnsettledRepliesHost,
  channelId: string,
  thread: MessageThread,
  /** The queue as it was listed while the thread was being read. */
  queued: Promise<Map<string, string>> = queuedReplies(host, channelId)
): Promise<MessageThread> {
  const rootId = thread.root.id;
  const shown = new Set(thread.replies.map((reply) => reply.id));
  const missing = new Set<string>();
  for (const [id, queuedRootId] of await queued) {
    if (queuedRootId === rootId && !shown.has(id)) missing.add(id);
  }
  for (const [id, note] of ownReplies) {
    if (note.channelId !== channelId || note.rootId !== rootId) continue;
    if (!shown.has(id)) missing.add(id);
  }
  if (missing.size === 0) return thread;

  const { records } = await readRecordsByKeys(
    host,
    messageSelection,
    [...missing].map(channelMessageKey)
  );
  const held = new Map(records.map(({ record }) => [record.id, record]));
  const waiting: Message[] = [];
  let replies = thread.replies;
  for (const id of missing) {
    const record = held.get(id);
    const note = ownReplies.get(id);
    const noted = note && !note.delivered ? note.reply : undefined;
    const stored = record ? mapChannelMessage(record) : noted;
    // Delivered and no longer held, or deleted: the page read drops its note.
    if (!stored || stored.deleted_at) continue;
    if (note?.delivered) {
      // The record may still hold the time the reply was written with.
      const reply = { ...stored, created_at: note.reply.created_at };
      const at = placeAmong(replies, reply);
      replies = [...replies.slice(0, at), reply, ...replies.slice(at)];
    } else {
      waiting.push(stored);
    }
  }
  if (replies === thread.replies && waiting.length === 0) return thread;
  // A reply still waiting sorts after every reply the server has placed.
  return { ...thread, replies: [...replies, ...waiting.sort(byTimeWritten)] };
}

/** Forgets every note: they belong to the account and cache they were made for. */
export function resetUnsettledReplies(): void {
  ownReplies.clear();
}
