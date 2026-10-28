import type { ExternalChatMessage as ExternalChatMessageRecord } from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import type { ExternalChat } from './chat';

/** Message in an added external chat. */
export class ExternalChatMessage extends MacroEntity<ExternalChatMessageRecord> {
  private constructor(
    client: MacroClient,
    /** The chat this message is in. */
    readonly chat: ExternalChat,
    id: string,
    seed?: ExternalChatMessageRecord,
  ) {
    super(client, id, seed);
  }

  /** Reference a message within its original chat. */
  static byId(
    client: MacroClient,
    chat: ExternalChat,
    id: string,
  ): ExternalChatMessage {
    return new ExternalChatMessage(client, chat, id);
  }

  /** Seed a message handle from a timeline response. */
  static from(
    client: MacroClient,
    chat: ExternalChat,
    record: ExternalChatMessageRecord,
  ): ExternalChatMessage {
    return new ExternalChatMessage(client, chat, record.id, record);
  }

  protected async fetch(): Promise<ExternalChatMessageRecord> {
    return unwrap(
      await this.client.storage.externalChatMessage({
        path: { chat_id: this.chat.id, message_id: this.id },
      }),
    );
  }

  /** Plain message text. */
  readonly body = this.field('body');
  /** Protocol-verified sender association and display name. */
  readonly sender = this.field('sender');
  /** Provider timestamp. */
  readonly sentAt = this.field('sentAt');
  /** Last edit time. */
  readonly editedAt = this.field('editedAt');
  /** Deleted for everyone. */
  readonly deleted = this.field('deleted');
  /** Grouped emoji counts and caller's own reaction. */
  readonly reactions = this.field('reactions');
  /** Caller-owned send's delivery state, when present. */
  readonly deliveryState = this.field('deliveryState');
  /** `message`, or `system` for something that happened in the chat (see `rich`). */
  readonly kind = this.field('kind');
  /** Forwarded from another chat. */
  readonly forwarded = this.field('forwarded');
  /** Sent as view-once in the provider; Macro keeps and shows it like any media. */
  readonly viewOnce = this.field('viewOnce');
  /** People the body @-mentions: `@<token>` in the body is this person. */
  readonly mentions = this.field('mentions');
  /** Poll (with tallies), location, contact cards, event or system line. */
  readonly rich = this.field('rich');
  /** Quoted message in this chat. */
  readonly replyTo: () => Promise<ExternalChatMessage | undefined> =
    this.mappedField('replyTo', (id) =>
      id ? ExternalChatMessage.byId(this.client, this.chat, id) : undefined,
    );
  /** Attachment states, with the stored file's URL once ready. */
  readonly attachments = this.mappedField('attachments', (records) =>
    records.map((record) => ({
      ordinal: record.ordinal,
      state: record.state,
      fileName: record.fileName,
      mime: record.mime,
      size: record.size,
      width: record.width ?? undefined,
      height: record.height ?? undefined,
      durationSeconds: record.durationSeconds ?? undefined,
      presentation: record.presentation ?? undefined,
      url: record.fileId
        ? `${this.client.hosts['static-files']}/file/${record.fileId}`
        : undefined,
    })),
  );
}
