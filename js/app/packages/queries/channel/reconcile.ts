import {
  findThreadIdInChannelMessages,
  findThreadPreviewReplySnapshotInChannelMessages,
  findTopLevelMessageSnapshotInChannelMessages,
  insertThreadReplyIntoChannelMessages,
  insertTopLevelMessageIntoChannelMessages,
  removeThreadReplyFromChannelMessages,
  removeTopLevelMessageFromChannelMessages,
  replaceThreadReplyStateInChannelMessages,
  replaceTopLevelMessageStateInChannelMessages,
  restoreThreadPreviewReplyInChannelMessages,
  restoreTopLevelMessageInChannelMessages,
  replaceThreadReplyIdInChannelMessages,
  replaceThreadReplyReactionsInChannelMessages,
  replaceThreadReplyAttachmentsInChannelMessages,
  replaceTopLevelMessageIdInChannelMessages,
  replaceTopLevelMessageReactionsInChannelMessages,
  replaceTopLevelMessageAttachmentsInChannelMessages,
  setChannelMessagesData,
  softInvalidateChannelMessages,
  type ThreadPreviewReplySnapshot,
  type TopLevelMessageSnapshot,
} from './channel-messages';
import {
  getThreadRepliesEntries,
  getThreadRepliesQueryKey,
  getThreadReplySnapshot,
  insertThreadReply,
  removeThreadReply,
  replaceThreadReplyState,
  restoreThreadReply,
  replaceThreadReplyId,
  replaceThreadReplyReactions,
  replaceThreadReplyAttachments,
  softInvalidateThreadReplies,
  type ThreadReplySnapshot,
} from './thread-replies';
import type { ApiChannelMessage, ApiThreadReply } from '@service-comms/client';
import type {
  Attachment as ApiAttachment,
  CountedReaction,
} from '@service-comms/generated/models';
import type { ApiMessageAttachment } from '@service-storage/generated/schemas/apiMessageAttachment';
import { queryClient } from '../client';

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

