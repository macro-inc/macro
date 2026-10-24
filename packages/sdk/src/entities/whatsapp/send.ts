import { match } from 'ts-pattern';
import type { LinkedSendProgress } from '../../../generated/storage/types.gen';
import { MacroNotFoundError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import type { WhatsAppGroup, WhatsAppReply } from './group';
import { WhatsAppMessage } from './message';
import { WhatsAppUpload } from './upload';

/** One deliberate send intent. Unknown outcomes must never be automatically resent. */
export class WhatsAppSend extends MacroEntity<LinkedSendProgress> {
  private constructor(
    client: MacroClient,
    /** Group entity containing this send. */
    readonly group: WhatsAppGroup,
    id: string,
    seed?: LinkedSendProgress,
  ) {
    super(client, id, seed);
  }

  /** Reference a send intent within its original group. */
  static byId(
    client: MacroClient,
    group: WhatsAppGroup,
    id: string,
  ): WhatsAppSend {
    return new WhatsAppSend(client, group, id);
  }

  /** Seed a send handle from a server response. */
  static from(
    client: MacroClient,
    group: WhatsAppGroup,
    record: LinkedSendProgress,
  ): WhatsAppSend {
    return new WhatsAppSend(client, group, record.id, record);
  }

  protected async fetch(): Promise<LinkedSendProgress> {
    const records = unwrap(
      await this.client.storage.linkedDelivery({
        path: { group_id: this.group.id },
        body: [this.id],
      }),
    );
    const record = records.find((send) => send.id === this.id);
    if (!record) throw new MacroNotFoundError('WhatsApp send is not available');
    return record;
  }

  /** Last observed delivery state; refresh explicitly to poll again. */
  readonly state = this.field('state');

  /** Sanitized failure code, when present. */
  readonly errorCode = this.field('error_code');

  /** When the send intent was created. */
  readonly createdAt = this.field('created_at');

  /** Group message once WhatsApp accepted the send. */
  readonly message = this.mappedField('message_id', (id) =>
    id ? WhatsAppMessage.byId(this.client, this.group, id) : undefined,
  );

  /** Inspect the original intent for reconciliation; never resubmit an unknown outcome automatically. */
  async request(): Promise<{
    idempotencyKey: string;
    message: WhatsAppReply;
    replyTo?: WhatsAppMessage;
  }> {
    const { payload } = await this.detail.get();
    const wire = payload.message;
    const message = match(wire)
      .returnType<WhatsAppReply>()
      .with({ type: 'media' }, (wire) => ({
        type: 'media',
        upload: WhatsAppUpload.byId(this.group, wire.upload_id),
        caption: wire.caption ?? undefined,
      }))
      .with({ type: 'mutation' }, (wire) => ({
        type: 'mutation',
        message: WhatsAppMessage.byId(this.client, this.group, wire.message_id),
        operation: wire.operation,
        text: wire.text ?? undefined,
      }))
      .with({ type: 'text' }, (wire) => ({
        type: 'text',
        text: wire.text,
        mentions: wire.mentions ?? [],
      }))
      .exhaustive();
    return {
      idempotencyKey: payload.idempotency_key,
      message,
      replyTo: payload.reply_to
        ? WhatsAppMessage.byId(this.client, this.group, payload.reply_to)
        : undefined,
    };
  }

  /** Fetch current delivery state without retrying or submitting the message. */
  async refresh(): Promise<this> {
    this.detail.clear();
    await this.detail.get();
    return this;
  }
}
