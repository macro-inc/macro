import { useUserId } from '@core/context/user';
import { createReconnectEffect } from '@macro-inc/collaboration/websocket';
import {
  createConnectionWebsocketEffect,
  ws,
} from '@service-connection/websocket';
import type { ReferencedThread } from '@service-storage/generated/schemas/referencedThread';
import {
  entityMessagesClient,
  type MessageParent,
  type PostMessage,
} from '@service-storage/messages';
import { useQuery } from '@tanstack/solid-query';
import { type Accessor, createEffect } from 'solid-js';
import { queryClient } from './client';
import {
  useDeleteMessageMutation,
  useDeleteThreadMutation,
  usePatchThreadMutation,
  useSendMessageMutation,
} from './messages/mutations';
import { useMessageTimelineQuery } from './messages/timeline';

export { useMessageThreadQuery } from './messages/thread-replies';

/** Positioning annotations needs every root, but never fetches every root's replies. */
export function useMessageRootsQuery(parent: Accessor<MessageParent>) {
  const query = useMessageTimelineQuery(parent, () => null);
  createEffect(() => {
    if (
      query.isSuccess &&
      query.hasNextPage &&
      !query.isFetching &&
      !query.isFetchNextPageError
    )
      void query.fetchNextPage();
  });
  return {
    get data() {
      return query.isSuccess
        ? query.data.pages.flatMap((page) => page.items)
        : [];
    },
    get isSuccess() {
      return query.isSuccess;
    },
    get isPending() {
      return query.isPending;
    },
    get isError() {
      return query.isError;
    },
    refetch: query.refetch,
  };
}

/** Bind the shared mutations to an annotation editor's parent. */
export function useMessageActions(parent: Accessor<MessageParent>) {
  const userId = useUserId();
  const send = useSendMessageMutation();
  const remove = useDeleteMessageMutation();
  const patchThread = usePatchThreadMutation();
  const removeThread = useDeleteThreadMutation();
  return {
    post: (message: PostMessage) => {
      const senderId = userId();
      if (!senderId) throw new Error('Sign in to comment');
      return send.mutateAsync({
        parent: parent(),
        message,
        senderId,
        optimisticId: crypto.randomUUID(),
      });
    },
    delete: (id: string) =>
      remove.mutateAsync({ parent: parent(), messageID: id }),
    resolve: (rootId: string, resolved: boolean) =>
      patchThread.mutateAsync({
        parent: parent(),
        rootId,
        patch: { resolved },
      }),
    deleteThread: (rootId: string) =>
      removeThread.mutateAsync({ parent: parent(), rootId }),
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
  return {
    messageId: () => {
      const id = target();
      if (!id) return null;
      if (legacy.isSuccess)
        return legacy.data.deleted_at
          ? (legacy.data.thread_id ?? legacy.data.id)
          : legacy.data.id;
      return /^\d+$/.test(id) ? null : id;
    },
    rootId: () =>
      legacy.isSuccess ? (legacy.data.thread_id ?? legacy.data.id) : null,
  };
}

/** Optional, permission-filtered source threads; source messages remain channel-owned. */
export function useChannelReferenceThreadsQuery(
  parent: Accessor<MessageParent>,
  enabled: Accessor<boolean>
) {
  const key = () => ['entity-message-references', parent().id] as const;
  const query = useQuery(() => ({
    queryKey: key(),
    enabled: enabled() && parent().type === 'document',
    refetchInterval: enabled() ? 30_000 : false,
    queryFn: async () => {
      const threads: ReferencedThread[] = [];
      let page = await entityMessagesClient.references(parent());
      threads.push(...page.threads);
      while (page.next_cursor) {
        page = await entityMessagesClient.references(
          parent(),
          page.next_cursor
        );
        threads.push(...page.threads);
      }
      return threads;
    },
  }));
  const invalidate = () => {
    if (enabled()) void queryClient.invalidateQueries({ queryKey: key() });
  };
  createConnectionWebsocketEffect((event) => {
    if (event.type.startsWith('channel_')) {
      invalidate();
      return;
    }
    if (event.type !== 'message_update') return;
    try {
      const data =
        typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      if (
        data?.parent?.type === 'channel' &&
        ['posted', 'edited', 'message_deleted', 'thread_updated'].includes(
          data.change?.type
        )
      ) {
        invalidate();
      }
    } catch {
      // Malformed live frames cannot change reference discovery.
    }
  });
  createReconnectEffect(ws, invalidate);
  return query;
}
