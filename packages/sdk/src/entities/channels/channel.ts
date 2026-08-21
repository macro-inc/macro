import type {
  ChannelType,
  GetChannelAttachmentsResponses,
  GetChannelParticipantsResponses,
  GetChannelResponses,
  TypingAction,
} from '../../../generated/storage/types.gen';
import { type RichMessage, toBody } from '../../mentions';
import { paginate, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { PropertiedEntity } from '../entity';
import { entitySearch } from '../search';
import type { Team } from '../teams/team';
import type { User } from '../users/user';
import { Message } from './message';
import { postToChannel } from './post';
import type { Thread } from './thread';

type ChannelDetail = GetChannelResponses[200];

/** A member of a channel, with their role and join time. */
export type ChannelParticipant = GetChannelParticipantsResponses[200][number];

/** A file or entity attached to a message in a channel. */
export type ChannelAttachment =
  GetChannelAttachmentsResponses[200]['items'][number];

/**
 * A channel.
 */
export class Channel extends PropertiedEntity<ChannelDetail> {
  /** Favorites identify channels as `channel`. */
  readonly entityType = 'channel';

  /** The properties service identifies channels as `CHANNEL`. */
  protected readonly propertyEntityType = 'CHANNEL';

  protected async fetch(): Promise<ChannelDetail> {
    return unwrap(
      await this.client.storage.getChannel({ path: { channel_id: this.id } }),
    );
  }

  /** A handle to a channel by id. Details load on first access. */
  static byId(client: MacroClient, id: string): Channel {
    return new Channel(client, id);
  }

  /** Open (creating if needed) the DM channel with a user. */
  static async dm(client: MacroClient, recipient: User): Promise<Channel> {
    const { channel_id } = unwrap(
      await client.storage.getOrCreateDm({
        body: { recipient_id: recipient.id },
      }),
    );
    return new Channel(client, channel_id);
  }

  /** Open (creating if needed) the private group channel with a set of users. */
  static async private(
    client: MacroClient,
    recipients: User[],
  ): Promise<Channel> {
    const { channel_id } = unwrap(
      await client.storage.getOrCreatePrivate({
        body: { recipients: recipients.map((u) => u.id) },
      }),
    );
    return new Channel(client, channel_id);
  }

  /** Create a channel. The caller becomes the owner. */
  static async create(
    client: MacroClient,
    opts: {
      type: ChannelType;
      name?: string;
      /** Participants to add, excluding the owner. */
      participants?: User[];
      /** Team, for team channels. */
      team?: Team;
    },
  ): Promise<Channel> {
    const { id } = unwrap(
      await client.storage.createChannel({
        body: {
          channel_type: opts.type,
          name: opts.name ?? null,
          participants: (opts.participants ?? []).map((u) => u.id),
          team_id: opts.team?.id ?? null,
        },
      }),
    );
    return new Channel(client, id);
  }

  /** The channel's display name, resolved from the viewer's perspective. */
  readonly name = this.field('channel_name');

  /** The channel's type (e.g. `public`, `dm`, `private`). */
  readonly type = this.field('channel_type');

  /**
   * Post a message. Plain text, or a rich body composed with `msg`.
   *
   * Works with a channel webhook token as well as a normal one — see
   * {@link postToChannel} for which endpoint that picks and what it costs.
   */
  async send(
    body: string | RichMessage,
    opts?: { thread?: Thread },
  ): Promise<Message> {
    const id = await postToChannel(
      this.client,
      opts?.thread ?? this,
      toBody(body),
    );
    return Message.byId(this.client, this.id, id);
  }

  /** The messages in this channel, most recent first, auto-paginated. */
  messages(opts?: { pageSize?: number }): AsyncGenerator<Message> {
    return paginate(async (cursor) => {
      const page = unwrap(
        await this.client.storage.getChannelMessages({
          path: { channel_id: this.id },
          query: {
            ...(opts?.pageSize ? { limit: opts.pageSize } : {}),
            ...(cursor ? { cursor } : {}),
          },
        }),
      );
      return {
        items: page.items.map((m) => Message.from(this.client, m)),
        nextCursor: page.next_cursor,
      };
    });
  }

  /** A handle to a message in this channel by id. */
  message(id: string): Message {
    return Message.byId(this.client, this.id, id);
  }

  /** Rename the channel. */
  async rename(name: string): Promise<void> {
    await this.mutate((c) =>
      c.storage.patchChannel({
        path: { channel_id: this.id },
        body: { channel_name: name },
      }),
    );
  }

  /** Delete the channel. This is not reversible. */
  async delete(): Promise<void> {
    await this.mutate((c) =>
      c.storage.deleteChannel({ path: { channel_id: this.id } }),
    );
  }

  /** Join the channel as the current user. */
  async join(): Promise<void> {
    await this.mutate((c) =>
      c.storage.joinChannel({ path: { channel_id: this.id } }),
    );
  }

  /** A reusable code that lets a user join this channel. */
  async joinCode(): Promise<string> {
    const { join_code } = unwrap(
      await this.client.storage.getChannelJoinLink({
        path: { channel_id: this.id },
      }),
    );
    return join_code;
  }

  /** Leave the channel as the current user. */
  async leave(): Promise<void> {
    await this.mutate((c) =>
      c.storage.leaveChannel({ path: { channel_id: this.id } }),
    );
  }

  /** The channel's members, with their roles and join times. */
  async participants(): Promise<ChannelParticipant[]> {
    return unwrap(
      await this.client.storage.getChannelParticipants({
        path: { channel_id: this.id },
      }),
    );
  }

  /** Add users to the channel. */
  async addParticipants(users: User[]): Promise<void> {
    await this.mutate((c) =>
      c.storage.addParticipants({
        path: { channel_id: this.id },
        body: { participants: users.map((u) => u.id) },
      }),
    );
  }

  /** Remove users from the channel. */
  async removeParticipants(users: User[]): Promise<void> {
    await this.mutate((c) =>
      c.storage.removeParticipants({
        path: { channel_id: this.id },
        body: { participants: users.map((u) => u.id) },
      }),
    );
  }

  /** Broadcast a typing indicator, optionally scoped to a thread. */
  async typing(
    action: TypingAction,
    opts?: { thread?: Thread },
  ): Promise<void> {
    unwrap(
      await this.client.storage.postTyping({
        path: { channel_id: this.id },
        body: { action, thread_id: opts?.thread?.rootId ?? null },
      }),
    );
  }

  /** The attachments posted in this channel, auto-paginated. */
  attachments(opts?: {
    pageSize?: number;
    /** Filter by type: `static` for images/videos, `dss` for documents. */
    type?: string;
  }): AsyncGenerator<ChannelAttachment> {
    return paginate(async (cursor) => {
      const page = unwrap(
        await this.client.storage.getChannelAttachments({
          path: { channel_id: this.id },
          query: {
            ...(opts?.pageSize ? { limit: opts.pageSize } : {}),
            ...(opts?.type ? { attachment_type: opts.type } : {}),
            ...(cursor ? { cursor } : {}),
          },
        }),
      );
      return { items: page.items, nextCursor: page.next_cursor };
    });
  }

  /** The channel's URL in the Macro web app. */
  webUrl(): string {
    return `${this.client.webAppUrl}/app/channel/${this.id}`;
  }

  /** Search channels by content, most relevant first, auto-paginated. */
  static search = entitySearch({
    type: 'channel',
    make: (client, hit) => new Channel(client, hit.channel_id),
  });
}
