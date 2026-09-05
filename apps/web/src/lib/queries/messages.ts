import { createReconnectEffect } from '@macro-inc/collaboration/websocket';
import {
  createConnectionWebsocketEffect,
  ws,
} from '@service-connection/websocket';
import {
  entityMessagesClient,
  type Message,
  type MessageParent,
  type MessageThread,
  type PostMessage,
} from '@service-storage/messages';
import { useQuery } from '@tanstack/solid-query';
import { type Accessor, createSignal, onCleanup } from 'solid-js';
import { queryClient } from './client';

export const messageKeys = {
  threads: (parent: MessageParent) =>
    ['entity-messages', parent.type, parent.id] as const,
};

export async function fetchMessageThreads(
  parent: MessageParent
): Promise<MessageThread[]> {
  const threads: MessageThread[] = [];
  let page = await entityMessagesClient.list(parent);
  threads.push(...page.threads);
  while (page.next_cursor) {
    page = await entityMessagesClient.list(parent, page.next_cursor);
    threads.push(...page.threads);
  }
  return threads;
}

export function messageThreadsOptions(parent: MessageParent) {
  return {
    queryKey: messageKeys.threads(parent),
    queryFn: () => fetchMessageThreads(parent),
  };
}

export function invalidateMessageThreads(parent: MessageParent) {
  return queryClient.invalidateQueries({
    queryKey: messageKeys.threads(parent),
  });
}

export function useMessageThreadsQuery(parent: Accessor<MessageParent>) {
  const query = useQuery(() => messageThreadsOptions(parent()));
  // BlockContainer owns the entity subscription and its heartbeat. Individual
  // discussion views must not close that subscription when they unmount.
  createConnectionWebsocketEffect((event) => {
    if (event.type !== 'message_update') return;
    let data;
    try {
      data =
        typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
    } catch {
      return;
    }
    const value = parent();
    if (data?.parent?.type !== value.type || data.parent.id !== value.id)
      return;
    if (data.change?.type !== 'typing') void invalidateMessageThreads(value);
  });
  createReconnectEffect(ws, () => void invalidateMessageThreads(parent()));
  return query;
}

function replaceMessage(parent: MessageParent, message: Message) {
  queryClient.setQueryData<MessageThread[]>(
    messageKeys.threads(parent),
    (threads) =>
      threads?.map((thread) => ({
        ...thread,
        root: thread.root.id === message.id ? message : thread.root,
        replies: thread.replies.map((reply) =>
          reply.id === message.id ? message : reply
        ),
      }))
  );
}

export function messageActions(parent: Accessor<MessageParent>) {
  return {
    async post(input: PostMessage) {
      const value = parent();
      const message = await entityMessagesClient.post(value, input);
      // Posting already committed. A failed read must not turn it into a failed send.
      try {
        const thread = await entityMessagesClient.thread(
          value,
          message.thread_id ?? message.id
        );
        queryClient.setQueryData<MessageThread[]>(
          messageKeys.threads(value),
          (threads = []) => {
            const result = threads.filter(
              (item) => item.state.root_id !== thread.state.root_id
            );
            result.push(thread);
            return result.sort(
              (a, b) =>
                a.state.created_at.localeCompare(b.state.created_at) ||
                a.state.root_id.localeCompare(b.state.root_id)
            );
          }
        );
      } catch {
        void invalidateMessageThreads(value);
      }
      return message;
    },
    async edit(
      id: string,
      input: Parameters<typeof entityMessagesClient.edit>[2]
    ) {
      const value = parent();
      const message = await entityMessagesClient.edit(value, id, input);
      replaceMessage(value, message);
      return message;
    },
    async delete(id: string) {
      const value = parent();
      const message = await entityMessagesClient.delete(value, id);
      replaceMessage(value, message);
      return message;
    },
    async react(id: string, emoji: string, active: boolean) {
      const value = parent();
      const message = await entityMessagesClient.react(
        value,
        id,
        emoji,
        active
      );
      replaceMessage(value, message);
      return message;
    },
    async resolve(rootId: string, resolved: boolean) {
      const value = parent();
      const state = await entityMessagesClient.resolve(value, rootId, resolved);
      queryClient.setQueryData<MessageThread[]>(
        messageKeys.threads(value),
        (threads) =>
          threads?.map((thread) =>
            thread.state.root_id === rootId ? { ...thread, state } : thread
          )
      );
      return state;
    },
    async deleteThread(rootId: string) {
      const value = parent();
      await entityMessagesClient.deleteThread(value, rootId);
      queryClient.setQueryData<MessageThread[]>(
        messageKeys.threads(value),
        (threads) =>
          threads?.filter((thread) => thread.state.root_id !== rootId)
      );
    },
  };
}

/** Resolve copied links, falling back to the root when the linked reply was deleted. */
export function useMessageLink(
  parent: Accessor<MessageParent>,
  target: Accessor<string | null | undefined>
) {
  const legacy = useQuery(() => ({
    queryKey: ['historical-comment-link', parent().type, parent().id, target()],
    enabled: !!target(),
    queryFn: () =>
      /^\d+$/.test(target()!)
        ? entityMessagesClient.legacyLink(parent(), target()!)
        : entityMessagesClient.get(parent(), target()!),
  }));
  return () => {
    const id = target();
    if (!id) return null;
    if (legacy.isSuccess)
      return legacy.data.deleted_at
        ? (legacy.data.thread_id ?? legacy.data.id)
        : legacy.data.id;
    return /^\d+$/.test(id) ? null : id;
  };
}

/** Ephemeral typing presence; expired events never become persisted query data. */
export function useMessageTyping(
  parent: Accessor<MessageParent>,
  currentUserId: Accessor<string | undefined>
) {
  const [typing, setTyping] = createSignal<
    { rootId: string; userId: string; expires: number }[]
  >([]);
  const timer = setInterval(
    () =>
      setTyping((users) => users.filter((user) => user.expires > Date.now())),
    1000
  );
  onCleanup(() => clearInterval(timer));
  createConnectionWebsocketEffect((event) => {
    if (event.type !== 'message_update') return;
    let data;
    try {
      data =
        typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
    } catch {
      return;
    }
    if (
      data?.parent?.type !== parent().type ||
      data.parent.id !== parent().id ||
      data.change?.type !== 'typing' ||
      typeof data.actor !== 'string' ||
      typeof data.root_id !== 'string' ||
      data.actor === currentUserId()
    )
      return;
    setTyping((users) => {
      const remaining = users.filter(
        (user) => user.rootId !== data.root_id || user.userId !== data.actor
      );
      return data.change.active
        ? [
            ...remaining,
            {
              rootId: data.root_id,
              userId: data.actor,
              expires: Date.now() + 8000,
            },
          ]
        : remaining;
    });
  });
  createReconnectEffect(ws, () => setTyping([]));
  return (rootId: string) =>
    typing()
      .filter((user) => user.rootId === rootId)
      .map((user) => user.userId);
}
