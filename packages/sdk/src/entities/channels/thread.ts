import { type RichMessage, toBody } from '../../mentions';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
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

  /** The channel this thread is in. */
  channel(): Channel {
    return Channel.byId(this.client, this.channelId);
  }

  /** The message this thread hangs off. */
  root(): Message {
    return Message.byId(this.client, this.channelId, this.rootId);
  }

  /** List the replies in this thread, oldest first. */
  async replies(): Promise<Message[]> {
    const replies = unwrap(
      await this.client.storage.getThreadReplies({
        path: { channel_id: this.channelId, message_id: this.rootId },
      }),
    );
    return replies.map((reply) =>
      Message.fromReply(this.client, this.channelId, reply),
    );
  }

  /**
   * Post a reply in this thread.
   *
   * @param body - Plain text, or a rich body composed with {@link msg}.
   * @returns The created reply.
   */
  async reply(body: string | RichMessage): Promise<Message> {
    const id = await postToChannel(this.client, this, toBody(body));
    return Message.byId(this.client, this.channelId, id);
  }
}
