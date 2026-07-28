import type {
  GetChannelMessagesResponses,
  GetMessageWithContextResponses,
  GetThreadRepliesResponses,
} from '../../../generated/storage/types.gen';
import type { RichMessage, SimpleMention } from '../../mentions';
import { MacroNotFoundError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { FavoritableEntity } from '../entity';
import { User } from '../users/user';
import { Channel } from './channel';
import { Thread } from './thread';

type ChannelMessage = GetChannelMessagesResponses[200]['items'][number];
type ThreadReply = GetThreadRepliesResponses[200][number];
type ContextMessage = GetMessageWithContextResponses[200]['messages'][number];

/** The API's representation of a channel message, in any of the forms it's returned. */
export type MessageData = ChannelMessage | ThreadReply | ContextMessage;

/**
 * A message in a channel. A thin handle: `id` and `channelId` are known up
 * front, and record-backed fields (`content`, `author`) load lazily on first
 * access and cache. Actions carry the ids for you.
 */
export class Message extends FavoritableEntity<MessageData> {
  /** Favorites identify channel messages as `channel_message`. */
  readonly entityType = 'channel_message';

  private constructor(
    client: MacroClient,
    readonly channelId: string,
    id: string,
    /** Entities mentioned in this message. Populated for event-delivered
     * messages; empty otherwise, since the REST API doesn't return mentions inline. */
    readonly mentions: SimpleMention[] = [],
    seed?: MessageData,
  ) {
    super(client, id, seed);
  }

  protected async fetch(): Promise<MessageData> {
    const { messages } = unwrap(
      await this.client.storage.getMessageWithContext({
        path: { channel_id: this.channelId, message_id: this.id },
      }),
    );
    const target = messages.find((m) => m.id === this.id);
    if (!target) throw new MacroNotFoundError(`message ${this.id} not found`);
    return target;
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

  /** Build a message from a list-endpoint record (pre-seeded, no fetch). */
  static from(
    client: MacroClient,
    data: ChannelMessage,
    mentions: SimpleMention[] = [],
  ): Message {
    return new Message(client, data.channel_id, data.id, mentions, data);
  }

  /** Build a message from a thread-reply record (pre-seeded, no fetch). */
  static fromReply(
    client: MacroClient,
    channelId: string,
    reply: ThreadReply,
    mentions: SimpleMention[] = [],
  ): Message {
    return new Message(client, channelId, reply.id, mentions, reply);
  }

  /** Build a message from a webhook event record (pre-seeded, no fetch). */
  static received(
    client: MacroClient,
    channelId: string,
    data: MessageData,
    mentions: SimpleMention[] = [],
  ): Message {
    return new Message(client, channelId, data.id, mentions, data);
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
      c.storage.postReaction({
        path: { channel_id: this.channelId },
        body: { action: 'Add', emoji, message_id: this.id },
      }),
    );
    return this;
  }

  /** Remove one of your emoji reactions from this message. */
  async unreact(emoji: string): Promise<this> {
    await this.mutate((c) =>
      c.storage.postReaction({
        path: { channel_id: this.channelId },
        body: { action: 'Remove', emoji, message_id: this.id },
      }),
    );
    return this;
  }

  /** Replace this message's body. */
  async edit(content: string): Promise<this> {
    await this.mutate((c) =>
      c.storage.patchMessage({
        path: { channel_id: this.channelId, message_id: this.id },
        body: { content },
      }),
    );
    return this;
  }

  /** Delete this message. */
  async delete(): Promise<void> {
    await this.mutate((c) =>
      c.storage.deleteMessage({
        path: { channel_id: this.channelId, message_id: this.id },
      }),
    );
  }

  /** Post a reply in this message's thread. */
  async reply(body: string | RichMessage): Promise<Message> {
    return this.thread().reply(body);
  }
}
