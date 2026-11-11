import { type RichMessage, toBody } from '../../mentions';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { Document } from '../documents/document';
import type { StaticImage } from '../images/image';
import { Channel } from './channel';
import { Message } from './message';
import { postToChannel } from './post';

/**
 * A thread within a channel, rooted at a top-level message. Replies and
 * thread-scoped posting live here.
 */
export class Thread {
  constructor(
    private readonly client: MacroClient,
    readonly channelId: string,
    /** The id of the message this thread hangs off. */
    readonly rootId: string,
  ) {}

  /** A handle to the thread under the message `rootId` in `channel`. */
  static byId(client: MacroClient, channel: Channel, rootId: string): Thread {
    return new Thread(client, channel.id, rootId);
  }

  /** Serialize the thread identity without its authenticated client. */
  toJSON(): { channelId: string; rootId: string } {
    return { channelId: this.channelId, rootId: this.rootId };
  }

  /**
   * The channel this thread is in.
   *
   * @readonly
   */
  channel(): Channel {
    return Channel.byId(this.client, this.channelId);
  }

  /**
   * The message this thread hangs off.
   *
   * @readonly
   */
  root(): Message {
    return Message.byId(this.client, this.channelId, this.rootId);
  }

  /**
   * List the replies in this thread, oldest first.
   *
   * @readonly
   */
  async replies(): Promise<Message[]> {
    const { replies } = unwrap(
      await this.client.storage.entityMessageGetThread({
        path: {
          parent_type: 'channel',
          parent_id: this.channelId,
          id: this.rootId,
        },
      }),
    );
    return replies.map((reply) =>
      Message.from(this.client, this.channelId, reply),
    );
  }

  /**
   * Post a reply in this thread.
   *
   * @param body - Plain text, or a rich body composed with {@link msg}.
   * @param opts.images - Static images to attach, such as one from
   *   `macro.images.generate()`.
   * @param opts.documents - Macro documents to attach as file chips, such as
   *   a file from `macro.documents.upload()`.
   * @returns The created reply.
   *
   * @write
   */
  async reply(
    body: string | RichMessage,
    opts?: { images?: StaticImage[]; documents?: Document[] },
  ): Promise<Message> {
    const id = await postToChannel(this.client, this, toBody(body), opts);
    return Message.byId(this.client, this.channelId, id);
  }
}
