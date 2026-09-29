import { compareTimelinePositions } from '@core/util/message-timeline';
import { throwOnErr } from '@core/util/result';
import { dssFetch } from './client';
import type { Message as StoredMessage } from './generated/schemas/message';
import type { MessageCursor } from './generated/schemas/messageCursor';
import type { MessagePage } from './generated/schemas/messagePage';
import type { MessageParent } from './generated/schemas/messageParent';
import type { MessageThread as StoredMessageThread } from './generated/schemas/messageThread';
import type { PostMessage } from './generated/schemas/postMessage';
import type { ThreadPatch } from './generated/schemas/threadPatch';
import type { ThreadState } from './generated/schemas/threadState';
import type { TimelineActivity } from './generated/schemas/timelineActivity';

export type { MessageParent, PostMessage, ThreadPatch };
export type Message = StoredMessage & {
  sender?: import('./generated/schemas/apiMessageSender').ApiMessageSender;
};
export type MessageThread = Omit<StoredMessageThread, 'root' | 'replies'> & {
  root: Message;
  replies: Message[];
};
export type { MessagePatch } from './generated/schemas/messagePatch';
export type { MessageCursor };

import type { MessagePatch } from './generated/schemas/messagePatch';
export type MessageListItem =
  import('./generated/schemas/messageListItem').MessageListItem & {
    sender?: import('./generated/schemas/apiMessageSender').ApiMessageSender;
  };
export type MessageTimelineEntry =
  | { type: 'message'; message: MessageListItem }
  | { type: 'activity'; activity: TimelineActivity };
/** A page as the app reads it: messages and activity in one newest-first list. */
export type MessageTimelinePage = Omit<MessagePage, 'items' | 'activity'> & {
  entries: MessageTimelineEntry[];
};
export type { MessageTimelineQuery } from './generated/schemas/messageTimelineQuery';
export type { TimelineActivity };

import type { MessageTimelineQuery } from './generated/schemas/messageTimelineQuery';

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

/** Interleave the page's two newest-first lists by timeline position. */
export function toTimelinePage({
  items,
  activity = [],
  ...cursors
}: MessagePage): MessageTimelinePage {
  const messages = items.map(
    (message): MessageTimelineEntry => ({ type: 'message', message })
  );
  const entries: MessageTimelineEntry[] = [];
  let next = 0;
  for (const fact of activity) {
    const position = { id: fact.id, createdAt: fact.occurred_at };
    while (
      next < messages.length &&
      compareTimelinePositions(
        { id: items[next].id, createdAt: items[next].created_at },
        position
      ) > 0
    )
      entries.push(messages[next++]);
    entries.push({ type: 'activity', activity: fact });
  }
  entries.push(...messages.slice(next));
  return { ...cursors, entries };
}

export const entityMessagesClient = {
  async list(parent: MessageParent, selection: MessageTimelineQuery = {}) {
    return toTimelinePage(
      await request<MessagePage>(
        `${path(parent)}?${new URLSearchParams({ selection: JSON.stringify(selection) })}`
      )
    );
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
