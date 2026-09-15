import { useUserId } from '@core/context/user';
import {
  entityMessagesClient,
  type MessageParent,
  type PostMessage,
} from '@service-storage/messages';
import { useQuery } from '@tanstack/solid-query';
import { type Accessor, createEffect } from 'solid-js';
import {
  useDeleteMessageMutation,
  useDeleteThreadMutation,
  usePatchThreadMutation,
  useSendMessageMutation,
} from './mutations';
import { useMessageTimelineQuery } from './timeline';

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
    /** True once the link is known to be a root, a reply, or nothing loadable. */
    resolved: () => !target() || legacy.isSuccess || legacy.isError,
  };
}