export type TargetMessageState = {
  content: string;
  editedAt: string | null | undefined;
  updatedAt: string;
  attachments: ApiMessageAttachment[];
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

/** Finds a reply's parent thread id from cached channel data. */
export function findThreadIdForMessage(
  channelId: string,
  messageId: string
): string | undefined {
  const directThreadId = findThreadIdInChannelMessages(channelId, messageId);
  if (directThreadId) return directThreadId;

  for (const [queryKey, replies] of getThreadRepliesEntries(channelId)) {
    if (!replies?.some((reply) => reply.id === messageId)) continue;
    return queryKey.at(-1) as string | undefined;
  }

  return undefined;
}

/** Resolves whether a message target is top-level or a thread reply. */
export function resolveMessageTarget(args: {
  channelId: string;
  messageId: string;
  threadId?: string;
}): MessageTarget {
  if (args.threadId) {
    return makeMessageTarget({
      messageId: args.messageId,
      threadId: args.threadId,
    });
  }

  const threadId = findThreadIdForMessage(args.channelId, args.messageId);
  if (threadId) {
    return makeMessageTarget({
      messageId: args.messageId,
      threadId,
    });
  }

  return makeMessageTarget({
    messageId: args.messageId,
  });
}

/** Inserts a message into the rendered caches for its target. */
export function insertMessageIntoTargetCaches(
  channelId: string,
  target: MessageTarget,
  payload: ApiChannelMessage | ApiThreadReply
) {
  if (target.kind === 'thread_reply') {
    setChannelMessagesData(channelId, (prev) =>
      insertThreadReplyIntoChannelMessages(
        prev,
        target.threadId,
        payload as ApiThreadReply
      )
    );
    queryClient.setQueryData<Array<ApiThreadReply>>(
      getThreadRepliesQueryKey(channelId, target.threadId),
      (prev) => insertThreadReply(prev, payload as ApiThreadReply)
    );
    return;
  }

  setChannelMessagesData(channelId, (prev) =>
    insertTopLevelMessageIntoChannelMessages(prev, payload as ApiChannelMessage)
  );
}

/** Removes a message from the rendered caches for its target. */
export function removeMessageFromTargetCaches(
  channelId: string,
  target: MessageTarget
) {
  if (target.kind === 'thread_reply') {
    queryClient.setQueryData<Array<ApiThreadReply>>(
      getThreadRepliesQueryKey(channelId, target.threadId),
      (prev) => removeThreadReply(prev, target.messageId)
    );
    setChannelMessagesData(channelId, (prev) =>
      removeThreadReplyFromChannelMessages(
        prev,
        target.threadId,
        target.messageId
      )
    );
    return;
  }

  setChannelMessagesData(channelId, (prev) =>
    removeTopLevelMessageFromChannelMessages(prev, target.messageId)
  );
}

/** Captures rollback snapshots for a target before optimistic delete. */
export function captureDeleteSnapshotForTarget(
  channelId: string,
  target: MessageTarget
): DeleteTargetSnapshot {
  if (target.kind === 'thread_reply') {
    return {
      kind: 'thread_reply',
      reply: getThreadReplySnapshot(
        queryClient.getQueryData<Array<ApiThreadReply>>(
          getThreadRepliesQueryKey(channelId, target.threadId)
        ),
        target.messageId
      ),
      preview: findThreadPreviewReplySnapshotInChannelMessages(
        channelId,
        target.threadId,
        target.messageId
      ),
    };
  }

  return {
    kind: 'top_level',
    message: findTopLevelMessageSnapshotInChannelMessages(
      channelId,
      target.messageId
    ),
  };
}

/** Restores a previously captured target snapshot into rendered caches. */
export function restoreMessageInTargetCaches(
  channelId: string,
  target: MessageTarget,
  snapshot: DeleteTargetSnapshot
) {
  if (target.kind === 'thread_reply') {
    queryClient.setQueryData<Array<ApiThreadReply>>(
      getThreadRepliesQueryKey(channelId, target.threadId),
      (prev) =>
        snapshot.kind === 'thread_reply' && snapshot.reply
          ? restoreThreadReply(prev, snapshot.reply)
          : prev
    );
    setChannelMessagesData(channelId, (prev) =>
      snapshot.kind === 'thread_reply'
        ? restoreThreadPreviewReplyInChannelMessages(
            prev,
            target.threadId,
            snapshot.preview,
            snapshot.reply?.reply.created_at ??
              snapshot.preview?.reply.created_at
          )
        : prev
    );
    return;
  }

  setChannelMessagesData(channelId, (prev) =>
    snapshot.kind === 'top_level' && snapshot.message
      ? restoreTopLevelMessageInChannelMessages(prev, snapshot.message)
      : prev
  );
}

/** Replaces a target message id across all rendered caches. */
export function replaceTargetMessageId(
  channelId: string,
  target: MessageTarget,
  realId: string
) {
  if (target.kind === 'thread_reply') {
    queryClient.setQueryData<Array<ApiThreadReply>>(
      getThreadRepliesQueryKey(channelId, target.threadId),
      (prev) => replaceThreadReplyId(prev, target.messageId, realId)
    );
    setChannelMessagesData(channelId, (prev) =>
      replaceThreadReplyIdInChannelMessages(
        prev,
        target.threadId,
        target.messageId,
        realId
      )
    );
    return;
  }

  setChannelMessagesData(channelId, (prev) =>
    replaceTopLevelMessageIdInChannelMessages(prev, target.messageId, realId)
  );
}

/** Replaces reactions for a target message across all rendered caches. */
export function replaceTargetReactions(
  channelId: string,
  target: MessageTarget,
  reactions: CountedReaction[]
) {
  if (target.kind === 'thread_reply') {
    queryClient.setQueryData<Array<ApiThreadReply>>(
      getThreadRepliesQueryKey(channelId, target.threadId),
      (prev) => replaceThreadReplyReactions(prev, target.messageId, reactions)
    );
    setChannelMessagesData(channelId, (prev) =>
      replaceThreadReplyReactionsInChannelMessages(
        prev,
        target.threadId,
        target.messageId,
        reactions
      )
    );
    return;
  }

  setChannelMessagesData(channelId, (prev) =>
    replaceTopLevelMessageReactionsInChannelMessages(
      prev,
      target.messageId,
      reactions
    )
  );
}

/** Replaces attachments for a target message across all rendered caches. */
export function replaceTargetAttachments(
  channelId: string,
  target: MessageTarget,
  attachments: ApiAttachment[]
) {
  if (target.kind === 'thread_reply') {
    queryClient.setQueryData<Array<ApiThreadReply>>(
      getThreadRepliesQueryKey(channelId, target.threadId),
      (prev) =>
        replaceThreadReplyAttachments(prev, target.messageId, attachments)
    );
    setChannelMessagesData(channelId, (prev) =>
      replaceThreadReplyAttachmentsInChannelMessages(
        prev,
        target.threadId,
        target.messageId,
        attachments
      )
    );
    return;
  }

  setChannelMessagesData(channelId, (prev) =>
    replaceTopLevelMessageAttachmentsInChannelMessages(
      prev,
      target.messageId,
      attachments
    )
  );
}

export function getTargetMessageState(
  channelId: string,
  target: MessageTarget
): TargetMessageState | undefined {
  if (target.kind === 'thread_reply') {
    const reply =
      queryClient
        .getQueryData<Array<ApiThreadReply>>(
          getThreadRepliesQueryKey(channelId, target.threadId)
        )
        ?.find((item) => item.id === target.messageId) ??
      findThreadPreviewReplySnapshotInChannelMessages(
        channelId,
        target.threadId,
        target.messageId
      )?.reply;

    if (!reply) return;

    return {
      content: reply.content,
      editedAt: reply.edited_at,
      updatedAt: reply.updated_at,
      attachments: reply.attachments,
    };
  }

  const message = findTopLevelMessageSnapshotInChannelMessages(
    channelId,
    target.messageId
  )?.message;
  if (!message) return;

  return {
    content: message.content,
    editedAt: message.edited_at,
    updatedAt: message.updated_at,
    attachments: message.attachments,
  };
}

export function replaceTargetMessageState(
  channelId: string,
  target: MessageTarget,
  nextState: TargetMessageState
) {
  if (target.kind === 'thread_reply') {
    queryClient.setQueryData<Array<ApiThreadReply>>(
      getThreadRepliesQueryKey(channelId, target.threadId),
      (prev) => replaceThreadReplyState(prev, target.messageId, nextState)
    );
    setChannelMessagesData(channelId, (prev) =>
      replaceThreadReplyStateInChannelMessages(
        prev,
        target.threadId,
        target.messageId,
        nextState
      )
    );
    return;
  }

  setChannelMessagesData(channelId, (prev) =>
    replaceTopLevelMessageStateInChannelMessages(
      prev,
      target.messageId,
      nextState
    )
  );
}

/** Soft-invalidates the rendered caches touched by a target message. */
export function softInvalidateTargetCaches(
  channelId: string,
  target?: MessageTarget
) {
  softInvalidateChannelMessages(channelId);

  if (target?.kind === 'thread_reply') {
    softInvalidateThreadReplies(channelId, target.threadId);
  }
}
