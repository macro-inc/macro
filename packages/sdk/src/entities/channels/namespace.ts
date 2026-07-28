import type { ChannelType } from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { SearchOpts } from '../search';
import type { Team } from '../teams/team';
import type { User } from '../users/user';
import { Channel } from './channel';

export class ChannelNamespace {
  constructor(private readonly client: MacroClient) {}

  byId(id: string): Channel {
    return Channel.byId(this.client, id);
  }

  async dm(recipient: User): Promise<Channel> {
    return Channel.dm(this.client, recipient);
  }

  /** Open (creating if needed) the private group channel with a set of users. */
  async private(recipients: User[]): Promise<Channel> {
    return Channel.private(this.client, recipients);
  }

  /** Create a channel. The caller becomes the owner. */
  async create(opts: {
    type: ChannelType;
    name?: string;
    /** Participants to add, excluding the owner. */
    participants?: User[];
    /** Team, for team channels. */
    team?: Team;
  }): Promise<Channel> {
    return Channel.create(this.client, opts);
  }

  /** All channels the authenticated user is a member of. */
  async list(): Promise<Channel[]> {
    const { items } = unwrap(await this.client.storage.getChannels());
    return items.map((ch) => Channel.byId(this.client, ch.id.toString()));
  }

  /**
   * Search channels by name (client-side fuzzy filter on the full channel list)
   * or by content (server-side unified search).
   */
  async *search(query: string, opts?: SearchOpts): AsyncGenerator<Channel> {
    if (!opts?.searchOn || opts.searchOn === 'name') {
      const { items } = unwrap(await this.client.storage.getChannels());
      const lower = query.toLowerCase();
      for (const ch of items) {
        if (ch.name?.toLowerCase().includes(lower)) {
          yield Channel.byId(this.client, ch.id.toString());
        }
      }
    } else {
      yield* Channel.search(this.client, query, opts);
    }
  }
}
