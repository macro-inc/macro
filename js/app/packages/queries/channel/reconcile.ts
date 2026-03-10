import {
  getThreadPreviewReplySnapshot,
  getTopLevelMessageSnapshot,
  insertThreadReplyIntoChannelMessages,
  insertTopLevelMessageIntoChannelMessages,
  removeThreadReplyFromChannelMessages,
  removeTopLevelMessageFromChannelMessages,
  restoreThreadPreviewReplyInChannelMessages,
  restoreTopLevelMessageInChannelMessages,
  replaceThreadReplyIdInChannelMessages,
  replaceThreadReplyReactionsInChannelMessages,
  replaceTopLevelMessageIdInChannelMessages,
  replaceTopLevelMessageReactionsInChannelMessages,
  softInvalidateChannelMessages,
  type ChannelMessagesData,
  type ThreadPreviewReplySnapshot,
  type TopLevelMessageSnapshot,
} from './channel-messages';
import {
  getThreadReplySnapshot,
  insertThreadReply,
  removeThreadReply,
  restoreThreadReply,
  replaceThreadReplyId,
  replaceThreadReplyReactions,
  softInvalidateThreadReplies,
  type ThreadReplySnapshot,
} from './thread-replies';
import type {
  ApiChannelMessage,
  ApiThreadReply,
} from '@service-comms/client';
import type { CountedReaction } from '@service-comms/generated/models';
import { queryClient } from '../client';
import { channelKeys } from './keys';

export type MessageTarget =
  | {
    kind: 'top_level';
    messageId: string;
  }
  | {
    kind: 'thread_reply';
    messageId: string;
    threadId: string;
  };

export type DeleteTargetSnapshot =
  | {
    kind: 'top_level';
    message?: TopLevelMessageSnapshot;
  }
  | {
    kind: 'thread_reply';
    reply?: ThreadReplySnapshot;
    preview?: ThreadPreviewReplySnapshot;
  };

export function makeMessageTarget(args: {
  messageId: string;
  threadId?: string;
}): MessageTarget {
  if (args.threadId) {
    return {
      kind: 'thread_reply',
      messageId: args.messageId,
      threadId: args.threadId,
    };
  }

  return {
    kind: 'top_level',
    messageId: args.messageId,
  };
}

export function insertTargetMessage(
  channelId: string,
  target: MessageTarget,
  payload: ApiChannelMessage | ApiThreadReply
) {
  console.log(
    'insert target message',
    channelId,
    target,
    payload
      )
  if (target.kind === 'thread_reply') {
    queryClient.setQueryData<ChannelMessagesData>(
      channelKeys.messages(channelId).queryKey,
      (prev) =>
        insertThreadReplyIntoChannelMessages(
          prev,
          target.threadId,
          payload as ApiThreadReply
        )
    );
    queryClient.setQueryData<Array<ApiThreadReply>>(
      channelKeys.threadReplies(channelId, target.threadId).queryKey,
      (prev) => insertThreadReply(prev, payload as ApiThreadReply)
    );
  } else {
    queryClient.setQueryData<ChannelMessagesData>(
      channelKeys.messages(channelId).queryKey,
      (prev) =>
        insertTopLevelMessageIntoChannelMessages(prev, payload as ApiChannelMessage)
    );

  }

}

export function removeTargetMessage(channelId: string, target: MessageTarget) {
  if (target.kind === 'thread_reply') {
    queryClient.setQueryData<Array<ApiThreadReply>>(
      channelKeys.threadReplies(channelId, target.threadId).queryKey,
      (prev) => removeThreadReply(prev, target.messageId)
    );
    queryClient.setQueryData<ChannelMessagesData>(
      channelKeys.messages(channelId).queryKey,
      (prev) =>
        removeThreadReplyFromChannelMessages(
          prev,
          target.threadId,
          target.messageId
        )
    );
    return;
  }

  queryClient.setQueryData<ChannelMessagesData>(
    channelKeys.messages(channelId).queryKey,
    (prev) => removeTopLevelMessageFromChannelMessages(prev, target.messageId)
  );
}

