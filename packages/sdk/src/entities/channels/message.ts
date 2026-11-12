import type {
  Message as MessageRecord,
  MessageTimelineQuery,
} from '../../../generated/storage/types.gen';
import { type RichMessage, type SimpleMention, toBody } from '../../mentions';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { FavoritableEntity } from '../entity';
import { User } from '../users/user';
import { Channel } from './channel';
import { Thread } from './thread';

/** The API's representation of a message; the same record the document comment API returns. */
export type MessageData = MessageRecord;

/** How much surrounds a message in {@link Message.context}. */
export interface MessageContextOptions {
  /** Top-level messages before the root, roughly; defaults to 3, at most 25. */
  channelBefore?: number;
  /** Top-level messages after the root, roughly; defaults to 3, at most 25. */
  channelAfter?: number;
  /** For a reply, replies before it; defaults to 10, at most 50. */
  threadBefore?: number;
  /** For a reply, replies after it; defaults to 10, at most 50. */
  threadAfter?: number;
}

/** The replies around a reply, in {@link MessageContext}. */
export interface ReplyContext {
  /** Replies before the message, oldest first. */
  before: Message[];
  /** Replies after the message, oldest first. */
  after: Message[];
  /** Earlier replies left out. */
  omittedBefore: number;
  /** Later replies left out. */
  omittedAfter: number;
}

/** A channel message with the conversation around it. */
export interface MessageContext {
  /** The message asked about. */
  message: Message;
  /** Its top-level message: the message itself, or the root of the thread it replies in. */
  root: Message;
  /** Top-level messages before `root`, oldest first. */
  before: Message[];
  /** Top-level messages after `root`, oldest first. */
  after: Message[];
  /** For a reply, the replies around it; absent for a top-level message. */
  thread?: ReplyContext;
}

const CONTEXT_CHANNEL_DEFAULT = 3;
const CONTEXT_CHANNEL_MAX = 25;
const CONTEXT_THREAD_DEFAULT = 10;
const CONTEXT_THREAD_MAX = 50;

function contextCount(
  value: number | undefined,
  fallback: number,
  max: number,
): number {
  const count =
    value !== undefined && Number.isFinite(value) ? value : fallback;
  return Math.min(Math.max(Math.trunc(count), 0), max);
}

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

  /**
   * The user who sent this message.
   *
   * @readonly
   */
  async author(): Promise<User> {
    return User.byId(this.client, (await this.detail.get()).sender_id);
  }

  /**
   * The message's URL in the Macro web app: its channel, scrolled to it. Pass
   * the message to `macro.ui.open` to show it to the user.
   *
   * @readonly
   */
  webUrl(): string {
    const query = new URLSearchParams({ channel_message_id: this.id });
    return `${this.client.webAppUrl}/app/channel/${this.channelId}?${query}`;
  }

  /** Identity, loaded detail and {@link webUrl}, so serialized handles carry their link. */
  override toJSON() {
    return { ...super.toJSON(), url: this.webUrl() };
  }

  /**
   * The channel this message is in.
   *
   * @readonly
   */
  channel(): Channel {
    return Channel.byId(this.client, this.channelId);
  }

  /**
   * The thread rooted at this message.
   *
   * @readonly
   */
  thread(): Thread {
    return new Thread(this.client, this.channelId, this.id);
  }

  /**
   * The conversation around this message: nearby top-level messages and, when
   * it is a thread reply, its thread's root and the replies around it. Use it
   * to read what a message (from a mention, search hit or notification)
   * answers before acting on it.
   *
   * @readonly
   */
  async context(options: MessageContextOptions = {}): Promise<MessageContext> {
    const channelBefore = contextCount(
      options.channelBefore,
      CONTEXT_CHANNEL_DEFAULT,
      CONTEXT_CHANNEL_MAX,
    );
    const channelAfter = contextCount(
      options.channelAfter,
      CONTEXT_CHANNEL_DEFAULT,
      CONTEXT_CHANNEL_MAX,
    );
    const record = await this.detail.get();
    const rootId = record.thread_id ?? this.id;
    const page = unwrap(
      await this.client.storage.messageTimeline({
        path: { parent_type: 'channel', parent_id: this.channelId },
        query: {
          selection: JSON.stringify({
            around: this.id,
            limit: channelBefore + channelAfter + 1,
          } satisfies MessageTimelineQuery),
        },
      }),
    );
    // The timeline is newest first; context reads oldest first.
    const roots = page.items
      .map((item) => Message.from(this.client, this.channelId, item))
      .reverse();
    const rootIndex = roots.findIndex((m) => m.id === rootId);
    if (rootIndex < 0)
      throw new Error('The timeline around this message did not include it');
    const root = roots[rootIndex] as Message;
    const context: MessageContext = {
      message: this,
      root,
      before: roots.slice(0, rootIndex),
      after: roots.slice(rootIndex + 1),
    };
    if (!record.thread_id) return context;
    const replies = await root.thread().replies();
    const index = replies.findIndex((m) => m.id === this.id);
    if (index < 0) throw new Error('This reply was not found in its thread');
    const start =
      index -
      Math.min(
        index,
        contextCount(
          options.threadBefore,
          CONTEXT_THREAD_DEFAULT,
          CONTEXT_THREAD_MAX,
        ),
      );
    const end = Math.min(
      replies.length,
      index +
        1 +
        contextCount(
          options.threadAfter,
          CONTEXT_THREAD_DEFAULT,
          CONTEXT_THREAD_MAX,
        ),
    );
    return {
      ...context,
      thread: {
        before: replies.slice(start, index),
        after: replies.slice(index + 1, end),
        omittedBefore: start,
        omittedAfter: replies.length - end,
      },
    };
  }

  /**
   * Add an emoji reaction to this message.
   *
   * @write
   * @idempotent
   */
  async react(emoji: string): Promise<this> {
    await this.mutate((c) =>
      c.storage.entityMessageReact({
        path: this.path,
        body: { add: true, emoji },
      }),
    );
    return this;
  }

  /**
   * Remove one of your emoji reactions from this message.
   *
   * @write
   * @idempotent
   */
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
   *
   * @destructive
   * @idempotent
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

  /**
   * Delete this message.
   *
   * @destructive
   * @idempotent
   */
  async delete(): Promise<void> {
    await this.mutate((c) =>
      c.storage.entityMessageDeleteMessage({ path: this.path }),
    );
  }

  /**
   * Post a reply in this message's thread.
   *
   * @write
   */
  async reply(body: string | RichMessage): Promise<Message> {
    return this.thread().reply(body);
  }
}
