import type {
  ApiChannelWithLatest,
  ChannelType,
} from '../../../generated/storage/types.gen';
import { paginate, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { SearchOpts } from '../search';
import type { Team } from '../teams/team';
import type { User } from '../users/user';
import { ChannelActivity } from './activity';
import { Channel } from './channel';
import { ChannelLabelsNamespace } from './labels';

/** The largest page `GET /comms/channels` serves. */
const CHANNEL_PAGE_SIZE = 100;

export class ChannelNamespace {
  /** Recent channel activity, with channel and user handles. */
  async activity(): Promise<ChannelActivity[]> {
    return unwrap(await this.client.storage.getActivity()).map(
      (record) =>
        new ChannelActivity(
          this.client,
          Channel.byId(this.client, record.channel_id),
          record,
        ),
    );
  }

  /** Team-shared labels that group channels in the Chat sidebar. */
  readonly labels: ChannelLabelsNamespace;

  constructor(private readonly client: MacroClient) {
    this.labels = new ChannelLabelsNamespace(client);
  }

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

  /**
   * Every channel the authenticated user is a member of, auto-paginated.
   * Iterate with `for await`; collect with `Array.fromAsync`.
   */
  async *list(): AsyncGenerator<Channel> {
    for await (const record of this.records()) {
      yield Channel.byId(this.client, record.id);
    }
  }

  /**
   * Search channels by name (case-insensitive substring match over every
   * channel the user is a member of) or by content (server-side unified search).
   */
  async *search(query: string, opts?: SearchOpts): AsyncGenerator<Channel> {
    if (!opts?.searchOn || opts.searchOn === 'name') {
      const lower = query.toLowerCase();
      for await (const record of this.records()) {
        if (record.name?.toLowerCase().includes(lower)) {
          yield Channel.byId(this.client, record.id);
        }
      }
    } else {
      yield* Channel.search(this.client, query, opts);
    }
  }

  private records(): AsyncGenerator<ApiChannelWithLatest> {
    return paginate(async (cursor) => {
      const page = unwrap(
        await this.client.storage.getChannels({
          query: { limit: CHANNEL_PAGE_SIZE, ...(cursor ? { cursor } : {}) },
        }),
      );
      return { items: page.items, nextCursor: page.next_cursor };
    });
  }
}
