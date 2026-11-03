import { match } from 'ts-pattern';
import type {
  ExternalChatDetail,
  ExternalChatReplyContent,
  UpdateSharePermissionRequestV2,
} from '../../../generated/storage/types.gen';
import { paginate, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { FavoritableEntity } from '../entity';
import { User } from '../users/user';
import { communityOf, type WhatsAppCommunity } from '../whatsapp/chat';
import { ExternalChatMessage } from './message';
import { ExternalChatParticipant } from './participant';
import { ExternalChatSend } from './send';
import { ExternalChatUpload } from './upload';

/** Deliberate content sent from the credential owner's own provider account. */
export type ExternalChatContent =
  | {
      type: 'text';
      text: string;
      /** Participants mentioned (from `participants()`); the text names each as `@<mentionToken>`. */
      mentions?: ExternalChatParticipant[];
    }
  | { type: 'media'; upload: ExternalChatUpload; caption?: string }
  | {
      type: 'mutation';
      message: ExternalChatMessage;
      operation: 'reaction' | 'edit' | 'delete';
      text?: string;
    };

/**
 * A chat from an external messaging provider (WhatsApp today), added to Macro
 * by its owner and shareable like any other entity: a group or a direct chat.
 */
export class ExternalChat extends FavoritableEntity<ExternalChatDetail> {
  /** Canonical sharing and favorites kind. */
  readonly entityType = 'external_chat' as const;

  /** Reference an added chat; access is checked on each request. */
  static byId(client: MacroClient, id: string): ExternalChat {
    return new ExternalChat(client, id);
  }

  protected async fetch(): Promise<ExternalChatDetail> {
    return unwrap(
      await this.client.storage.externalChat({ path: { chat_id: this.id } }),
    );
  }

  /** The messaging provider the chat lives in, such as `whatsapp`. */
  readonly provider = this.field('provider');
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
  /** Current remote members (name, participants, announce), when known. */
  readonly members = this.field('members');
  /** Everyone in the chat, from its members; empty when none are known. */
  readonly participants = this.mappedField('members', (members) =>
    (members?.participants ?? []).map((record) =>
      ExternalChatParticipant.from(this, record),
    ),
  );
  /** The provider's disappearing-messages timer in seconds while on; Macro keeps the messages. */
  readonly disappearingSeconds = this.field('disappearingSeconds');
  /** Actual owner, independent of provider membership. */
  readonly owner = this.mappedField('userId', (id) =>
    User.byId(this.client, id),
  );

  /** The community a group belongs to, if any: the community's own provider chat, its name, and whether this is its announcement group. */
  async community(): Promise<WhatsAppCommunity | undefined> {
    const { provider, community } = await this.detail.get();
    if (!community) return undefined;
    return match(provider)
      .with('whatsapp', () => communityOf(this.client, community))
      .exhaustive();
  }

  /** Iterate newest-first timeline pages lazily. */
  async *messages(
    options: { limit?: number } = {},
  ): AsyncGenerator<ExternalChatMessage> {
    yield* paginate(async (before) => {
      const page = unwrap(
        await this.client.storage.externalChatMessages({
          path: { chat_id: this.id },
          query: { before, limit: options.limit },
        }),
      );
      return {
        items: page.messages.map((message) =>
          ExternalChatMessage.from(this.client, this, message),
        ),
        nextCursor: page.nextCursor,
      };
    });
  }

  /** Advance the caller's own read cursor. */
  async markRead(message: ExternalChatMessage): Promise<void> {
    this.assertChat(message.chat);
    await this.mutate((client) =>
      client.storage.externalChatRead({
        path: { chat_id: this.id },
        body: { messageId: message.id },
      }),
    );
  }

  /** Read standard link/team sharing settings. */
  async permissions() {
    return unwrap(
      await this.client.storage.externalChatPermissions({
        path: { chat_id: this.id },
      }),
    );
  }

  /** Actual owner updates standard link/team sharing settings. */
  async updatePermissions(
    update: UpdateSharePermissionRequestV2,
  ): Promise<void> {
    await this.mutate((client) =>
      client.storage.externalChatUpdatePermissions({
        path: { chat_id: this.id },
        body: update,
      }),
    );
  }

  /** Owner stops syncing the chat; history and established sharing stay. */
  async remove(): Promise<void> {
    await this.mutate((client) =>
      client.storage.externalChatRemove({ path: { chat_id: this.id } }),
    );
  }

  /** Stage a supported attachment for a deliberate send. */
  async upload(file: Blob | File): Promise<ExternalChatUpload> {
    const record = unwrap(
      await this.client.storage.externalChatUpload({
        path: { chat_id: this.id },
        body: { file },
      }),
    );
    return ExternalChatUpload.from(this, record);
  }

  /** Personal sessions and owner API credentials can send. Bots never send.
   * Preserve the idempotency key; uncertain outcomes are never automatically resent.
   * The server enforces one request per second per user.
   */
  async send(
    content: ExternalChatContent,
    options: { idempotencyKey: string; replyTo?: ExternalChatMessage },
  ): Promise<ExternalChatSend> {
    if (options.replyTo) this.assertChat(options.replyTo.chat);
    const message = match(content)
      .returnType<ExternalChatReplyContent>()
      .with({ type: 'text' }, (value) => {
        const mentions = value.mentions ?? [];
        for (const participant of mentions) this.assertChat(participant.chat);
        return {
          type: 'text',
          text: value.text,
          mentions: mentions.map((participant) => participant.id),
        };
      })
      .with({ type: 'media' }, (value) => {
        this.assertChat(value.upload.chat);
        return {
          type: 'media',
          uploadId: value.upload.id,
          caption: value.caption,
        };
      })
      .with({ type: 'mutation' }, (value) => {
        this.assertChat(value.message.chat);
        return {
          type: 'mutation',
          messageId: value.message.id,
          operation: value.operation,
          text: value.text,
        };
      })
      .exhaustive();
    const record = await this.mutate((client) =>
      client.storage.externalChatSend({
        path: { chat_id: this.id },
        body: {
          idempotencyKey: options.idempotencyKey,
          message,
          replyTo: options.replyTo?.id,
        },
      }),
    );
    return ExternalChatSend.from(this.client, this, record);
  }

  /** Read only the caller's pending, uncertain or failed sends. */
  async sends(): Promise<ExternalChatSend[]> {
    return unwrap(
      await this.client.storage.externalChatSends({
        path: { chat_id: this.id },
      }),
    ).map((record) => ExternalChatSend.from(this.client, this, record));
  }

  /** Read delivery for selected caller-owned intents or messages. */
  async delivery(
    sends: Array<ExternalChatSend | ExternalChatMessage>,
  ): Promise<ExternalChatSend[]> {
    for (const send of sends) this.assertChat(send.chat);
    return unwrap(
      await this.client.storage.externalChatDelivery({
        path: { chat_id: this.id },
        body: sends.map((send) => send.id),
      }),
    ).map((record) => ExternalChatSend.from(this.client, this, record));
  }

  /** Read attachment states for selected messages. */
  async messageAttachments(messages: ExternalChatMessage[]) {
    for (const message of messages) this.assertChat(message.chat);
    return unwrap(
      await this.client.storage.externalChatMessageAttachments({
        path: { chat_id: this.id },
        body: messages.map((message) => message.id),
      }),
    ).map((record) => ({
      message: ExternalChatMessage.byId(this.client, this, record.messageId),
      attachments: record.attachments.map((attachment) => ({
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

  private assertChat(chat: ExternalChat): void {
    if (chat.id !== this.id)
      throw new Error('External chat reference belongs to another chat');
  }
}
