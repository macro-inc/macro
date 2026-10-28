import { match } from 'ts-pattern';
import type {
  LinkedReplyContent,
  UpdateSharePermissionRequestV2,
  WhatsAppGroupDetail,
} from '../../../generated/storage/types.gen';
import { paginate, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { FavoritableEntity } from '../entity';
import { User } from '../users/user';
import { communityOf } from './chat';
import { WhatsAppMessage } from './message';
import { WhatsAppParticipant } from './participant';
import { WhatsAppSend } from './send';
import { WhatsAppUpload } from './upload';

/** Deliberate content from the credential owner's own WhatsApp account. */
export type WhatsAppReply =
  | {
      type: 'text';
      text: string;
      /** Participants mentioned (from `participants()`); the text names each as `@<mentionToken>`. */
      mentions?: WhatsAppParticipant[];
    }
  | { type: 'media'; upload: WhatsAppUpload; caption?: string }
  | {
      type: 'mutation';
      message: WhatsAppMessage;
      operation: 'reaction' | 'edit' | 'delete';
      text?: string;
    };

/** Independently shareable added WhatsApp chat: a group or a direct chat. */
export class WhatsAppGroup extends FavoritableEntity<WhatsAppGroupDetail> {
  /** Canonical sharing and favorites kind. */
  readonly entityType = 'whatsapp_group' as const;

  /** Reference an adopted group; access is checked on each request. */
  static byId(client: MacroClient, id: string): WhatsAppGroup {
    return new WhatsAppGroup(client, id);
  }

  protected async fetch(): Promise<WhatsAppGroupDetail> {
    return unwrap(
      await this.client.storage.whatsappGroup({ path: { group_id: this.id } }),
    );
  }

  /** Display name: the group's, or a direct chat's other person. */
  readonly name = this.field('name');
  /** `group`, or `direct` for a one-to-one chat (only its owner sends). */
  readonly kind = this.field('kind');
  /** Whether the caller can send from their own connected account. */
  readonly canSend = this.field('canSend');
  /** Reason sending is blocked. */
  readonly sendReason = this.field('sendReason');
  /** Caller's own verified sending identity. */
  readonly sendingIdentity = this.field('sendingIdentity');
  /** Per-user unread count. */
  readonly unreadCount = this.field('unreadCount');
  /** Importing earlier messages from the owner's phone after adding, if any. */
  readonly backfill = this.field('backfill');
  /** Supported sizes and mutation window. */
  readonly limits = this.field('limits');
  /** Current remote roster (name, participants, announce), when available. */
  readonly roster = this.field('roster');
  /** Everyone in the chat, from its roster; empty when no roster is known. */
  readonly participants = this.mappedField('roster', (roster) =>
    (roster?.participants ?? []).map((record) =>
      WhatsAppParticipant.from(this, record),
    ),
  );
  /** WhatsApp's disappearing-messages timer in seconds while on; Macro keeps the messages. */
  readonly disappearingSeconds = this.field('disappearingSeconds');
  /** The WhatsApp community this group belongs to, if any: the community's own chat, its name, and whether this is its announcement group. */
  readonly community = this.mappedField('community', (record) =>
    record ? communityOf(this.client, record) : undefined,
  );
  /** Actual owner, independent of WhatsApp membership. */
  readonly owner = this.mappedField('userId', (id) =>
    User.byId(this.client, id),
  );

  /** Iterate newest-first timeline pages lazily. */
  async *messages(
    options: { limit?: number } = {},
  ): AsyncGenerator<WhatsAppMessage> {
    yield* paginate(async (before) => {
      const page = unwrap(
        await this.client.storage.whatsappGroupMessages({
          path: { group_id: this.id },
          query: { before, limit: options.limit },
        }),
      );
      return {
        items: page.messages.map((message) =>
          WhatsAppMessage.from(this.client, this, message),
        ),
        nextCursor: page.nextCursor,
      };
    });
  }

  /** Advance the caller's own read cursor. */
  async markRead(message: WhatsAppMessage): Promise<void> {
    this.assertGroup(message.group);
    await this.mutate((client) =>
      client.storage.whatsappGroupRead({
        path: { group_id: this.id },
        body: { messageId: message.id },
      }),
    );
  }

  /** Read standard link/team sharing settings. */
  async permissions() {
    return unwrap(
      await this.client.storage.whatsappGroupPermissions({
        path: { group_id: this.id },
      }),
    );
  }

  /** Actual owner updates standard link/team sharing settings. */
  async updatePermissions(
    update: UpdateSharePermissionRequestV2,
  ): Promise<void> {
    await this.mutate((client) =>
      client.storage.whatsappGroupUpdatePermissions({
        path: { group_id: this.id },
        body: update,
      }),
    );
  }

  /** Stop observation while preserving history and established sharing. */
  async detach(): Promise<void> {
    await this.mutate((client) =>
      client.storage.linkedDetach({ path: { group_id: this.id } }),
    );
  }

  /** Stage a supported attachment for a deliberate send. */
  async upload(file: Blob | File): Promise<WhatsAppUpload> {
    const record = unwrap(
      await this.client.storage.linkedUpload({
        path: { group_id: this.id },
        body: { file },
      }),
    );
    return WhatsAppUpload.from(this, record);
  }

  /** Personal sessions and owner API credentials can send. Bots never send.
   * Preserve the idempotency key; uncertain outcomes are never automatically resent.
   * The server enforces one request per second per user.
   */
  async reply(
    content: WhatsAppReply,
    options: { idempotencyKey: string; replyTo?: WhatsAppMessage },
  ): Promise<WhatsAppSend> {
    if (options.replyTo) this.assertGroup(options.replyTo.group);
    const message = match(content)
      .returnType<LinkedReplyContent>()
      .with({ type: 'text' }, (value) => {
        const mentions = value.mentions ?? [];
        for (const participant of mentions) this.assertGroup(participant.group);
        return {
          type: 'text',
          text: value.text,
          mentions: mentions.map((participant) => participant.id),
        };
      })
      .with({ type: 'media' }, (value) => {
        this.assertGroup(value.upload.group);
        return {
          type: 'media',
          uploadId: value.upload.id,
          caption: value.caption,
        };
      })
      .with({ type: 'mutation' }, (value) => {
        this.assertGroup(value.message.group);
        return {
          type: 'mutation',
          messageId: value.message.id,
          operation: value.operation,
          text: value.text,
        };
      })
      .exhaustive();
    const record = await this.mutate((client) =>
      client.storage.linkedReply({
        path: { group_id: this.id },
        body: {
          idempotencyKey: options.idempotencyKey,
          message,
          replyTo: options.replyTo?.id,
        },
      }),
    );
    return WhatsAppSend.from(this.client, this, record);
  }

  /** Read only the caller's pending, uncertain or failed sends. */
  async sends(): Promise<WhatsAppSend[]> {
    return unwrap(
      await this.client.storage.whatsappGroupSends({
        path: { group_id: this.id },
      }),
    ).map((record) => WhatsAppSend.from(this.client, this, record));
  }

  /** Read delivery for selected caller-owned intents or messages. */
  async delivery(
    sends: Array<WhatsAppSend | WhatsAppMessage>,
  ): Promise<WhatsAppSend[]> {
    for (const send of sends) this.assertGroup(send.group);
    return unwrap(
      await this.client.storage.linkedDelivery({
        path: { group_id: this.id },
        body: sends.map((send) => send.id),
      }),
    ).map((record) => WhatsAppSend.from(this.client, this, record));
  }

  /** Read attachment states for selected messages. */
  async messageAttachments(messages: WhatsAppMessage[]) {
    for (const message of messages) this.assertGroup(message.group);
    return unwrap(
      await this.client.storage.linkedMessageAttachments({
        path: { group_id: this.id },
        body: messages.map((message) => message.id),
      }),
    ).map((record) => ({
      message: WhatsAppMessage.byId(this.client, this, record.messageId),
      attachments: record.linkedAttachments.map((attachment) => ({
        ordinal: attachment.ordinal,
        state: attachment.state,
        fileName: attachment.fileName,
        mime: attachment.mime,
        size: attachment.size,
        url: attachment.fileId
          ? `${this.client.hosts['static-files']}/file/${attachment.fileId}`
          : undefined,
      })),
    }));
  }

  /** Reload detail, permissions and caller capabilities. */
  async refresh(): Promise<this> {
    this.detail.clear();
    await this.detail.get();
    return this;
  }

  private assertGroup(group: WhatsAppGroup): void {
    if (group.id !== this.id)
      throw new Error('WhatsApp reference belongs to another group');
  }
}
