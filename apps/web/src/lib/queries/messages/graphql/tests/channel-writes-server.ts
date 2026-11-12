import type { MessageListItem, MessageParent } from '@service-storage/messages';
import { never } from '../../../email/tests/draft-sync-shared';
import { entryToGraphql, timelinePageToGraphql } from '../convert';

/** The signed-in user on every simulated page. */
export const ME = 'macro|me@example.com';
export const CHANNEL: MessageParent = { type: 'channel', id: 'channel-1' };

/** A GraphQL refusal with its error code. */
export class Refusal extends Error {
  constructor(readonly code: string) {
    super(`refused: ${code}`);
  }
}

/** One write request as the server saw it, and what it did with it. */
export type ServerWrite = {
  operation: string;
  messageId: string;
  content?: string;
  emoji?: string;
  add?: boolean;
  outcome: 'applied' | 'replayed' | `refused:${string}`;
};

/** `order` breaks ties between rows created in the same millisecond. */
type Row = { item: MessageListItem; seq: number; order: number };
type Input = Record<string, unknown>;

const WRITE_FIELDS: Record<string, string> = {
  PostChannelMessage: 'postChannelMessage',
  EditChannelMessage: 'editChannelMessage',
  DeleteChannelMessage: 'deleteChannelMessage',
  ReactToChannelMessage: 'reactToChannelMessage',
};

/**
 * The channel message service, following `crates/channels`: posts keyed by
 * the client's id and replayed once stored, every change numbered, and the
 * latest page and the changes after a number read from the same rows.
 */
