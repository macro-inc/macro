// The agent's own Macro account over HTTP, for the calls the brain makes on
// every event: messages, channels, typing, decisions, the event
// stream. Request shapes mirror crates/agent_brain's client. `fetch` is
// injected so tests never touch the network.
import type { CountedReaction } from '../../sdk/generated/storage/types.gen.ts';
import type { Hosts } from './config.ts';
export const API_KEY_HEADER = 'x-macro-user-api-key';
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
export type Mention = {
  entity_id: string;
  entity_type: string;
};
export type Message = {
  id: string;
  content: string;
  created_at: string;
  sender_id: string;
  thread_id?: string | null;
  mentions?: Mention[];
  attachments?: unknown[];
};
export type ListedMessage = Message & {
  thread?: {
    reply_count?: number;
    latest_reply_at?: string | null;
    preview?: Message[];
  } | null;
};
export type ChannelType =
  | 'public'
  | 'private'
  | 'direct_message'
  | 'team'
  | string;
export type ChannelDetail = {
  channel_id: string;
  channel_name: string;
  channel_type: ChannelType;
};
export type TimelineQuery = {
  activity_after?: string;
  ids?: string[];
  limit?: number;
};
export type DecideRequest = {
  input: unknown;
  questions: Record<string, string>;
};
export type DecideResponse = {
  probabilities: Record<string, number>;
};
export type Me = {
  user_id: string;
};
export class MacroHttpError extends Error {
  readonly what: string;
  readonly status: number;
  readonly body: string;
  constructor(what: string, status: number, body: string) {
    super(`could not ${what}: HTTP ${status} ${body.slice(0, 500)}`);
    this.what = what;
    this.status = status;
    this.body = body;
  }
}
export class MacroHttp {
  readonly hosts: Hosts;
  readonly #apiKey: string;
  private readonly fetch: Fetch;
  constructor(hosts: Hosts, apiKey: string, fetch: Fetch) {
    this.hosts = hosts;
    this.#apiKey = apiKey;
    this.fetch = fetch;
  }
  async send(
    what: string,
    url: string,
    init: RequestInit = {}
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set(API_KEY_HEADER, this.#apiKey);
    if (init.body !== undefined)
      headers.set('content-type', 'application/json');
    const response = await this.fetch(url, { ...init, headers });
    if (!response.ok) {
      throw new MacroHttpError(what, response.status, await response.text());
    }
    return response;
  }
  private async json<Body>(
    what: string,
    url: string,
    init: RequestInit = {}
  ): Promise<Body> {
    return (await (await this.send(what, url, init)).json()) as Body;
  }
  me(): Promise<Me> {
    return this.json('read the current user', `${this.hosts.auth}/user/me`);
  }
  channel(channelId: string): Promise<ChannelDetail> {
    return this.json(
      'read a channel',
      `${this.hosts.storage}/channels/${channelId}`
    );
  }
  /** Post at the channel root, or in the thread rooted at `threadId`. */
  post(
    channelId: string,
    content: string,
    threadId?: string
  ): Promise<Message> {
    const body = {
      content,
      mentions: [],
      attachments: [],
      thread_id: threadId ?? null,
      nonce: crypto.randomUUID(),
    };
    return this.json(
      'post a message',
      `${this.hosts.storage}/messages/channel/${channelId}`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      }
    );
  }
  async reactions(channel: string, id: string): Promise<CountedReaction[]> {
    const message = await this.json<{ reactions: CountedReaction[] }>(
      'read message reactions',
      `${this.hosts.storage}/messages/channel/${channel}/items/${id}`
    );
    return message.reactions;
  }
  async react(channel: string, id: string, emoji: string): Promise<void> {
    await this.send(
      'react to a message',
      `${this.hosts.storage}/messages/channel/${channel}/items/${id}/reactions`,
      {
        method: 'POST',
        body: JSON.stringify({ add: true, emoji }),
      }
    );
  }
  async typing(
    channelId: string,
    threadId: string | undefined,
    active: boolean
  ): Promise<void> {
    await this.send(
      'send the typing indicator',
      `${this.hosts.storage}/messages/channel/${channelId}/typing`,
      {
        method: 'POST',
        body: JSON.stringify({ active, thread_id: threadId ?? null }),
      }
    );
  }
  /** Root messages of a channel, newest first, one page. */
  async channelMessages(
    channelId: string,
    query: TimelineQuery
  ): Promise<ListedMessage[]> {
    const selection = encodeURIComponent(JSON.stringify(query));
    const page = await this.json<{
      items: ListedMessage[];
    }>(
      'read channel messages',
      `${this.hosts.storage}/messages/channel/${channelId}?selection=${selection}`
    );
    return page.items;
  }
  /** The DM channel with a user, created if needed. */
  async openDirectMessage(userId: string): Promise<string> {
    const opened = await this.json<{
      channel_id: string;
    }>(
      'open a direct message',
      `${this.hosts.storage}/channels/get_or_create_dm`,
      { method: 'POST', body: JSON.stringify({ recipient_id: userId }) }
    );
    return opened.channel_id;
  }
  decide(request: DecideRequest): Promise<DecideResponse> {
    return this.json(
      'ask for a decision',
      `${this.hosts.cognition}/decisions`,
      {
        method: 'POST',
        body: JSON.stringify(request),
      }
    );
  }
  /** Open `GET {storage}/webhook/events/stream` as the agent. */
  async openEventStream(
    filters: {
      events: string[];
    }[],
    signal: AbortSignal
  ): Promise<ReadableStream<Uint8Array>> {
    const query = `scope=user&filters=${encodeURIComponent(JSON.stringify(filters))}`;
    const response = await this.send(
      'open the event stream',
      `${this.hosts.storage}/webhook/events/stream?${query}`,
      {
        headers: { accept: 'text/event-stream' },
        signal,
      }
    );
    if (!response.body)
      throw new MacroHttpError(
        'open the event stream',
        response.status,
        'no body'
      );
    return response.body;
  }
}
