import type {
  ActivityType,
  ChannelType,
  GetChannelAttachmentsResponses,
  GetChannelParticipantsResponses,
  GetChannelResponses,
  MessageCursor,
  MessageTimelineQuery,
} from '../../../generated/storage/types.gen';
import { type RichMessage, toBody } from '../../mentions';
import { paginate, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { AgentConversation } from '../agent-sessions/conversation';
import { Bot } from '../bots/bot';
import { CallRecord } from '../calls/call-record';
import { CallConnection, type JoinOptions } from '../calls/connection';
import { callAdmissionError } from '../calls/errors';
import type { Document } from '../documents/document';
import { PropertiedEntity } from '../entity';
import type { StaticImage } from '../images/image';
import {
  MessageThread,
  type TimelineOptions,
  timeline,
} from '../messages/thread';
import { entitySearch } from '../search/options';
import type { Team } from '../teams/team';
import type { User } from '../users/user';
import { ChannelAccessRequest } from './access-request';
import { ChannelActivity } from './activity';
import { Message } from './message';
import type { ChannelPicture } from './picture';
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
  /**
   * Start or join this channel's call, ringing members if a new call starts.
   *
   * @write
   * @mcp-exclude Returns a live call room credential; MCP calls carry JSON only.
   */
  async startCall(opts: JoinOptions = {}): Promise<CallConnection> {
    try {
      const response = unwrap(
        await this.client.storage.startCall({
          path: { channel_id: this.id },
          body: opts,
        }),
      );
      return new CallConnection(this.client, response);
    } catch (error) {
      return callAdmissionError(error);
    }
  }

  /**
   * Check the current call without creating one; undefined means no call.
   *
   * @readonly
   */
  async activeCall(): Promise<CallRecord | undefined> {
    const result = await this.client.storage.checkActiveCall({
      path: { channel_id: this.id },
    });
    if (result.response?.status === 204) return undefined;

    const response = unwrap(result);
    if (!response) return undefined;
    return CallRecord.byId(this.client, response.callId);
  }

  /**
   * Record a view or interaction in this channel.
   *
   * @write
   */
  async recordActivity(type: ActivityType): Promise<ChannelActivity> {
    return new ChannelActivity(
      this.client,
      this,
      unwrap(
        await this.client.storage.postActivity({
          body: { activity_type: type, channel_id: this.id },
        }),
      ),
    );
  }

  /**
   * Set an uploaded profile picture, or clear it.
   *
   * @write
   * @idempotent
   */
  async setPicture(picture?: ChannelPicture): Promise<void> {
    await this.mutate((c) =>
      c.storage.setChannelPicture({
        path: { channel_id: this.id },
        body: { profile_picture_id: picture?.id ?? null },
      }),
    );
  }

  /**
   * A shared message thread scoped to this resource.
   *
   * @readonly
   */
  messageThreadById(id: string): MessageThread {
    return MessageThread.byId(
      this.client,
      { type: 'channel', entity: this },
      id,
    );
  }

  /**
   * A mixed message and activity timeline page.
   *
   * @readonly
   */
  timelinePage(selection?: TimelineOptions<Message>) {
    return timeline(
      this.client,
      { type: 'channel', entity: this },
      (record) => Message.from(this.client, this.id, record),
      selection,
    );
  }

  /**
   * Conversations maintained by agents in this channel.
   *
   * @readonly
   */
  async agentConversations(): Promise<AgentConversation[]> {
    return unwrap(
      await this.client.agentHarness.listAgentConversations({
        path: { channel_id: this.id },
      }),
    ).conversations.map(
      (record) => new AgentConversation(this.client, this, record),
    );
  }

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

  /** Open (creating if needed) the group direct message with exactly these people, excluding the caller. */
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
   * `images` attaches static images, such as one from
   * `macro.images.generate()`, below the text; `documents` attaches Macro
   * documents as file chips, such as a file from `macro.documents.upload()`.
   *
   * Works with a channel webhook token as well as a normal one — see
   * {@link postToChannel} for which endpoint that picks and what it costs.
   * The webhook endpoint takes no attachments.
   *
   * @example Share a generated CSV.
   * ```js
   * const file = await macro.documents.upload({ name: 'q3.csv', content: csv });
   * await channel.send('Q3 numbers attached.', { documents: [file] });
   * ```
   *
   * @write
   */
  async send(
    body: string | RichMessage,
    opts?: {
      thread?: Thread;
      images?: StaticImage[];
      documents?: Document[];
    },
  ): Promise<Message> {
    const id = await postToChannel(
      this.client,
      opts?.thread ?? this,
      toBody(body),
      opts,
    );
    return Message.byId(this.client, this.id, id);
  }

  /**
   * Root messages in this channel, most recent first, auto-paginated.
   *
   * @readonly
   */
  messages(opts?: { pageSize?: number }): AsyncGenerator<Message> {
    return this.timeline({ limit: opts?.pageSize });
  }

  /**
   * Root messages created or replied to at or after `after`, most recent
   * first, auto-paginated. Use it to catch up after a disconnect.
   *
   * @readonly
   */
  messagesAfter(
    after: Date | string,
    opts?: { pageSize?: number },
  ): AsyncGenerator<Message> {
    return this.timeline({
      activity_after: after instanceof Date ? after.toISOString() : after,
      limit: opts?.pageSize,
    });
  }

  private timeline(
    selection: Omit<MessageTimelineQuery, 'cursor'>,
  ): AsyncGenerator<Message> {
    return paginate<Message, MessageCursor>(async (cursor) => {
      const page = unwrap(
        await this.client.storage.messageTimeline({
          path: { parent_type: 'channel', parent_id: this.id },
          query: { selection: JSON.stringify({ ...selection, cursor }) },
        }),
      );
      return {
        items: page.items.map((m) => Message.from(this.client, this.id, m)),
        nextCursor: page.next_cursor,
      };
    });
  }

  /**
   * A handle to a message in this channel by id.
   *
   * @readonly
   */
  message(id: string): Message {
    return Message.byId(this.client, this.id, id);
  }

  /**
   * Rename the channel.
   *
   * @write
   * @idempotent
   */
  async rename(name: string): Promise<void> {
    await this.mutate((c) =>
      c.storage.patchChannel({
        path: { channel_id: this.id },
        body: { channel_name: name },
      }),
    );
  }

  /**
   * Delete the channel. This is not reversible.
   *
   * @destructive
   * @idempotent
   */
  async delete(): Promise<void> {
    await this.mutate((c) =>
      c.storage.deleteChannel({ path: { channel_id: this.id } }),
    );
  }

  /**
   * Join the channel as the current user.
   *
   * @write
   * @idempotent
   */
  async join(): Promise<void> {
    await this.mutate((c) =>
      c.storage.joinChannel({ path: { channel_id: this.id } }),
    );
  }

  /**
   * A reusable code that lets a user join this channel.
   *
   * @readonly
   */
  async joinCode(): Promise<string> {
    const { join_code } = unwrap(
      await this.client.storage.getChannelJoinLink({
        path: { channel_id: this.id },
      }),
    );
    return join_code;
  }

  /**
   * Read the current user's join request, eligibility, and retry time.
   * Works without channel access. Denial or withdrawal may delay retries.
   *
   * @readonly
   */
  async myAccessRequest(): Promise<{
    request?: ChannelAccessRequest;
    canRequest: boolean;
    retryAfter?: string;
  }> {
    const state = unwrap(
      await this.client.storage.getMyChannelAccessRequest({
        path: { channel_id: this.id },
      }),
    );
    return {
      request: state.request
        ? ChannelAccessRequest.from(this.client, this, state.request)
        : undefined,
      canRequest: state.can_request,
      retryAfter: state.retry_after ?? undefined,
    };
  }

  /**
   * Ask to join a private or team channel.
   * Repeated calls return the pending request.
   *
   * @write
   * @idempotent
   */
  async requestAccess(): Promise<ChannelAccessRequest> {
    return ChannelAccessRequest.from(
      this.client,
      this,
      unwrap(
        await this.client.storage.requestChannelAccess({
          path: { channel_id: this.id },
        }),
      ),
    );
  }

  /**
   * Withdraw the current user's pending join request.
   *
   * @destructive
   * @idempotent
   */
  async cancelAccessRequest(): Promise<void> {
    unwrap(
      await this.client.storage.cancelChannelAccessRequest({
        path: { channel_id: this.id },
      }),
    );
  }

  /**
   * Leave the channel as the current user.
   *
   * @destructive
   * @idempotent
   */
  async leave(): Promise<void> {
    await this.mutate((c) =>
      c.storage.leaveChannel({ path: { channel_id: this.id } }),
    );
  }

  /**
   * The channel's members, with their roles and join times.
   *
   * @readonly
   */
  async participants(): Promise<ChannelParticipant[]> {
    return unwrap(
      await this.client.storage.getChannelParticipants({
        path: { channel_id: this.id },
      }),
    );
  }

  /**
   * Bots that can post to the channel.
   *
   * @readonly
   */
  async bots(): Promise<Bot[]> {
    return unwrap(
      await this.client.storage.listChannelBots({
        path: { channel_id: this.id },
      }),
    ).map((record) => Bot.from(this.client, record));
  }

  /**
   * Add users to the channel.
   *
   * @write
   * @idempotent
   */
  async addParticipants(users: User[]): Promise<void> {
    await this.mutate((c) =>
      c.storage.addParticipants({
        path: { channel_id: this.id },
        body: { participants: users.map((u) => u.id) },
      }),
    );
  }

  /**
   * Remove users from the channel.
   *
   * @destructive
   * @idempotent
   */
  async removeParticipants(users: User[]): Promise<void> {
    await this.mutate((c) =>
      c.storage.removeParticipants({
        path: { channel_id: this.id },
        body: { participants: users.map((u) => u.id) },
      }),
    );
  }

  /**
   * Broadcast a typing indicator, optionally scoped to a thread.
   *
   * @write
   * @idempotent
   */
  async typing(
    action: 'start' | 'stop',
    opts?: { thread?: Thread },
  ): Promise<void> {
    unwrap(
      await this.client.storage.entityMessageTyping({
        path: { parent_type: 'channel', parent_id: this.id },
        body: {
          active: action === 'start',
          thread_id: opts?.thread?.rootId ?? null,
        },
      }),
    );
  }

  /**
   * The attachments posted in this channel, auto-paginated.
   *
   * @readonly
   */
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

  /**
   * The channel's URL in the Macro web app.
   *
   * @readonly
   */
  webUrl(): string {
    return `${this.client.webAppUrl}/app/channel/${this.id}`;
  }

  /** Identity, loaded detail and {@link webUrl}, so serialized handles carry their link. */
  override toJSON() {
    return { ...super.toJSON(), url: this.webUrl() };
  }

  /** Search channels by content, most relevant first, auto-paginated. */
  static search = entitySearch({
    type: 'channel',
    make: (client, hit) => new Channel(client, hit.channel_id),
  });
}
