import type { Message as MessageRecord } from '../../../generated/storage/types.gen';
import { type RichMessage, toBody } from '../../mentions';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import { User } from '../users/user';
import { CallRecord } from './call-record';

/** A message in a call's single persistent chat thread. */
export class CallMessage extends MacroEntity<MessageRecord> {
  private constructor(
    client: MacroClient,
    readonly callId: string,
    id: string,
    seed?: MessageRecord,
  ) {
    super(client, id, seed);
  }

  private get path() {
    return { parent_type: 'call', parent_id: this.callId, id: this.id };
  }

  protected async fetch(): Promise<MessageRecord> {
    return unwrap(
      await this.client.storage.entityMessageGetMessage({ path: this.path }),
    );
  }

  /** A handle to a message by id. Fields load on first access. */
  static byId(client: MacroClient, callId: string, id: string): CallMessage {
    return new CallMessage(client, callId, id);
  }

  /** Build a message from its record without another fetch. */
  static from(
    client: MacroClient,
    callId: string,
    record: MessageRecord,
  ): CallMessage {
    return new CallMessage(client, callId, record.id, record);
  }

  /** The message body (markdown). */
  readonly content = this.field('content');

  /** When the message was created. */
  readonly createdAt = this.field('created_at');

  /** When the message was last updated. */
  readonly updatedAt = this.field('updated_at');

  /** The call whose chat contains this message. */
  call(): CallRecord {
    return CallRecord.byId(this.client, this.callId);
  }

  /** The user who sent this message. */
  async author(): Promise<User> {
    return User.byId(this.client, (await this.detail.get()).sender_id);
  }

  /** Reply in the call's canonical thread, including when this is a reply. */
  async reply(body: string | RichMessage): Promise<CallMessage> {
    const record = unwrap(
      await this.client.storage.entityMessageCreate({
        path: { parent_type: 'call', parent_id: this.callId },
        body: { ...toBody(body), thread_id: this.callId },
      }),
    );
    return CallMessage.from(this.client, this.callId, record);
  }

  /** Replace this message's body. */
  async edit(body: string | RichMessage): Promise<this> {
    const { content, mentions } = toBody(body);
    await this.mutate((client) =>
      client.storage.entityMessageEdit({
        path: this.path,
        body: { content, mentions },
      }),
    );
    return this;
  }

  /** Delete this message, preserving the rest of the call's chat. */
  async delete(): Promise<void> {
    await this.mutate((client) =>
      client.storage.entityMessageDeleteMessage({ path: this.path }),
    );
  }
}
