import { throwOnErr } from '@core/util/result';
import { dssFetch } from './client';
import type { Message as StoredMessage } from './generated/schemas/message';
import type { MessageCursor } from './generated/schemas/messageCursor';
import type { MessageParent } from './generated/schemas/messageParent';
import type { MessageThread } from './generated/schemas/messageThread';
import type { PostMessage } from './generated/schemas/postMessage';
import type { ReferencedThreadPage } from './generated/schemas/referencedThreadPage';
import type { ThreadPatch } from './generated/schemas/threadPatch';
import type { ThreadState } from './generated/schemas/threadState';

export type { MessageParent, MessageThread, PostMessage, ThreadPatch };
export type Message = StoredMessage & {
  sender?: import('./generated/schemas/apiMessageSender').ApiMessageSender;
};
export type { MessagePatch } from './generated/schemas/messagePatch';
export type { MessageCursor };

import type { MessagePatch } from './generated/schemas/messagePatch';
export type MessageListItem =
  import('./generated/schemas/messageListItem').MessageListItem & {
    sender?: import('./generated/schemas/apiMessageSender').ApiMessageSender;
  };
export type MessageTimelinePage = Omit<
  import('./generated/schemas/messagePage').MessagePage,
  'items'
> & { items: MessageListItem[] };
export type { MessageTimelineQuery } from './generated/schemas/messageTimelineQuery';

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

export const entityMessagesClient = {
  list(parent: MessageParent, selection: MessageTimelineQuery = {}) {
    return request<MessageTimelinePage>(
      `${path(parent)}?${new URLSearchParams({ selection: JSON.stringify(selection) })}`
    );
  },
  references(parent: MessageParent, cursor?: MessageCursor | null) {
    const query = new URLSearchParams({ limit: '100' });
    if (cursor) {
      query.set('created_at', cursor.created_at);
      query.set('cursor_id', cursor.id);
    }
    return request<ReferencedThreadPage>(`${path(parent)}/references?${query}`);
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
