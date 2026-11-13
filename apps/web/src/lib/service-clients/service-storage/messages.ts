import { throwOnErr } from '@core/util/result';
import { statusError } from '@core/util/safeFetch';
import { sleep } from '@core/util/sleep';
import { dssFetch } from './client';
import type { Message as StoredMessage } from './generated/schemas/message';
import type { MessageCursor } from './generated/schemas/messageCursor';
import type { MessageParent } from './generated/schemas/messageParent';
import type { MessageThread as StoredMessageThread } from './generated/schemas/messageThread';
import type { PostMessage } from './generated/schemas/postMessage';
import type { ThreadPatch } from './generated/schemas/threadPatch';
import type { ThreadState } from './generated/schemas/threadState';

export type { CountedReaction } from './generated/schemas/countedReaction';
export type { MessageAttachment } from './generated/schemas/messageAttachment';
export type { MessageParent, PostMessage, ThreadPatch };

/**
 * Presentation identity derived on the client from `sender_id` and the
 * optional bot profile; the API stores only the principal.
 */
export type MessageSender = {
  /** Sender id without the storage namespace prefix. */
  id: string;
  type: 'user' | 'bot';
  /** Display name for bot senders. */
  name?: string | null;
  /** Avatar URL for bot senders. */
  avatar_url?: string | null;
  /** For an agent (bot) message, the id of the user who triggered it. */
  triggered_by?: string | null;
  /** The client the user triggered it through, such as "Claude Code". */
  triggered_via?: string | null;
};

export type Message = StoredMessage & { sender?: MessageSender };
export type MessageThread = Omit<StoredMessageThread, 'root' | 'replies'> & {
  root: Message;
  replies: Message[];
};
export type { MessagePatch } from './generated/schemas/messagePatch';
export type { MessageCursor };

import type { MessagePatch } from './generated/schemas/messagePatch';
export type MessageListItem =
  import('./generated/schemas/messageListItem').MessageListItem & {
    sender?: MessageSender;
  };
/** Root messages only, for callers that select specific discussions. */
export type MessageListPage = Omit<
  import('./generated/schemas/messagePage').MessagePage,
  'items'
> & { items: MessageListItem[] };
export type CallEntryStatus =
  import('./generated/schemas/callEntryStatus').CallEntryStatus;
export type MessageTimelineEntry =
  | { type: 'message'; message: MessageListItem }
  | { type: 'activity'; activity: TimelineActivity }
  /** A channel call and its thread; the root message's id is the call id. */
  | { type: 'call'; message: MessageListItem; status: CallEntryStatus };
/** Messages and the parent's activity in one server-ordered, newest-first list. */
export type MessageTimelinePage = Omit<
  import('./generated/schemas/messageTimelinePage').MessageTimelinePage,
  'entries'
> & { entries: MessageTimelineEntry[] };
export type TimelineActivity =
  import('./generated/schemas/timelineActivity').TimelineActivity;
/** A page as sent: a newer server may add entry kinds this client predates. */
type ReceivedTimelinePage = Omit<MessageTimelinePage, 'entries'> & {
  entries: (MessageTimelineEntry | { type: string })[];
};

export type { MessageTimelineQuery } from './generated/schemas/messageTimelineQuery';

import type { MessageTimelineQuery } from './generated/schemas/messageTimelineQuery';

function isKnownEntry(
  entry: MessageTimelineEntry | { type: string }
): entry is MessageTimelineEntry {
  return (
    entry.type === 'message' ||
    entry.type === 'activity' ||
    entry.type === 'call'
  );
}

function path(parent: MessageParent) {
  return `/messages/${parent.type}/${encodeURIComponent(parent.id)}`;
}

/**
 * The write guard's refusal: too many writes to one channel were waiting, and
 * nothing was written. It is the only 503 the message routes answer.
 */
const BUSY = statusError(503);
/** The refusal asks for a retry after a second; a burst clears in less. */
const BUSY_RETRY_MS = 1_000;
const BUSY_RETRIES = 2;

/**
 * The newest write in flight for each message or thread. A refused write is
 * sent again only while it is still that one: sent after a later write to the
 * same target, it would put its older content back over the later one.
 */
const NEWEST_WRITE = new Map<string, symbol>();

