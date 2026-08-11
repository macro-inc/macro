/**
 * The channel rows a live agent session's folded messages render into.
 *
 * A folded message is only ever shown through a placeholder comms row — a
 * message with no content whose `agent_session_message_id` names it (see
 * `ChannelMessage`'s `FoldedMessageLayout`). The server writes those rows as
 * it folds, but a client watching a session live learns about a new message
 * before that row can reach it, so it makes one itself and lets the real row
 * replace it when it arrives.
 *
 * The two halves of that:
 *
 * - {@link ensureAgentSessionPlaceholder}, when the fold first derives a
 *   message, so there is something to render.
 * - {@link adoptAgentSessionPlaceholder}, when the real row turns up, so the
 *   channel does not end up with the turn twice.
 */

import type { ApiChannelMessage } from '@service-storage/client';
import type { ApiMessageSender } from '@service-storage/generated/schemas/apiMessageSender';
import type { FoldedMessageDto } from '@service-storage/generated/schemas/foldedMessageDto';
import type { SessionBotDto } from '@service-storage/generated/schemas/sessionBotDto';
import {
  findTopLevelMessageInChannelMessagesWhere,
  insertTopLevelMessageIntoChannelMessages,
  replaceTopLevelMessageIdInChannelMessages,
  setChannelMessagesData,
} from './channel-messages';

/** The channel row rendering a given folded message, if the client has one. */
function findPlaceholder(
  channelId: string,
  agentSessionMessageId: string
): ApiChannelMessage | undefined {
  return findTopLevelMessageInChannelMessagesWhere(
    channelId,
    (message) => message.agent_session_message_id === agentSessionMessageId
  );
}

/**
 * The agent each channel's session runs, as the log response named it.
 *
 * Recorded rather than looked up because nothing else a channel fetches names
 * it. The obvious candidate, `GET /channels/{id}/bots`, answers a different
 * question - bots explicitly added to the channel - and correctly returns
 * nothing for a session whose agent was never added, which is the ordinary
 * case. The server knows exactly which bot; this is where it says so.
 */
const sessionBots = new Map<string, SessionBotDto>();

/** Remember the agent behind a channel's session, from its log response. */
export function rememberSessionBot(
  channelId: string,
  bot: SessionBotDto | null | undefined
): void {
  if (bot) sessionBots.set(channelId, bot);
}

/** The sender identity a placeholder row carries. */
type PlaceholderSender = Pick<ApiChannelMessage, 'sender' | 'sender_id'>;

/**
 * Who a synthesized placeholder is from.
 *
 * The server picks this from data the client does not have — the session's
 * bot, or the channel's owner standing in for an unattributed prompt — so
 * this reconstructs it from what is at hand, best first:
 *
 * 1. The prompt's own author, when the log attributed it.
 * 2. Whatever an existing placeholder for the same side of the conversation
 *    is from. Exact, because it is a row the server itself wrote, and
 *    available from the second turn of any session onwards.
 * 3. The channel's bot, for an agent message in a session whose first turn
 *    this is.
 *
 * `undefined` when none of those answer, which leaves the message unrendered
 * until its real row is fetched — a turn late rather than misattributed.
 *
 * Async because of the last one. The bots are a query, and peeking at its
 * cache made this a race that only the *first* agent turn loses: frames
 * routinely arrive before the query resolves, and the decision to skip a row
 * is taken once and never revisited, so the turn stays unrendered even after
 * the bots land. Awaiting is free when the cache is warm, which it is from the
 * second turn on.
 */
async function placeholderSender(
  channelId: string,
  folded: FoldedMessageDto
): Promise<PlaceholderSender | undefined> {
  if (folded.author.kind === 'user' && folded.author.userId) {
    const userId = folded.author.userId;
    return { sender_id: userId, sender: { type: 'user', id: userId } };
  }

  const sibling = findPlaceholderFromSameAuthor(channelId, folded);
  if (sibling) {
    return { sender_id: sibling.sender_id, sender: sibling.sender };
  }

  if (folded.author.kind !== 'agent') return undefined;

  const bot = sessionBots.get(channelId);
  if (!bot) return undefined;

  const sender: ApiMessageSender = {
    type: 'bot',
    id: bot.id,
    name: bot.name,
    ...(bot.avatarUrl ? { avatar_url: bot.avatarUrl } : {}),
  };
  // Storage namespaces bot principals; `senderFromStorageId` is the inverse.
  return { sender_id: `bot|${bot.id}`, sender };
}

/**
 * An existing placeholder row for the same side of the conversation.
 *
 * Matched on the composite id's trailing `:user`/`:agent`, which is the
 * author the server chose the row's sender from — the same question being
 * asked here.
 */
function findPlaceholderFromSameAuthor(
  channelId: string,
  folded: FoldedMessageDto
): ApiChannelMessage | undefined {
  const suffix = `:${folded.author.kind}`;
  return findTopLevelMessageInChannelMessagesWhere(channelId, (message) =>
    (message.agent_session_message_id ?? '').endsWith(suffix)
  );
}

/**
 * Put a row in the channel for a folded message the fold has just derived,
 * unless one is already there.
 *
 * Idempotent for the same reason the server's write is: a session that
 * reconnects re-derives its whole log, so a "new" message is not always new
 * to the channel.
 */
export async function ensureAgentSessionPlaceholder(
  channelId: string,
  folded: FoldedMessageDto
): Promise<void> {
  const agentSessionMessageId = folded.agentSessionMessageId;
  if (findPlaceholder(channelId, agentSessionMessageId)) return;

  const sender = await placeholderSender(channelId, folded);
  // Re-checked: resolving the sender can await, and another frame for the same
  // message may have inserted the row in the meantime.
  if (findPlaceholder(channelId, agentSessionMessageId)) return;
  if (!sender) {
    console.warn('[agent-fold] no sender for a live placeholder', {
      channelId,
      agentSessionMessageId,
    });
    return;
  }

  // Timestamped now rather than from the log: the fold derives no time, and
  // "when this message appeared" is what the row is ordered and grouped by.
  const now = new Date().toISOString();

  setChannelMessagesData(channelId, (data) =>
    insertTopLevelMessageIntoChannelMessages(data, {
      id: crypto.randomUUID(),
      channel_id: channelId,
      agent_session_message_id: agentSessionMessageId,
      // Null on purpose. A placeholder's body is the folded message joined in
      // by `agent_session_message_id`; anything stored here would be a lie.
      content: null,
      sender_id: sender.sender_id,
      sender: sender.sender,
      created_at: now,
      updated_at: now,
      attachments: [],
      reactions: [],
      thread: { preview: [], reply_count: 0, latest_reply_at: null },
    })
  );
}

/**
 * Point a synthesized placeholder at the real row's id, so the row that
 * follows it over the websocket updates the message instead of adding a
 * second one.
 *
 * Renaming rather than removing-and-inserting keeps the message where it
 * already is in the list — it has been on screen, possibly scrolled to, since
 * the fold first derived it.
 */
export function adoptAgentSessionPlaceholder(
  channelId: string,
  agentSessionMessageId: string,
  messageId: string
): void {
  const synthesized = findPlaceholder(channelId, agentSessionMessageId);
  if (!synthesized || synthesized.id === messageId) return;

  setChannelMessagesData(channelId, (data) =>
    replaceTopLevelMessageIdInChannelMessages(data, synthesized.id, messageId)
  );
}