export function captureDeleteTargetSnapshot(
  channelId: string,
  target: MessageTarget
): DeleteTargetSnapshot {
  if (target.kind === 'thread_reply') {
    return {
      kind: 'thread_reply',
      reply: getThreadReplySnapshot(
        queryClient.getQueryData<Array<ApiThreadReply>>(
          channelKeys.threadReplies(channelId, target.threadId).queryKey
        ),
        target.messageId
      ),
      preview: getThreadPreviewReplySnapshot(
        queryClient.getQueryData<ChannelMessagesData>(
          channelKeys.messages(channelId).queryKey
        ),
        target.threadId,
        target.messageId
      ),
    };
  }

  return {
    kind: 'top_level',
    message: getTopLevelMessageSnapshot(
      queryClient.getQueryData<ChannelMessagesData>(
        channelKeys.messages(channelId).queryKey
      ),
      target.messageId
    ),
  };
}

export function restoreTargetMessage(
  channelId: string,
  target: MessageTarget,
  snapshot: DeleteTargetSnapshot
) {
  if (target.kind === 'thread_reply') {
    queryClient.setQueryData<Array<ApiThreadReply>>(
      channelKeys.threadReplies(channelId, target.threadId).queryKey,
      (prev) =>
        snapshot.kind === 'thread_reply' && snapshot.reply
          ? restoreThreadReply(prev, snapshot.reply)
          : prev
    );
    queryClient.setQueryData<ChannelMessagesData>(
      channelKeys.messages(channelId).queryKey,
      (prev) =>
        snapshot.kind === 'thread_reply'
          ? restoreThreadPreviewReplyInChannelMessages(
            prev,
            target.threadId,
            snapshot.preview,
            snapshot.reply?.reply.created_at ?? snapshot.preview?.reply.created_at
          )
          : prev
    );
    return;
  }

  queryClient.setQueryData<ChannelMessagesData>(
    channelKeys.messages(channelId).queryKey,
    (prev) =>
      snapshot.kind === 'top_level' && snapshot.message
        ? restoreTopLevelMessageInChannelMessages(prev, snapshot.message)
        : prev
  );
}

export function replaceTargetMessageId(
  channelId: string,
  target: MessageTarget,
  realId: string
) {
  if (target.kind === 'thread_reply') {
    queryClient.setQueryData<Array<ApiThreadReply>>(
      channelKeys.threadReplies(channelId, target.threadId).queryKey,
      (prev) => replaceThreadReplyId(prev, target.messageId, realId)
    );
    queryClient.setQueryData<ChannelMessagesData>(
      channelKeys.messages(channelId).queryKey,
      (prev) =>
        replaceThreadReplyIdInChannelMessages(
          prev,
          target.threadId,
          target.messageId,
          realId
        )
    );
    return;
  }

  queryClient.setQueryData<ChannelMessagesData>(
    channelKeys.messages(channelId).queryKey,
    (prev) =>
      replaceTopLevelMessageIdInChannelMessages(prev, target.messageId, realId)
  );
}

export function replaceTargetReactions(
  channelId: string,
  target: MessageTarget,
  reactions: CountedReaction[]
) {
  if (target.kind === 'thread_reply') {
    queryClient.setQueryData<Array<ApiThreadReply>>(
      channelKeys.threadReplies(channelId, target.threadId).queryKey,
      (prev) => replaceThreadReplyReactions(prev, target.messageId, reactions)
    );
    queryClient.setQueryData<ChannelMessagesData>(
      channelKeys.messages(channelId).queryKey,
      (prev) =>
        replaceThreadReplyReactionsInChannelMessages(
          prev,
          target.threadId,
          target.messageId,
          reactions
        )
    );
    return;
  }

  queryClient.setQueryData<ChannelMessagesData>(
    channelKeys.messages(channelId).queryKey,
    (prev) =>
      replaceTopLevelMessageReactionsInChannelMessages(
        prev,
        target.messageId,
        reactions
      )
  );
}

export function softInvalidateTarget(channelId: string, target?: MessageTarget) {
  softInvalidateChannelMessages(channelId);

  if (target?.kind === 'thread_reply') {
    softInvalidateThreadReplies(channelId, target.threadId);
  }
}
