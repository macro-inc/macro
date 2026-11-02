import { match } from 'ts-pattern';
import type { ExternalChatSendProgress } from '../../../generated/storage/types.gen';
import { MacroNotFoundError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import type { ExternalChat, ExternalChatContent } from './chat';
import { ExternalChatMessage } from './message';
import { ExternalChatParticipant } from './participant';
import { ExternalChatUpload } from './upload';

/** One deliberate send intent. Unknown outcomes must never be automatically resent. */
export class ExternalChatSend extends MacroEntity<ExternalChatSendProgress> {
  private constructor(
    client: MacroClient,
    /** The chat containing this send. */
    readonly chat: ExternalChat,
    id: string,
    seed?: ExternalChatSendProgress,
  ) {
    super(client, id, seed);
  }

  /** Reference a send intent within its original chat. */
  static byId(
    client: MacroClient,
    chat: ExternalChat,
    id: string,
  ): ExternalChatSend {
    return new ExternalChatSend(client, chat, id);
  }

  /** Seed a send handle from a server response. */
  static from(
    client: MacroClient,
    chat: ExternalChat,
    record: ExternalChatSendProgress,
  ): ExternalChatSend {
    return new ExternalChatSend(client, chat, record.id, record);
  }

  protected async fetch(): Promise<ExternalChatSendProgress> {
    const records = unwrap(
      await this.client.storage.externalChatDelivery({
        path: { chat_id: this.chat.id },
        body: [this.id],
      }),
    );
    const record = records.find((send) => send.id === this.id);
    if (!record)
      throw new MacroNotFoundError('External chat send is not available');
    return record;
  }

  /** Last observed delivery state; refresh explicitly to poll again. */
  readonly state = this.field('state');

  /** Sanitized failure code, when present. */
  readonly errorCode = this.field('errorCode');

  /** When the send intent was created. */
  readonly createdAt = this.field('createdAt');

  /** Chat message once the provider accepted the send. */
  readonly message = this.mappedField('messageId', (id) =>
    id ? ExternalChatMessage.byId(this.client, this.chat, id) : undefined,
  );

  /** Inspect the original intent for reconciliation; never resubmit an unknown outcome automatically. */
  async request(): Promise<{
    idempotencyKey: string;
    message: ExternalChatContent;
    replyTo?: ExternalChatMessage;
  }> {
    const { payload } = await this.detail.get();
    const wire = payload.message;
    const message = match(wire)
      .returnType<ExternalChatContent>()
      .with({ type: 'media' }, (wire) => ({
        type: 'media',
        upload: ExternalChatUpload.byId(this.chat, wire.uploadId),
        caption: wire.caption ?? undefined,
      }))
      .with({ type: 'mutation' }, (wire) => ({
        type: 'mutation',
        message: ExternalChatMessage.byId(
          this.client,
          this.chat,
          wire.messageId,
        ),
        operation: wire.operation,
        text: wire.text ?? undefined,
      }))
      .with({ type: 'text' }, (wire) => ({
        type: 'text',
        text: wire.text,
        mentions: (wire.mentions ?? []).map((jid) =>
          ExternalChatParticipant.byId(this.chat, jid),
        ),
      }))
      .exhaustive();
    return {
      idempotencyKey: payload.idempotencyKey,
      message,
      replyTo: payload.replyTo
        ? ExternalChatMessage.byId(this.client, this.chat, payload.replyTo)
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
