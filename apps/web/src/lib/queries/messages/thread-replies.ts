import type {
  Message as EntityMessage,
  MessageParent,
} from '@service-storage/messages';
import {
  entityMessagesClient,
  type MessageThread,
} from '@service-storage/messages';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { messageKeys } from './keys';
import { useMessageSubscription } from './subscription';

export type ThreadReplySnapshot = {
  replyIndex: number;
  reply: EntityMessage;
};

type ThreadRepliesQueryKey = ReturnType<
  typeof messageKeys.threadReplies
>['queryKey'];

export function threadRepliesQueryOptions(
  parent: MessageParent,
  messageId: string
) {
  return {
    queryKey: messageKeys.threadReplies(parent, messageId).queryKey,
    queryFn: () => entityMessagesClient.thread(parent, messageId),
    staleTime: Infinity,
  };
}

export function useThreadRepliesQuery(
  parent: Accessor<MessageParent>,
  messageId: Accessor<string>,
  enabled: Accessor<boolean>
) {
  useMessageSubscription(parent);
  return useQuery(() => ({
    ...threadRepliesQueryOptions(parent(), messageId()),
    enabled: enabled(),
    select: (thread: MessageThread) => thread.replies,
  }));
}

/** Returns the cache key for one thread replies query. */
export function getThreadRepliesQueryKey(
  parent: MessageParent,
  messageId: string
): ThreadRepliesQueryKey {
  return messageKeys.threadReplies(parent, messageId).queryKey;
}

/** Returns the shared prefix for all thread reply queries in a channel. */
function getThreadRepliesQueryKeyPrefix(parent: MessageParent) {
  return [...messageKeys.threadReplies._def, parent];
}

/** Returns all cached thread reply query entries for a channel. */
export function getThreadRepliesEntries(parent: MessageParent) {
  return queryClient
    .getQueriesData<MessageThread>({
      queryKey: getThreadRepliesQueryKeyPrefix(parent),
    })
    .map(([key, thread]) => [key, thread?.replies] as const);
}

export function insertThreadReply(
  data: Array<EntityMessage> | undefined,
  reply: EntityMessage
): Array<EntityMessage> | undefined {
  if (!data) return [reply];
  if (data.some((existingReply) => existingReply.id === reply.id)) {
    return data;
  }
  return [...data, reply];
}

export function removeThreadReply(
  data: Array<EntityMessage> | undefined,
  replyId: string
): Array<EntityMessage> | undefined {
  if (!data) return data;
  const nextReplies = data.filter((reply) => reply.id !== replyId);
  return nextReplies.length === data.length ? data : nextReplies;
}

export function replaceThreadReplyId(
  data: Array<EntityMessage> | undefined,
  optimisticId: string,
  realId: string
): Array<EntityMessage> | undefined {
  if (!data) return data;

  let didChange = false;
  const nextReplies = data.map((reply) => {
    if (reply.id !== optimisticId) return reply;
    didChange = true;
    return { ...reply, id: realId };
  });

  return didChange ? nextReplies : data;
}

export function getThreadReplySnapshot(
  data: Array<EntityMessage> | undefined,
  replyId: string
): ThreadReplySnapshot | undefined {
  if (!data) return undefined;

  const replyIndex = data.findIndex((reply) => reply.id === replyId);
  if (replyIndex === -1) return undefined;

  return {
    replyIndex,
    reply: data[replyIndex],
  };
}

export function restoreThreadReply(
  data: Array<EntityMessage> | undefined,
  snapshot: ThreadReplySnapshot
): Array<EntityMessage> | undefined {
  if (!data) return [snapshot.reply];
  if (data.some((reply) => reply.id === snapshot.reply.id)) {
    return data;
  }

  const nextReplies = [...data];
  nextReplies.splice(snapshot.replyIndex, 0, snapshot.reply);
  return nextReplies;
}

export function softInvalidateThreadReplies(
  parent: MessageParent,
  messageId: string
) {
  queryClient.invalidateQueries({
    queryKey: getThreadRepliesQueryKey(parent, messageId),
    refetchType: 'inactive',
  });
}

/** Update replies while retaining the canonical root and thread state in the same cache entry. */
export function setThreadRepliesData(
  parent: MessageParent,
  root: string,
  update: (replies: EntityMessage[] | undefined) => EntityMessage[] | undefined
) {
  queryClient.setQueryData<MessageThread>(
    getThreadRepliesQueryKey(parent, root),
    (thread) =>
      thread ? { ...thread, replies: update(thread.replies) ?? [] } : undefined
  );
}
export function getThreadRepliesData(parent: MessageParent, root: string) {
  return queryClient.getQueryData<MessageThread>(
    getThreadRepliesQueryKey(parent, root)
  )?.replies;
}

/** The same thread cache backs linked drawers, anchor overlays, and expanded timelines. */
export function useMessageThreadQuery(
  parent: Accessor<MessageParent>,
  rootId: Accessor<string>
) {
  useMessageSubscription(parent);
  return useQuery(() => threadRepliesQueryOptions(parent(), rootId()));
}
