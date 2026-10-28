import type { WhatsAppGroupMessage } from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import type { WhatsAppGroup } from './group';

/** Message in an independently shared WhatsApp group. */
export class WhatsAppMessage extends MacroEntity<WhatsAppGroupMessage> {
  private constructor(
    client: MacroClient,
    /** The chat this message is in. */
    readonly group: WhatsAppGroup,
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

  protected async fetch(): Promise<WhatsAppGroupMessage> {
    return unwrap(
      await this.client.storage.whatsappGroupMessage({
        path: { group_id: this.group.id, message_id: this.id },
      }),
    );
  }

  /** Plain WhatsApp text. */
  readonly body = this.field('body');
  /** Protocol-verified sender association and display name. */
  readonly sender = this.field('sender');
  /** WhatsApp timestamp. */
  readonly sentAt = this.field('sentAt');
  /** Last edit time. */
  readonly editedAt = this.field('editedAt');
  /** Deleted for everyone. */
  readonly deleted = this.field('deleted');
  /** Grouped emoji counts and caller's own reaction. */
  readonly reactions = this.field('reactions');
  /** Caller-owned send's delivery state, when present. */
  readonly deliveryState = this.field('deliveryState');
  /** `message`, or `system` for something that happened in the group (see `rich`). */
  readonly kind = this.field('kind');
  /** Forwarded from another chat. */
  readonly forwarded = this.field('forwarded');
  /** Sent as view-once in WhatsApp; Macro keeps and shows it like any media. */
  readonly viewOnce = this.field('viewOnce');
  /** People the body @-mentions: `@<token>` in the body is this person. */
  readonly mentions = this.field('mentions');
  /** Poll (with tallies), location, contact cards, event or system line. */
  readonly rich = this.field('rich');
  /** Quoted message in this group. */
  readonly replyTo: () => Promise<WhatsAppMessage | undefined> =
    this.mappedField('replyTo', (id) =>
      id ? WhatsAppMessage.byId(this.client, this.group, id) : undefined,
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