async function request<T extends object>(
  url: string,
  method = 'GET',
  body?: unknown,
  /** The message or thread a write changes; a new message has none. */
  target?: string
): Promise<T> {
  const init = {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  };
  const write = Symbol();
  if (target) NEWEST_WRITE.set(target, write);
  const isNewest = () => !target || NEWEST_WRITE.get(target) === write;
  try {
    let result = await dssFetch<T>(url, init);
    // Only a write is refused as busy; a read's 503 is not this refusal.
    const retries = method === 'GET' ? 0 : BUSY_RETRIES;
    for (let retry = 0; retry < retries && isBusy(result); retry += 1) {
      await sleep(BUSY_RETRY_MS);
      if (!isNewest()) break;
      result = await dssFetch<T>(url, init);
    }
    return await throwOnErr(() => Promise.resolve(result));
  } finally {
    if (target && isNewest()) NEWEST_WRITE.delete(target);
  }
}

function isBusy(result: Awaited<ReturnType<typeof dssFetch>>): boolean {
  return (
    result.isErr() &&
    result.error.some(
      (error) => error.code === BUSY.code && error.message === BUSY.message
    )
  );
}

export const entityMessagesClient = {
  list(parent: MessageParent, selection: MessageTimelineQuery = {}) {
    return request<MessageListPage>(
      `${path(parent)}?${new URLSearchParams({ selection: JSON.stringify(selection) })}`
    );
  },
  async timeline(
    parent: MessageParent,
    selection: MessageTimelineQuery = {}
  ): Promise<MessageTimelinePage> {
    const page = await request<ReceivedTimelinePage>(
      `${path(parent)}/timeline?${new URLSearchParams({ selection: JSON.stringify(selection) })}`
    );
    // Skip kinds this client can't render instead of failing the timeline;
    // the page's cursors still continue past them.
    return { ...page, entries: page.entries.filter(isKnownEntry) };
  },
  get(parent: MessageParent, id: string) {
    return request<Message>(`${path(parent)}/items/${encodeURIComponent(id)}`);
  },
  thread(parent: MessageParent, id: string) {
    return request<MessageThread>(
      `${path(parent)}/threads/${encodeURIComponent(id)}`
    );
  },
  post(parent: MessageParent, input: PostMessage) {
    return request<Message>(path(parent), 'POST', {
      ...input,
      nonce: input.nonce ?? crypto.randomUUID(),
    });
  },
  patch(parent: MessageParent, id: string, input: MessagePatch) {
    return request<Message>(
      `${path(parent)}/items/${encodeURIComponent(id)}`,
      'PATCH',
      { ...input, nonce: input.nonce ?? crypto.randomUUID() },
      id
    );
  },
  delete(parent: MessageParent, id: string, nonce?: string) {
    return request<Message>(
      `${path(parent)}/items/${encodeURIComponent(id)}${nonce ? `?nonce=${encodeURIComponent(nonce)}` : ''}`,
      'DELETE',
      undefined,
      id
    );
  },
  react(
    parent: MessageParent,
    id: string,
    emoji: string,
    add: boolean,
    nonce?: string
  ) {
    return request<Message>(
      `${path(parent)}/items/${encodeURIComponent(id)}/reactions`,
      'POST',
      { emoji, add, nonce },
      id
    );
  },
  patchThread(parent: MessageParent, rootId: string, patch: ThreadPatch) {
    return request<ThreadState>(
      `${path(parent)}/threads/${encodeURIComponent(rootId)}`,
      'PATCH',
      patch,
      rootId
    );
  },
  deleteThread(parent: MessageParent, rootId: string) {
    return request<ThreadState>(
      `${path(parent)}/threads/${encodeURIComponent(rootId)}`,
      'DELETE',
      undefined,
      rootId
    );
  },
  async typing(parent: MessageParent, rootId: string | null, active: boolean) {
    const result = await dssFetch(`${path(parent)}/typing`, {
      method: 'POST',
      body: JSON.stringify({ thread_id: rootId, active }),
    });
    if (result.isErr())
      throw new Error('Typing update failed', { cause: result.error });
  },
  legacyLink(parent: MessageParent, id: string, thread = false) {
    if (!/^\d+$/.test(id)) throw new Error('Invalid historical comment link');
    return request<Message>(`${path(parent)}/legacy/${id}?thread=${thread}`);
  },
};
