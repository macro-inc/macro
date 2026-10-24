import type { WhatsAppGroupMessage } from '../../../generated/storage/types.gen';
import { MacroNotFoundError } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { Document } from '../documents/document';
import { MacroEntity } from '../entity';
import type { WhatsAppGroup } from './group';

/** Message in an independently shared WhatsApp group. */
export class WhatsAppMessage extends MacroEntity<WhatsAppGroupMessage> {
  private constructor(
    client: MacroClient,
    private readonly group: WhatsAppGroup,
    id: string,
    seed?: WhatsAppGroupMessage,
  ) {
    super(client, id, seed);
  }

  /** Reference a message within its original group. */
  static byId(
    client: MacroClient,
    group: WhatsAppGroup,
    id: string,
  ): WhatsAppMessage {
    return new WhatsAppMessage(client, group, id);
  }

  /** Seed a message handle from a timeline response. */
  static from(
    client: MacroClient,
    group: WhatsAppGroup,
    record: WhatsAppGroupMessage,
  ): WhatsAppMessage {
    return new WhatsAppMessage(client, group, record.id, record);
  }

  /** Group identity for checking reply/mutation scope. */
  get groupId(): string {
    return this.group.id;
  }

  protected async fetch(): Promise<WhatsAppGroupMessage> {
    for await (const message of this.group.messages({ limit: 100 })) {
      if (message.id === this.id) return message.detail.get();
    }
    throw new MacroNotFoundError('WhatsApp message is not available');
  }

  /** Plain WhatsApp text. */
  readonly body = this.field('body');
  /** Protocol-verified sender association and display name. */
  readonly sender = this.field('sender');
  /** WhatsApp timestamp. */
  readonly sentAt = this.field('sent_at');
  /** Last edit time. */
  readonly editedAt = this.field('edited_at');
  /** Deleted for everyone. */
  readonly deleted = this.field('deleted');
  /** Grouped emoji counts and caller's own reaction. */
  readonly reactions = this.field('reactions');
  /** Caller-owned send's delivery state, when present. */
  readonly deliveryState = this.field('delivery_state');
  /** Quoted message in this group. */
  readonly replyTo: () => Promise<WhatsAppMessage | undefined> =
    this.mappedField('reply_to', (id) =>
      id ? WhatsAppMessage.byId(this.client, this.group, id) : undefined,
    );
  /** Attachment state and imported document handles. */
  readonly attachments = this.mappedField('attachments', (records) =>
    records.map((record) => ({
      ordinal: record.ordinal,
      state: record.state,
      fileName: record.file_name,
      mime: record.mime,
      size: record.size,
      document: record.document_id
        ? Document.byId(this.client, record.document_id)
        : undefined,
    })),
  );
}
