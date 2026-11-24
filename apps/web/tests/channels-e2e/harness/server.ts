import type { APIRequestContext } from '@playwright/test';
import { apiFor, type PersonKey } from './people';

/**
 * What the services hold for a channel, read the way a device that has never
 * seen the channel reads it, and written the way `shown` in `device.ts`
 * writes what is on a screen. A test compares a device that held the channel
 * through a messy sequence against this, as well as against what the test
 * itself did: the three must say the same.
 */

type StoredMessage = {
  id: string;
  content: string;
  deleted_at: string | null;
  reactions?: { emoji: string; users: string[] }[];
  thread?: { reply_count: number } | null;
};

type Entry = { type: string; message?: StoredMessage };

/** A page of the channel, newest entry first. */
/** The cursor is the services' own and goes back to them as it came. */
type Page = { entries: Entry[]; next_cursor?: unknown };

type Thread = { replies: StoredMessage[] };

const DELETED = 'This message was deleted.';

function line(message: StoredMessage): string {
  if (message.deleted_at !== null) return DELETED;
  const reactions = (message.reactions ?? [])
    .filter((reaction) => reaction.users.length > 0)
    .map((reaction) =>
      reaction.users.length > 1
        ? `${reaction.emoji} ${reaction.users.length}`
        : reaction.emoji
    )
    .sort();
  return reactions.length > 0
    ? `${message.content} [${reactions.join(' ')}]`
    : message.content;
}

async function read<T>(http: APIRequestContext, path: string): Promise<T> {
  const response = await http.get(path);
  if (!response.ok()) {
    throw new Error(
      `read ${path} failed (${response.status()}): ${await response.text()}`
    );
  }
  return (await response.json()) as T;
}

/** Every entry of the channel, oldest first, however many pages it takes. */
async function everyEntry(
  http: APIRequestContext,
  path: string
): Promise<Entry[]> {
  const pages: Entry[][] = [];
  let cursor: unknown;
  for (let page = 0; page < 50; page += 1) {
    const selection = encodeURIComponent(
      JSON.stringify({ limit: 100, direction: 'older', cursor })
    );
    const got = await read<Page>(http, `${path}?selection=${selection}`);
    pages.unshift([...got.entries].reverse());
    if (!got.next_cursor) return pages.flat();
    cursor = got.next_cursor;
  }
  throw new Error(`${path} has more than 50 pages`);
}

/** A message the services hold, with the replies under it. */
export type HeldMessage = {
  id: string;
  /** The message as `serverChannel` writes it, without the reply mark. */
  line: string;
  deleted: boolean;
  replies: HeldMessage[];
};

function held(message: StoredMessage, replies: HeldMessage[]): HeldMessage {
  return {
    id: message.id,
    line: line(message),
    deleted: message.deleted_at !== null,
    replies,
  };
}

/**
 * Every message of the channel as the services hold it for the person whose
 * session `http` carries, oldest first, each with its replies.
 */
export async function heldMessages(
  http: APIRequestContext,
  channelId: string
): Promise<HeldMessage[]> {
  const messages: HeldMessage[] = [];
  const base = `/dss/messages/channel/${channelId}`;
  for (const entry of await everyEntry(http, `${base}/timeline`)) {
    if (entry.type !== 'message' || !entry.message) continue;
    if ((entry.message.thread?.reply_count ?? 0) === 0) {
      messages.push(held(entry.message, []));
      continue;
    }
    const thread = await read<Thread>(
      http,
      `${base}/threads/${entry.message.id}`
    );
    messages.push(
      held(
        entry.message,
        thread.replies.map((reply) => held(reply, []))
      )
    );
  }
  return messages;
}

/** Held messages as lines: `text [👍 2]`, and `  > text` for a reply. */
export function asLines(messages: HeldMessage[]): string[] {
  return messages.flatMap((message) => [
    message.line,
    ...message.replies.map((reply) => `  > ${reply.line}`),
  ]);
}

/**
 * The channel as the services hold it for this person, one line a message,
 * oldest first: `text`, `text [👍 2]` with reactions, `  > text` for a reply
 * under the message above.
 */
export async function serverChannel(
  key: PersonKey,
  channelId: string
): Promise<string[]> {
  const http = await apiFor(key);
  try {
    return asLines(await heldMessages(http, channelId));
  } finally {
    await http.dispose();
  }
}
