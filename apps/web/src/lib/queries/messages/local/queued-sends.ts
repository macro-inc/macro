import type { CacheHost } from '@graphql-cache/index';
import type { ChannelMessageFieldsFragment } from '@service-storage/graphql/generated/graphql';
import type { MessageTimelinePage } from '@service-storage/messages';
import { ResultAsync } from 'neverthrow';
import { z } from 'zod';
import { mapChannelTimelineEntry } from './map';
import { queueOwner } from './queue-owner';
import { predictedMessage } from './writes';

/**
 * Messages waiting in the device queue that a page read does not carry.
 *
 * The queue is what decides that a message will be sent. The row the device
 * shows for it is a second thing, kept beside the write, and it can be
 * missing while the write is there: when the cache session was replaced as
 * the message was sent, the queue kept the write and a page read after a
 * reload came back without its row. The person would see a message they
 * wrote gone, and then see it delivered. Such messages are put into the page
 * as it is read, as the row the write was sent with, made again from what the
 * queue holds of it.
 *
 * Replies are not rows of a page; `unsettled-replies` keeps those on screen.
 */

export type QueuedSendsHost = Pick<CacheHost, 'inspectMutations'>;

const entitySchema = z.object({ entityType: z.string(), entityId: z.string() });

const queuedSendSchema = z.object({
  operationName: z.literal('SendChannelMessage'),
  superseded: z.literal(false),
  enqueuedAtMs: z.number(),
  variables: z.object({
    input: z.object({
      channelId: z.string(),
      id: z.string(),
      content: z.string(),
      threadId: z.null(),
      mentions: z.array(entitySchema),
      attachments: z.array(
        entitySchema.extend({
          width: z.number().nullish(),
          height: z.number().nullish(),
        })
      ),
    }),
  }),
});

const queuedDeleteSchema = z.object({
  operationName: z.literal('DeleteChannelMessage'),
  superseded: z.literal(false),
  variables: z.object({ input: z.object({ id: z.string() }) }),
});

const messageIdsOf = (page: MessageTimelinePage): Set<string> =>
  new Set(
    page.entries.flatMap((entry) =>
      entry.type === 'activity' ? [] : [entry.message.id]
    )
  );

interface QueuedSend {
  id: string;
  /** The row to draw, for a message the page lacks. */
  missing?: ChannelMessageFieldsFragment;
}

/**
 * The channel's top-level messages waiting in the queue, oldest first, each
 * with its row when the page lacks it.
 */
async function queuedSends(
  host: QueuedSendsHost,
  channelId: string,
  page: MessageTimelinePage
): Promise<QueuedSend[]> {
  const senderId = queueOwner();
  if (!senderId || !host.inspectMutations || page.previous_cursor != null) {
    return [];
  }
  // The page is still right without them; the queue reports its own faults.
  const listed = await ResultAsync.fromPromise(
    host.inspectMutations(),
    (error) => error
  );
  const queue = listed.unwrapOr([]);
  const shown = messageIdsOf(page);
  // A message deleted before it was sent stays off the page.
  const deleted = new Set<string>();
  for (const mutation of queue) {
    const deletion = queuedDeleteSchema.safeParse(mutation);
    if (deletion.success) deleted.add(deletion.data.variables.input.id);
  }
  const seen = new Set<string>();
  return queue.flatMap((mutation): QueuedSend[] => {
    const parsed = queuedSendSchema.safeParse(mutation);
    if (!parsed.success) return [];
    const { input } = parsed.data.variables;
    if (input.channelId !== channelId) return [];
    if (deleted.has(input.id) || seen.has(input.id)) return [];
    seen.add(input.id);
    if (shown.has(input.id)) return [{ id: input.id }];
    const missing = predictedMessage(
      {
        channelId,
        id: input.id,
        senderId,
        message: {
          content: input.content,
          mentions: input.mentions.map((mention) => ({
            entity_type: mention.entityType,
            entity_id: mention.entityId,
          })),
          attachments: input.attachments.map((attachment) => ({
            entity_type: attachment.entityType,
            entity_id: attachment.entityId,
            width: attachment.width,
            height: attachment.height,
          })),
        },
      },
      new Date(parsed.data.enqueuedAtMs).toISOString()
    );
    return missing ? [{ id: input.id, missing }] : [];
  });
}

/** Whether a message waiting in the device queue is missing from the page. */
export async function pageLacksQueuedSends(
  host: QueuedSendsHost,
  channelId: string,
  page: MessageTimelinePage
): Promise<boolean> {
  const sends = await queuedSends(host, channelId, page);
  return sends.some((send) => send.missing !== undefined);
}

/**
 * The page with the channel's top-level messages that wait in the device
 * queue and that it lacks. The queue sends in the order written, so each goes
 * just before the next waiting message the page does carry, and after
 * everything else when there is none. Only a page that reaches the channel's
 * newest message takes them.
 */
export async function withQueuedSends(
  host: QueuedSendsHost,
  channelId: string,
  page: MessageTimelinePage
): Promise<MessageTimelinePage> {
  const sends = await queuedSends(host, channelId, page);
  if (!sends.some((send) => send.missing !== undefined)) return page;
  // Entries run newest first; so does this walk, from the last one queued.
  const entries = [...page.entries];
  let later: number | undefined;
  for (const send of sends.toReversed()) {
    if (!send.missing) {
      const at = entries.findIndex(
        (entry) => entry.type !== 'activity' && entry.message.id === send.id
      );
      if (at !== -1) later = at;
      continue;
    }
    const entry = mapChannelTimelineEntry(send.missing);
    if (!entry) continue;
    const at = later === undefined ? 0 : later + 1;
    entries.splice(at, 0, entry);
    later = at;
  }
  return { ...page, entries };
}
