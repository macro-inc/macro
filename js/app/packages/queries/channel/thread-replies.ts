import { throwOnErr } from '@core/util/maybeResult';
import {
  type ApiThreadReply,
  commsServiceClient,
} from '@service-comms/client';
import type { Attachment as ApiAttachment } from '@service-comms/generated/models';
import type { ApiCountedReaction } from '@service-storage/generated/schemas';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { channelKeys } from './keys';
import {
  captureItemSnapshotById,
  insertItemIfMissing,
  removeItemById,
  replaceItemId,
  restoreItemSnapshot,
} from './list-ops';

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

export function getThreadRepliesQueryKey(
  channelId: string,
  messageId: string
): ThreadRepliesQueryKey {
  return channelKeys.threadReplies(channelId, messageId).queryKey;
}

export function getThreadRepliesQueryKeyPrefix(channelId: string) {
  return [...channelKeys.threadReplies._def, channelId];
}

export function getThreadRepliesEntries(channelId: string) {
  return queryClient.getQueriesData<Array<ApiThreadReply>>({
    queryKey: getThreadRepliesQueryKeyPrefix(channelId),
  });
}

export function insertThreadReply(
  data: Array<ApiThreadReply> | undefined,
  reply: ApiThreadReply
): Array<ApiThreadReply> | undefined {
  return insertItemIfMissing(data, reply);
}

export function removeThreadReply(
  data: Array<ApiThreadReply> | undefined,
  replyId: string
): Array<ApiThreadReply> | undefined {
  return removeItemById(data, replyId);
}

export function replaceThreadReplyId(
  data: Array<ApiThreadReply> | undefined,
  optimisticId: string,
  realId: string
): Array<ApiThreadReply> | undefined {
  return replaceItemId(data, optimisticId, realId);
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
  const snapshot = captureItemSnapshotById(data, replyId);
  if (!snapshot) return undefined;

  return {
    replyIndex: snapshot.index,
    reply: snapshot.item,
  };
}

export function restoreThreadReply(
  data: Array<ApiThreadReply> | undefined,
  snapshot: ThreadReplySnapshot
): Array<ApiThreadReply> | undefined {
  return restoreItemSnapshot(data, {
    index: snapshot.replyIndex,
    item: snapshot.reply,
  });
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
