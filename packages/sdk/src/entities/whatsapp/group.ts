import { match } from 'ts-pattern';
import type {
  LinkedReplyContent,
  UpdateSharePermissionRequestV2,
  WhatsAppGroupDetail,
} from '../../../generated/storage/types.gen';
import { paginate, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { Document } from '../documents/document';
import { FavoritableEntity } from '../entity';
import { User } from '../users/user';
import { WhatsAppMessage } from './message';
import { WhatsAppSend } from './send';
import { WhatsAppUpload } from './upload';

/** Deliberate content from the credential owner's own WhatsApp account. */
export type WhatsAppReply =
  | {
      type: 'text';
      text: string;
      /** WhatsApp ids of mentioned participants (`roster.participants[].jid`); the text names each as `@<digits>`. */
      mentions?: string[];
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
  readonly canSend = this.field('can_send');
  /** Reason sending is blocked. */
  readonly sendReason = this.field('send_reason');
  /** Caller's own verified sending identity. */
  readonly sendingIdentity = this.field('sending_identity');
  /** Per-user unread count. */
  readonly unreadCount = this.field('unread_count');
  /** Importing earlier messages from the owner's phone after adding, if any. */
  readonly backfill = this.field('backfill');
  /** Supported sizes and mutation window. */
  readonly limits = this.field('limits');
  /** Current remote roster, when available. */
  readonly roster = this.field('roster');
  /** WhatsApp's disappearing-messages timer in seconds while on; Macro keeps the messages. */
  readonly disappearingSeconds = this.field('disappearing_seconds');
  /** The WhatsApp community this group belongs to (`{ id, name, announcements }`), if any. */
  readonly community = this.field('community');
  /** Actual owner, independent of WhatsApp membership. */
  readonly owner = this.mappedField('user_id', (id) =>
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
        nextCursor: page.next_cursor,
      };
    });
  }

  /** Advance the caller's own read cursor. */
  async markRead(message: WhatsAppMessage): Promise<void> {
    this.assertGroup(message.groupId);
    await this.mutate((client) =>
      client.storage.whatsappGroupRead({
        path: { group_id: this.id },
        body: { message_id: message.id },
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
    if (options.replyTo) this.assertGroup(options.replyTo.groupId);
    const message = match(content)
      .returnType<LinkedReplyContent>()
      .with({ type: 'text' }, (value) => ({
        type: 'text',
        text: value.text,
        mentions: value.mentions ?? [],
      }))
      .with({ type: 'media' }, (value) => {
        this.assertGroup(value.upload.groupId);
        return {
          type: 'media',
          upload_id: value.upload.id,
          caption: value.caption,
        };
      })
      .with({ type: 'mutation' }, (value) => {
        this.assertGroup(value.message.groupId);
        return {
          type: 'mutation',
          message_id: value.message.id,
          operation: value.operation,
          text: value.text,
        };
      })
      .exhaustive();
    const record = await this.mutate((client) =>
      client.storage.linkedReply({
        path: { group_id: this.id },
        body: {
          idempotency_key: options.idempotencyKey,
          message,
          reply_to: options.replyTo?.id,
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
    for (const send of sends)
      this.assertGroup(
        send instanceof WhatsAppSend ? send.group.id : send.groupId,
      );
    return unwrap(
      await this.client.storage.linkedDelivery({
        path: { group_id: this.id },
        body: sends.map((send) => send.id),
      }),
    ).map((record) => WhatsAppSend.from(this.client, this, record));
  }

  /** Read attachment states for selected messages. */
  async messageAttachments(messages: WhatsAppMessage[]) {
    for (const message of messages) this.assertGroup(message.groupId);
    return unwrap(
      await this.client.storage.linkedMessageAttachments({
        path: { group_id: this.id },
        body: messages.map((message) => message.id),
      }),
    ).map((record) => ({
      message: WhatsAppMessage.byId(this.client, this, record.message_id),
      attachments: record.linked_attachments.map((attachment) => ({
        ordinal: attachment.ordinal,
        state: attachment.state,
        fileName: attachment.file_name,
        mime: attachment.mime,
        size: attachment.size,
        document: attachment.document_id
          ? Document.byId(this.client, attachment.document_id)
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

  private assertGroup(groupId: string): void {
    if (groupId !== this.id)
      throw new Error('WhatsApp reference belongs to another group');
  }
}
