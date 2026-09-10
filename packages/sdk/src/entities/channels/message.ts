import type { Message as MessageRecord } from '../../../generated/storage/types.gen';
import { type RichMessage, type SimpleMention, toBody } from '../../mentions';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { FavoritableEntity } from '../entity';
import { User } from '../users/user';
import { Channel } from './channel';
import { Thread } from './thread';

/**
 * A message in a channel. A thin handle: `id` and `channelId` are known up
 * front, and record-backed fields (`content`, `author`) load lazily on first
 * access and cache. Actions carry the ids for you.
 */
export class Message extends FavoritableEntity<MessageRecord> {
  /** Favorites identify channel messages as `channel_message`. */
  readonly entityType = 'channel_message';

  private constructor(
    client: MacroClient,
    readonly channelId: string,
    id: string,
    /** Entities mentioned in this message, when supplied by a list or event. */
    readonly mentions: SimpleMention[] = [],
    seed?: MessageRecord,
  ) {
    super(client, id, seed);
  }

  protected async fetch(): Promise<MessageRecord> {
    return unwrap(
      await this.client.storage.entityMessageGetMessage({
        path: {
          parent_type: 'channel',
          parent_id: this.channelId,
          id: this.id,
        },
      }),
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

  /** Build a root or reply from the shared message record (no fetch). */
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
        path: {
          parent_type: 'channel',
          parent_id: this.channelId,
          id: this.id,
        },
        body: { add: true, emoji },
      }),
    );
    return this;
  }

  /** Remove one of your emoji reactions from this message. */
  async unreact(emoji: string): Promise<this> {
    await this.mutate((c) =>
      c.storage.entityMessageReact({
        path: {
          parent_type: 'channel',
          parent_id: this.channelId,
          id: this.id,
        },
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
        path: {
          parent_type: 'channel',
          parent_id: this.channelId,
          id: this.id,
        },
        body: { content, mentions },
      }),
    );
    return this;
  }

  /** Delete this message. */
  async delete(): Promise<void> {
    await this.mutate((c) =>
      c.storage.entityMessageDeleteMessage({
        path: {
          parent_type: 'channel',
          parent_id: this.channelId,
          id: this.id,
        },
      }),
    );
  }

  /** Post a reply in this message's thread. */
  async reply(body: string | RichMessage): Promise<Message> {
    return this.thread().reply(body);
  }
}
