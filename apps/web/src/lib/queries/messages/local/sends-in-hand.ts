import type { ChannelMessageFieldsFragment } from '@service-storage/graphql/generated/graphql';
import type { MessageTimelinePage } from '@service-storage/messages';
import { mapChannelTimelineEntry } from './map';

/**
 * Messages this window is sending that a page read may not carry.
 *
 * The views show a message the moment it is sent. The device holds it only
 * once its queue has stored the write, some milliseconds later, and a page
 * read in between lacks it: so does one the server answers because the device
 * could not, as when the cache session is replaced under the send. Either
 * would take a message the person just sent off the screen. Such messages are
 * put into the page as it is read, until the send is delivered or refused,
 * and for a minute at most: by then the queue has stored the write, and a send
 * whose end this window never hears of (its cache host was replaced) must not
 * be shown as new for good.
 *
 * Replies are not rows of a page; `unsettled-replies` keeps those on screen.
 */

interface SendInHand {
  channelId: string;
  row: ChannelMessageFieldsFragment;
  notedAtMs: number;
}

/** How long a send is kept on the pages read, if it is not heard of again. */
export const SEND_IN_HAND_MAX_AGE_MS = 60_000;

/** By message id, in the order sent. */
const inHand = new Map<string, SendInHand>();

/** Notes a top-level message as it is handed to the device queue. */
export function noteSendInHand(
  row: ChannelMessageFieldsFragment,
  nowMs = Date.now()
): void {
  if (row.threadId !== null) return;
  inHand.set(row.id, { channelId: row.channelId, row, notedAtMs: nowMs });
}

/** The send was delivered or refused: what is read from now on is right. */
export function forgetSendInHand(messageId: string): void {
  inHand.delete(messageId);
}

/**
 * The page with the messages this window is sending that it lacks. Only a
 * page that reaches the channel's newest message takes them, after everything
 * the server has placed, which is where the device sorts a message not yet
 * delivered.
 */
export function withSendsInHand(
  channelId: string,
  page: MessageTimelinePage,
  nowMs = Date.now()
): MessageTimelinePage {
  for (const [id, send] of inHand) {
    if (nowMs - send.notedAtMs > SEND_IN_HAND_MAX_AGE_MS) inHand.delete(id);
  }
  if (inHand.size === 0 || page.previous_cursor != null) return page;
  const shown = new Set(
    page.entries.flatMap((entry) =>
      entry.type === 'activity' ? [] : [entry.message.id]
    )
  );
  const missing = [...inHand.values()].flatMap((send) => {
    if (send.channelId !== channelId || shown.has(send.row.id)) return [];
    return mapChannelTimelineEntry(send.row) ?? [];
  });
  if (missing.length === 0) return page;
  // Entries run newest first.
  return { ...page, entries: [...missing.reverse(), ...page.entries] };
}

/** Forgets every send: they belong to the account they were made for. */
export function resetSendsInHand(): void {
  inHand.clear();
}
