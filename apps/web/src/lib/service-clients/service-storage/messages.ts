import { dssFetch } from './client';
import type { EditMessage } from './generated/schemas/editMessage';
import type { Message } from './generated/schemas/message';
import type { MessageCursor } from './generated/schemas/messageCursor';
import type { MessageParent } from './generated/schemas/messageParent';
import type { MessageThread } from './generated/schemas/messageThread';
import type { PostMessage } from './generated/schemas/postMessage';
import type { ReferencedThreadPage } from './generated/schemas/referencedThreadPage';
import type { ThreadPage } from './generated/schemas/threadPage';
import type { ThreadState } from './generated/schemas/threadState';

export type { Message, MessageParent, MessageThread, PostMessage };

function path(parent: MessageParent) {
  return `/messages/${parent.type}/${encodeURIComponent(parent.id)}`;
}

async function request<T extends object>(
  url: string,
  method = 'GET',
  body?: unknown
): Promise<T> {
  const result = await dssFetch<T>(url, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (result.isErr())
    throw new Error('Message request failed', { cause: result.error });
  return result.value;
}

export const entityMessagesClient = {
  list(parent: MessageParent, cursor?: MessageCursor | null) {
    const query = new URLSearchParams({ limit: '100' });
    if (cursor) {
      query.set('created_at', cursor.created_at);
      query.set('cursor_id', cursor.id);
    }
    return request<ThreadPage>(`${path(parent)}?${query}`);
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
  edit(parent: MessageParent, id: string, input: EditMessage) {
    return request<Message>(
      `${path(parent)}/items/${encodeURIComponent(id)}`,
      'PATCH',
      { ...input, nonce: input.nonce ?? crypto.randomUUID() }
    );
  },
  delete(parent: MessageParent, id: string) {
    return request<Message>(
      `${path(parent)}/items/${encodeURIComponent(id)}`,
      'DELETE'
    );
  },
  react(parent: MessageParent, id: string, emoji: string, add: boolean) {
    return request<Message>(
      `${path(parent)}/items/${encodeURIComponent(id)}/reactions`,
      'POST',
      { emoji, add }
    );
  },
  resolve(parent: MessageParent, rootId: string, resolved: boolean) {
    return request<ThreadState>(
      `${path(parent)}/threads/${encodeURIComponent(rootId)}`,
      'PATCH',
      { resolved }
    );
  },
  deleteThread(parent: MessageParent, rootId: string) {
    return request<ThreadState>(
      `${path(parent)}/threads/${encodeURIComponent(rootId)}`,
      'DELETE'
    );
  },
  async typing(parent: MessageParent, rootId: string, active: boolean) {
    const result = await dssFetch(
      `${path(parent)}/threads/${encodeURIComponent(rootId)}/typing`,
      {
        method: 'POST',
        body: JSON.stringify({ active }),
      }
    );
    if (result.isErr())
      throw new Error('Typing update failed', { cause: result.error });
  },
  legacyLink(parent: MessageParent, id: string, thread = false) {
    if (!/^\d+$/.test(id)) throw new Error('Invalid historical comment link');
    return request<Message>(`${path(parent)}/legacy/${id}?thread=${thread}`);
  },
};
