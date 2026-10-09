import { throwOnErr } from '@core/util/result';
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
export type MessageTimelineEntry =
  | { type: 'message'; message: MessageListItem }
  | { type: 'activity'; activity: TimelineActivity };
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
  return entry.type === 'message' || entry.type === 'activity';
}

function path(parent: MessageParent) {
  return `/messages/${parent.type}/${encodeURIComponent(parent.id)}`;
}

async function request<T extends object>(
  url: string,
  method = 'GET',
  body?: unknown
): Promise<T> {
  return throwOnErr(() =>
    dssFetch<T>(url, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
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
      { ...input, nonce: input.nonce ?? crypto.randomUUID() }
    );
  },
  delete(parent: MessageParent, id: string, nonce?: string) {
    return request<Message>(
      `${path(parent)}/items/${encodeURIComponent(id)}${nonce ? `?nonce=${encodeURIComponent(nonce)}` : ''}`,
      'DELETE'
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
      { emoji, add, nonce }
    );
  },
  patchThread(parent: MessageParent, rootId: string, patch: ThreadPatch) {
    return request<ThreadState>(
      `${path(parent)}/threads/${encodeURIComponent(rootId)}`,
      'PATCH',
      patch
    );
  },
  deleteThread(parent: MessageParent, rootId: string) {
    return request<ThreadState>(
      `${path(parent)}/threads/${encodeURIComponent(rootId)}`,
      'DELETE'
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
