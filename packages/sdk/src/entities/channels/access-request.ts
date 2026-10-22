import type {
  ChannelAccessDecision,
  ChannelAccessRequest as RequestRecord,
} from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import { User } from '../users/user';
import type { Channel } from './channel';

/**
 * One attempt to join a private or team channel. Any participant of the
 * channel can read and answer it; approving adds the requester as a member.
 */
export class ChannelAccessRequest extends MacroEntity<RequestRecord> {
  private constructor(
    client: MacroClient,
    /** Channel the requester asked to join. */
    readonly channel: Channel,
    id: string,
    record?: RequestRecord,
  ) {
    super(client, id, record);
  }

  /** A request to join `channel`, loaded lazily for its participants. */
  static byId(
    client: MacroClient,
    channel: Channel,
    id: string,
  ): ChannelAccessRequest {
    return new ChannelAccessRequest(client, channel, id);
  }

  /** Seed a request from a response that already carries it. */
  static from(
    client: MacroClient,
    channel: Channel,
    record: RequestRecord,
  ): ChannelAccessRequest {
    return new ChannelAccessRequest(client, channel, record.id, record);
  }

  protected async fetch(): Promise<RequestRecord> {
    return unwrap(
      await this.client.storage.getChannelAccessRequest({
        path: { channel_id: this.channel.id, request_id: this.id },
      }),
    );
  }

  /** Pending, approved, denied, or cancelled by the requester. */
  readonly status = this.field('status');

  /** When the requester asked. */
  readonly createdAt = this.field('created_at');

  /** When the request stopped being pending. */
  readonly resolvedAt = this.field('resolved_at');

  /** The person asking to join. */
  readonly requester = this.mappedField('requester_id', (id) =>
    User.byId(this.client, id),
  );

  /** The participant who approved or denied the request. */
  readonly resolvedBy = this.mappedField('resolved_by', (id) =>
    id ? User.byId(this.client, id) : undefined,
  );

  /** Add the requester to the channel. Fails if someone answered first. */
  async approve(): Promise<void> {
    await this.resolve('approve');
  }

  /** Decline the request; the requester can ask again after a day. */
  async deny(): Promise<void> {
    await this.resolve('deny');
  }

  private async resolve(decision: ChannelAccessDecision): Promise<void> {
    await this.mutate((c) =>
      c.storage.resolveChannelAccessRequest({
        path: { channel_id: this.channel.id, request_id: this.id },
        body: { decision },
      }),
    );
  }
}
