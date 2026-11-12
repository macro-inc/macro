import type {
  ActivityType,
  ApiActivity,
} from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { User } from '../users/user';
import type { Channel } from './channel';

/**
 * A user's channel activity marker.
 *
 * @mcp-exclude Built from a listing record; no id-only reference an MCP call can pass.
 */
export class ChannelActivity {
  constructor(
    private readonly client: MacroClient,
    /** Related channel. */
    readonly channel: Channel,
    private readonly record: ApiActivity,
  ) {}

  /** Activity identity. */
  get id(): string {
    return this.record.id;
  }

  /**
   * User who interacted.
   *
   * @readonly
   */
  user(): User {
    return User.byId(this.client, this.record.user_id);
  }

  /**
   * Creation time.
   *
   * @readonly
   */
  createdAt(): string {
    return this.record.created_at;
  }

  /**
   * Record a view or interaction in this channel.
   *
   * @write
   */
  async recordInteraction(type: ActivityType): Promise<ChannelActivity> {
    return new ChannelActivity(
      this.client,
      this.channel,
      unwrap(
        await this.client.storage.postActivity({
          body: { activity_type: type, channel_id: this.channel.id },
        }),
      ),
    );
  }

  /** Serialize activity without credentials. */
  toJSON() {
    return this.record;
  }
}
