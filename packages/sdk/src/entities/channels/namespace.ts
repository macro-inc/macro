import type {
  ApiChannelWithLatest,
  ChannelType,
} from '../../../generated/storage/types.gen';
import {
  type IterationOptions,
  iterate,
  MacroError,
  paginate,
  unwrap,
} from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { SearchOpts } from '../search/options';
import type { Team } from '../teams/team';
import type { User } from '../users/user';
import { ChannelActivity } from './activity';
import { Channel } from './channel';
import { ChannelLabelsNamespace } from './labels';

/** The largest page `GET /comms/channels` serves. */
const CHANNEL_PAGE_SIZE = 100;

/**
 * @routing Use when reading or sending channel and direct messages, posting a poll, reacting or managing members; not email, or WhatsApp and other external chats (`macro.externalChats`).
 *
 * @agent
 * ## Polls
 *
 * A form for a channel is a poll: one required single- or multi-select question (`widget: "choice"`, or `"checkboxes"` for several answers), `status: "open"`, `tallyVisible: true`, and `channelGrants: []`. Post it as one message with its live card on its own line:
 *
 * `<m-document-card>{"documentId":"{form_id}","documentName":"{question}","blockName":"form","previewData":{"poll":{"optionCount":2}}}</m-document-card>`
 *
 * That message is the poll, and the card shares it with the channel. Never add a form chip, `/respond` link, `form:` link, or a second copy.
 */
export class ChannelNamespace {
  /**
   * Recent channel activity, with channel and user handles.
   *
   * @readonly
   */
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

  /**
   * Open (creating if needed) the user's 1:1 direct message with one person.
   * For several people, use {@link private}.
   *
   * @write
   * @idempotent
   */
  async dm(recipient: User): Promise<Channel> {
    return Channel.dm(this.client, recipient);
  }

  /**
   * Open (creating if needed) the group direct message with exactly these
   * people, excluding the user. For one person, use {@link dm}.
   *
   * @write
   * @idempotent
   */
  async private(recipients: User[]): Promise<Channel> {
    return Channel.private(this.client, recipients);
  }

  /**
   * Create a channel. The caller becomes the owner.
   *
   * @write
   */
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
   * Every channel the authenticated user is a member of, auto-paginated; `maxItems` caps the total.
   * Iterate with `for await`; collect with `Array.fromAsync`.
   *
   * @readonly
   */
  list(opts?: IterationOptions): AsyncGenerator<Channel> {
    return iterate('channels.list', opts, {}, () => this.listed());
  }

  /**
   * The channels the authenticated user is a member of whose latest message
   * or reply is at or after `after`: the ones worth reading after a gap,
   * the most recently active first; `maxItems` caps how many. Pages through
   * every channel before yielding; reads no messages.
   *
   * @readonly
   */
  activeSince(
    after: Date | string,
    opts?: IterationOptions,
  ): AsyncGenerator<Channel> {
    const since = (after instanceof Date ? after : new Date(after)).getTime();
    if (Number.isNaN(since))
      throw new MacroError(
        `channels.activeSince: not an instant: ${String(after)}`,
      );
    return iterate('channels.activeSince', opts, {}, () => this.active(since));
  }

  private async *active(since: number): AsyncGenerator<Channel> {
    const active: {
      readonly latest: number;
      readonly record: ApiChannelWithLatest;
    }[] = [];
    for await (const record of this.records(CHANNEL_PAGE_SIZE)) {
      const latest = record.latest_message?.created_at;
      if (latest !== undefined && Date.parse(latest) >= since)
        active.push({ latest: Date.parse(latest), record });
    }
    active.sort((a, b) => b.latest - a.latest);
    for (const { record } of active)
      yield Channel.fromListing(this.client, record);
  }

  private async *listed(pageSize = CHANNEL_PAGE_SIZE): AsyncGenerator<Channel> {
    for await (const record of this.records(pageSize)) {
      yield Channel.fromListing(this.client, record);
    }
  }

  /**
   * Search the user's channels by name (the default) or by content; `maxItems`
   * caps the total. A name search matches, case-insensitively, channels whose
   * name or other members' names contain every word of `query`; the server runs
   * it, one request per page of matches, newest first. A blank query lists
   * every channel.
   *
   * @readonly
   */
  search(query: string, opts?: SearchOpts): AsyncGenerator<Channel> {
    // The server refuses a blank query; a blank name matches every channel.
    if (!query.trim() && (opts?.searchOn ?? 'name') === 'name')
      return iterate(
        'channels.search',
        opts,
        { searchOn: true, pageSize: true },
        () => this.listed(opts?.pageSize),
      );
    return Channel.search(this.client, query, {
      ...opts,
      searchOn: opts?.searchOn ?? 'name',
    });
  }

  private records(pageSize: number): AsyncGenerator<ApiChannelWithLatest> {
    return paginate(async (cursor) => {
      const page = unwrap(
        await this.client.storage.getChannels({
          query: { limit: pageSize, ...(cursor ? { cursor } : {}) },
        }),
      );
      return { items: page.items, nextCursor: page.next_cursor };
    });
  }
}
