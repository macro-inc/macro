import type { RichMessage } from '../../mentions';
import { MacroError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { Channel } from './channel';
import type { Thread } from './thread';

/**
 * Post a message using the endpoint supported by the caller's credentials.
 *
 * Most credentials use `POST /channels/{id}/message`. User-owned bots without
 * an acting user instead use `POST /channels/{id}/webhook`, which authorizes
 * through channel membership. The bot owner is read from `GET /bots/me` and
 * cached by the client.
 *
 * The webhook endpoint supports content only. Mentions in `<m-*>` tags still
 * work, but threads and attachments are not supported.
 *
 * Posting to a `Thread` puts the message in that thread; to a `Channel`, at the
 * channel root. One target rather than a channel plus a thread id, so the two
 * can't disagree.
 */
export async function postToChannel(
  client: MacroClient,
  target: Channel | Thread,
  body: RichMessage,
): Promise<string> {
  const { channelId, thread } = resolve(target);

  if (await hasEntityAccess(client)) {
    const { id } = unwrap(
      await client.storage.postMessage({
        path: { channel_id: channelId },
        body: {
          content: body.content,
          mentions: body.mentions,
          attachments: [],
          thread_id: thread?.rootId ?? null,
          nonce: crypto.randomUUID(),
        },
      }),
    );
    return id;
  }

  if (thread) {
    throw new MacroError(
      'a user-owned bot can only post via the channel webhook endpoint, which ' +
        'does not support threads — use a team-owned bot, or requestedAs(user), ' +
        'to reply in a thread',
    );
  }

  const { message_id } = unwrap(
    await client.storage.postChannelBotWebhook({
      path: { channel_id: channelId },
      body: { content: body.content },
      // Not a claim to be acting as a user — no acting user is sent. The
      // header is required to parse but never read here (the route resolves
      // no access scope, only bot identity plus channel membership), and
      // `user` is the value that authenticates: the inherited default would
      // be `team`, which a user-owned bot is rejected for. If this route ever
      // moves onto entity access, this breaks — user scope without an acting
      // user is refused there.
      headers: { 'x-macro-bot-scope': 'user' },
    }),
  );
  return message_id;
}

/** Split a target into the channel to post in and the thread to post under. */
function resolve(target: Channel | Thread): {
  channelId: string;
  thread?: Thread;
} {
  return 'rootId' in target
    ? { channelId: target.channelId, thread: target }
    : { channelId: target.id };
}

/**
 * Whether this credential resolves to a scope the entity-access routes accept.
 *
 * User tokens always do. A bot does when it acts for a user, or when it is
 * team-owned — a team-owned bot's participant row grants its role in any
 * channel, so membership alone is enough there too.
 */
async function hasEntityAccess(client: MacroClient): Promise<boolean> {
  if (client.authConfig.type !== 'bot' || client.hasActingUser()) return true;
  const { owner } = await client.selfBot();
  return owner?.type === 'team';
}
