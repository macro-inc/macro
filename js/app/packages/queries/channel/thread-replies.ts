import { throwOnErr } from '@core/util/maybeResult';
import { type ApiThreadReply, commsServiceClient } from '@service-comms/client';
import type { Attachment as ApiAttachment } from '@service-comms/generated/models';
import type { ApiCountedReaction } from '@service-storage/generated/schemas';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { channelKeys } from './keys';

export type ThreadReplySnapshot = {
  replyIndex: number;
  reply: ApiThreadReply;
};

export type ThreadRepliesQueryKey = ReturnType<
  typeof channelKeys.threadReplies
>['queryKey'];

export function threadRepliesQueryOptions(
  channelId: string,
  messageId: string
) {
  return {
    queryKey: channelKeys.threadReplies(channelId, messageId).queryKey,
    queryFn: async (): Promise<Array<ApiThreadReply>> => {
      return await throwOnErr(
        async () =>
          await commsServiceClient.getThreadReplies({
            channel_id: channelId,
            message_id: messageId,
          })
      );
    },
    staleTime: Infinity,
  };
}

export function useThreadRepliesQuery(
  channelId: Accessor<string>,
  messageId: Accessor<string>,
  enabled: Accessor<boolean>
) {
  return useQuery(() => ({
    ...threadRepliesQueryOptions(channelId(), messageId()),
    enabled: enabled(),
  }));
}

/** Returns the cache key for one thread replies query. */
export function getThreadRepliesQueryKey(
  channelId: string,
  messageId: string
): ThreadRepliesQueryKey {
  return channelKeys.threadReplies(channelId, messageId).queryKey;
}

/** Returns the shared prefix for all thread reply queries in a channel. */
export function getThreadRepliesQueryKeyPrefix(channelId: string) {
  return [...channelKeys.threadReplies._def, channelId];
}

/** Returns all cached thread reply query entries for a channel. */
export function getThreadRepliesEntries(channelId: string) {
  return queryClient.getQueriesData<Array<ApiThreadReply>>({
    queryKey: getThreadRepliesQueryKeyPrefix(channelId),
  });
}

export function insertThreadReply(
  data: Array<ApiThreadReply> | undefined,
  reply: ApiThreadReply
): Array<ApiThreadReply> | undefined {
  if (!data) return [reply];
  if (data.some((existingReply) => existingReply.id === reply.id)) {
    return data;
  }
  return [...data, reply];
}

export function removeThreadReply(
  data: Array<ApiThreadReply> | undefined,
  replyId: string
): Array<ApiThreadReply> | undefined {
  if (!data) return data;
  const nextReplies = data.filter((reply) => reply.id !== replyId);
  return nextReplies.length === data.length ? data : nextReplies;
}

export function replaceThreadReplyId(
  data: Array<ApiThreadReply> | undefined,
  optimisticId: string,
  realId: string
): Array<ApiThreadReply> | undefined {
  if (!data) return data;

  let didChange = false;
  const nextReplies = data.map((reply) => {
    if (reply.id !== optimisticId) return reply;
    didChange = true;
    return { ...reply, id: realId };
  });

  return didChange ? nextReplies : data;
}

export function replaceThreadReplyReactions(
  data: Array<ApiThreadReply> | undefined,
  replyId: string,
  reactions: ApiCountedReaction[]
): Array<ApiThreadReply> | undefined {
  if (!data) return data;

  let didChange = false;
  const nextReplies = data.map((reply) => {
    if (reply.id !== replyId) return reply;
    didChange = true;
    return { ...reply, reactions };
  });

  return didChange ? nextReplies : data;
}

/** Replaces attachments on one cached thread reply. */
export function replaceThreadReplyAttachments(
  data: Array<ApiThreadReply> | undefined,
  replyId: string,
  attachments: ApiAttachment[]
): Array<ApiThreadReply> | undefined {
  if (!data) return data;

  let didChange = false;
  const nextReplies = data.map((reply) => {
    if (reply.id !== replyId) return reply;
    didChange = true;
    return { ...reply, attachments };
  });

  return didChange ? nextReplies : data;
}

export function getThreadReplySnapshot(
  data: Array<ApiThreadReply> | undefined,
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
  data: Array<ApiThreadReply> | undefined,
  snapshot: ThreadReplySnapshot
): Array<ApiThreadReply> | undefined {
  if (!data) return [snapshot.reply];
  if (data.some((reply) => reply.id === snapshot.reply.id)) {
    return data;
  }

  const nextReplies = [...data];
  nextReplies.splice(snapshot.replyIndex, 0, snapshot.reply);
  return nextReplies;
}

export function softInvalidateThreadReplies(
  channelId: string,
  messageId: string
) {
  queryClient.invalidateQueries({
    queryKey: getThreadRepliesQueryKey(channelId, messageId),
    refetchType: 'inactive',
  });
}