export function createChannelServer() {
  let seq = 0;
  const rows = new Map<string, Row>();
  const removed = new Map<string, number>();
  /** Every write request that reached the server, in arrival order. */
  const received: ServerWrite[] = [];
  const state = {
    offline: false,
    /** Refuse every write with `BUSY`, as the server shedding load. */
    busy: false,
    /** Apply each write, then never answer it: the connection drops. */
    loseResponses: false,
  };

  const now = () => new Date().toISOString();
  const live = (id: string) => {
    const row = rows.get(id);
    if (!row || removed.has(id)) throw new Refusal('NOT_FOUND');
    return row;
  };
  const change = (row: Row, patch: Partial<MessageListItem>) => {
    seq += 1;
    row.item = { ...row.item, ...patch };
    row.seq = seq;
    return seq;
  };

  function post(input: Input): { item: MessageListItem; seq: number | null } {
    const id = String(input.id);
    const existing = rows.get(id);
    // A repeated post answers with the stored message and no number.
    if (existing) return { item: existing.item, seq: null };
    const at = now();
    seq += 1;
    const item: MessageListItem = {
      id,
      parent: { type: 'channel', id: String(input.channelId) },
      thread_id: null,
      kind: 'message',
      sender_id: ME,
      guest_name: null,
      imported_author: null,
      bot_profile: null,
      mentions: [],
      triggered_by: null,
      triggered_via: null,
      content: String(input.content),
      created_at: at,
      updated_at: at,
      edited_at: null,
      deleted_at: null,
      attachments: [],
      reactions: [],
      state: {
        root_id: id,
        user_id: ME,
        resolved: false,
        anchor: null,
        created_at: at,
        updated_at: at,
        deleted_at: null,
      },
      thread: { reply_count: 0, latest_reply_at: null, preview: [] },
    };
    rows.set(id, { item, seq, order: rows.size });
    return { item, seq };
  }

  function react(input: Input) {
    const row = live(String(input.messageId));
    const emoji = String(input.emoji);
    const others = row.item.reactions.filter((r) => r.emoji !== emoji);
    const users = new Set(
      row.item.reactions.find((r) => r.emoji === emoji)?.users ?? []
    );
    if (input.add) users.add(ME);
    else users.delete(ME);
    const reactions =
      users.size > 0 ? [...others, { emoji, users: [...users] }] : others;
    return { item: row.item, seq: change(row, { reactions }) };
  }

  function write(operation: string, input: Input) {
    switch (operation) {
      case 'PostChannelMessage':
        return post(input);
      case 'EditChannelMessage': {
        const row = live(String(input.messageId));
        const at = now();
        const next = change(row, {
          content: String(input.content),
          edited_at: at,
          updated_at: at,
        });
        return { item: row.item, seq: next };
      }
      case 'DeleteChannelMessage': {
        const row = live(String(input.messageId));
        const at = now();
        const next = change(row, { deleted_at: at, updated_at: at });
        removed.set(row.item.id, next);
        return { item: row.item, seq: next };
      }
      default:
        return react(input);
    }
  }

  function message(item: MessageListItem) {
    return entryToGraphql({ type: 'message', message: item });
  }

  function entries(since: number) {
    return [...rows.values()]
      .filter((row) => row.seq > since && !removed.has(row.item.id))
      .sort((a, b) => a.seq - b.seq)
      .map((row) => message(row.item));
  }

  /** The rows a fresh read shows, newest first. */
  function shown() {
    return [...rows.values()]
      .filter((row) => !removed.has(row.item.id))
      .sort(
        (a, b) =>
          b.item.created_at.localeCompare(a.item.created_at) ||
          b.order - a.order
      )
      .map((row) => row.item);
  }

  function latestPage(channelId: string) {
    const page = shown().map((item) => ({
      type: 'message' as const,
      message: item,
    }));
    return {
      user: {
        id: ME,
        channelMessages: {
          id: channelId,
          timeline: timelinePageToGraphql({
            seq,
            page: { entries: page, next_cursor: null, previous_cursor: null },
          }),
        },
      },
    };
  }

  function changes(channelId: string, since: number) {
    return {
      user: {
        id: ME,
        channelMessages: {
          id: channelId,
          changes: {
            reset: false,
            seq,
            hasMore: false,
            entries: entries(since),
            replies: [],
            activities: [],
            removed: [...removed]
              .filter(([, at]) => at > since)
              .map(([id]) => id),
          },
        },
      },
    };
  }

  /** Answer one GraphQL operation, as its `data`; refusals throw. */
  async function handle(operation: string, variables: Input): Promise<unknown> {
    await Promise.resolve();
    if (state.offline) throw new TypeError('Failed to fetch');
    if (operation === 'ChannelTimeline')
      return latestPage(String(variables.channelId));
    if (operation === 'ChannelChanges')
      return changes(String(variables.channelId), Number(variables.since));
    const field = WRITE_FIELDS[operation];
    if (!field) throw new Error(`Unexpected operation ${operation}`);
    const input = variables.input as Input;
    const request: ServerWrite = {
      operation,
      messageId: String(input.id ?? input.messageId),
      ...(input.content === undefined
        ? {}
        : { content: String(input.content) }),
      ...(input.emoji === undefined
        ? {}
        : { emoji: String(input.emoji), add: Boolean(input.add) }),
      outcome: 'applied',
    };
    received.push(request);
    if (state.busy) {
      request.outcome = 'refused:BUSY';
      throw new Refusal('BUSY');
    }
    let result: { item: MessageListItem; seq: number | null };
    try {
      result = write(operation, input);
    } catch (error) {
      if (error instanceof Refusal) request.outcome = `refused:${error.code}`;
      throw error;
    }
    if (result.seq === null) request.outcome = 'replayed';
    if (state.loseResponses) return await never();
    return {
      [field]: {
        __typename: 'GraphqlChannelMessageWrite',
        message: message(result.item),
        seq: result.seq,
      },
    };
  }

  return {
    state,
    received,
    handle,
    /** A message someone posted before the test began. */
    seed(content: string) {
      post({ channelId: CHANNEL.id, id: crypto.randomUUID(), content });
    },
    /** The writes that changed the channel, in the order they were applied. */
    applied: () => received.filter((request) => request.outcome === 'applied'),
    /** The channel as a fresh read shows it, newest first. */
    rows: shown,
  };
}

export type ChannelServer = ReturnType<typeof createChannelServer>;
