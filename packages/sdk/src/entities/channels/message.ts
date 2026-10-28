import type { Message as MessageRecord } from '../../../generated/storage/types.gen';
import { type RichMessage, type SimpleMention, toBody } from '../../mentions';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { FavoritableEntity } from '../entity';
import { User } from '../users/user';
import { Channel } from './channel';
import { Thread } from './thread';

/** The API's representation of a message; the same record the document comment API returns. */
export type MessageData = MessageRecord;

/**
 * A handle to a channel message, not the message record: `content`,
 * `createdAt`, `editedAt` and `updatedAt` are async functions to call and await.
 *
 * `id`, `channelId` and `mentions` are plain properties. `mentions` is empty
 * unless a list, thread, or event supplied it. Record-backed reads load the
 * record once and cache it. Actions carry the ids for you.
 *
 * Handles from {@link Channel.messages}, {@link Channel.messagesAfter},
 * {@link Channel.timelinePage} and {@link Thread.replies} are seeded from the
 * page, so reads make no request. Handles from {@link Channel.message},
 * {@link Message.byId}, {@link Channel.send}, {@link Message.reply} and
 * channel events start empty and fetch the message on the first read. {@link react}, {@link edit}
 * and other writes drop the cache.
 *
 * Read the sender with {@link author} and thread replies with
 * {@link Thread.replies}. Reactions, attachments, bot or imported author
 * details, and the reply count and preview that list pages return have no
 * typed accessor on this handle. They can appear in `JSON.stringify(message)`
 * output for seeded handles (see {@link Message.toJSON}), but that is a
 * serialization snapshot, not a supported read API.
 *
 * Common pitfalls: `message.content` is a function, so call and await it;
 * record keys such as `message.sender_id` or `message.reactions` are
 * `undefined` on the handle rather than an error, and so are fields read
 * through the protected `message.detail` cache.
 *
 * @example
 * const me = await macro.users.me();
 * for await (const message of channel.messagesAfter(since)) {
 *   const [author, content] = await Promise.all([
 *     message.author(),
 *     message.content(),
 *   ]);
 *   if (author.id !== me.id) continue;
 *   const replies = await message.thread().replies();
 *   console.log(content.slice(0, 80), replies.length);
 * }
 */
export class Message extends FavoritableEntity<MessageRecord> {
  /** Favorites identify channel messages as `channel_message`. */
  readonly entityType = 'channel_message';

  private constructor(
    client: MacroClient,
    readonly channelId: string,
    id: string,
    /** Entities mentioned in this message, when a list, thread, or event supplied them. */
    readonly mentions: SimpleMention[] = [],
    seed?: MessageRecord,
  ) {
    super(client, id, seed);
  }

  private get path() {
    return { parent_type: 'channel', parent_id: this.channelId, id: this.id };
  }

  protected async fetch(): Promise<MessageRecord> {
    return unwrap(
      await this.client.storage.entityMessageGetMessage({ path: this.path }),
    );
  }

  /** A handle to a message by id. Fields load on first access. */
  static byId(
    client: MacroClient,
    channelId: string,
    id: string,
    mentions: SimpleMention[] = [],
  ): Message {
    return new Message(client, channelId, id, mentions);
  }

  /** Build a root or reply from a message record (pre-seeded, no fetch). */
  static from(
    client: MacroClient,
    channelId: string,
    data: MessageRecord,
  ): Message {
    return new Message(client, channelId, data.id, data.mentions, data);
  }

  /** The message body. */
  readonly content = this.field('content');

  /** When the message was created. */
  readonly createdAt = this.field('created_at');

  /** When the message was last edited, if it has been. */
  readonly editedAt = this.field('edited_at');

  /** When the message was last updated. */
  readonly updatedAt = this.field('updated_at');

  /** The user who sent this message. */
  async author(): Promise<User> {
    return User.byId(this.client, (await this.detail.get()).sender_id);
  }

  /** The channel this message is in. */
  channel(): Channel {
    return Channel.byId(this.client, this.channelId);
  }

  /** The thread rooted at this message. */
  thread(): Thread {
    return new Thread(this.client, this.channelId, this.id);
  }

  /** Add an emoji reaction to this message. */
  async react(emoji: string): Promise<this> {
    await this.mutate((c) =>
      c.storage.entityMessageReact({
        path: this.path,
        body: { add: true, emoji },
      }),
    );
    return this;
  }

  /** Remove one of your emoji reactions from this message. */
  async unreact(emoji: string): Promise<this> {
    await this.mutate((c) =>
      c.storage.entityMessageReact({
        path: this.path,
        body: { add: false, emoji },
      }),
    );
    return this;
  }

  /**
   * Replace this message's body.
   *
   * @param body - Plain text, or a rich body composed with {@link msg}.
   */
  async edit(body: string | RichMessage): Promise<this> {
    const { content, mentions } = toBody(body);
    await this.mutate((c) =>
      c.storage.entityMessageEdit({
        path: this.path,
        body: { content, mentions },
      }),
    );
    return this;
  }

  /** Delete this message. */
  async delete(): Promise<void> {
    await this.mutate((c) =>
      c.storage.entityMessageDeleteMessage({ path: this.path }),
    );
  }

  /** Post a reply in this message's thread. */
  async reply(body: string | RichMessage): Promise<Message> {
    return this.thread().reply(body);
  }
}
