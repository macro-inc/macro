import {
  type CacheHost,
  readRecordsByKeys,
  selectRecords,
} from '@graphql-cache/index';
import { ChannelMessageFieldsFragmentDoc } from '@service-storage/graphql/generated/graphql';
import type {
  Message,
  MessageTimelineEntry,
  MessageTimelinePage,
} from '@service-storage/messages';
import { ResultAsync } from 'neverthrow';
import { z } from 'zod';
import { insertReplyIntoThreadPreview } from '../thread-preview';
import { mapChannelMessage } from './map';
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
  for (const mutation of queued.unwrapOr([])) {
    const parsed = queuedReplySchema.safeParse(mutation);
    if (!parsed.success) continue;
    const { input } = parsed.data.variables;
    if (input.channelId === channelId) rootOf.set(input.id, input.threadId);
  }
  return rootOf;
}

/** Whether a reply to the channel waits in the device queue. */
export async function channelHasQueuedReplies(
  host: UnsettledRepliesHost,
  channelId: string
): Promise<boolean> {
  return (await queuedReplies(host, channelId)).size > 0;
}

function isBefore(earlier: string | null | undefined, later: string): boolean {
  if (earlier == null) return true;
  const [left, right] = [timestampMicros(earlier), timestampMicros(later)];
  // A time that cannot be read proves nothing; the reply is kept on screen.
  if (left === undefined || right === undefined) return true;
  return left < right;
}

function rootIdsOf(entries: readonly MessageTimelineEntry[]): Set<string> {
  return new Set(
    entries.flatMap((entry) =>
      entry.type === 'activity' ? [] : [entry.message.id]
    )
  );
}

/**
 * The page with the replies its roots' records do not show yet: the ones
 * waiting in the device queue, from any window, and the ones this window
 * sent whose root the device has not brought up to date.
 */
export async function withUnsettledReplies(
  host: UnsettledRepliesHost,
  channelId: string,
  page: MessageTimelinePage
): Promise<MessageTimelinePage> {
  const roots = rootIdsOf(page.entries);
  const rootOf = await queuedReplies(host, channelId);
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
    if (reply.deleted_at) continue;
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
      const ordered = [...replies].sort((left, right) =>
        isBefore(left.reply.created_at, right.reply.created_at) ? -1 : 1
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
        thread = { ...thread, ...insertReplyIntoThreadPreview(thread, reply) };
      }
      return thread === entry.message.thread
        ? entry
        : { ...entry, message: { ...entry.message, thread } };
    }),
  };
}

/** For tests. */
export function resetUnsettledReplies(): void {
  ownReplies.clear();
}
