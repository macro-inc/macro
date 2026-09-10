import type {
  Message as EntityMessage,
  MessageListItem,
  MessageParent,
  MessageThread,
} from '@service-storage/messages';
import { queryClient } from '../client';
import {
  getThreadRepliesData,
  getThreadRepliesEntries,
  getThreadRepliesQueryKey,
  getThreadReplySnapshot,
  insertThreadReply,
  removeThreadReply,
  replaceThreadReplyId,
  restoreThreadReply,
  setThreadRepliesData,
  softInvalidateThreadReplies,
  type ThreadReplySnapshot,
} from './thread-replies';
import {
  findThreadIdInMessageTimeline,
  findThreadPreviewReplySnapshotInMessageTimeline,
  findTopLevelMessageSnapshotInMessageTimeline,
  insertThreadReplyIntoMessageTimeline,
  insertTopLevelMessageIntoMessageTimeline,
  removeThreadReplyFromMessageTimeline,
  removeTopLevelMessageFromMessageTimeline,
  replaceThreadReplyIdInMessageTimeline,
  replaceTopLevelMessageIdInMessageTimeline,
  restoreThreadPreviewReplyInMessageTimeline,
  restoreTopLevelMessageInMessageTimeline,
  setMessageTimelineData,
  softInvalidateMessageTimeline,
  softInvalidateMessageTimelineByIds,
  type ThreadPreviewReplySnapshot,
  type TopLevelMessageSnapshot,
} from './timeline';

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

/** Finds a reply's parent thread id from cached channel data. */
function findThreadIdForMessage(
  parent: MessageParent,
  messageId: string
): string | undefined {
  const directThreadId = findThreadIdInMessageTimeline(parent, messageId);
  if (directThreadId) return directThreadId;

  for (const [queryKey, replies] of getThreadRepliesEntries(parent)) {
    if (!replies?.some((reply) => reply.id === messageId)) continue;
    return queryKey.at(-1) as string | undefined;
  }

  return undefined;
}

/** Resolves whether a message target is top-level or a thread reply. */
export function resolveMessageTarget(args: {
  parent: MessageParent;
  messageId: string;
  threadId?: string;
}): MessageTarget {
  const threadId =
    args.threadId ?? findThreadIdForMessage(args.parent, args.messageId);
  return threadId
    ? { kind: 'thread_reply', messageId: args.messageId, threadId }
    : { kind: 'top_level', messageId: args.messageId };
}

/** Inserts a message into the rendered caches for its target. */
export function insertMessageIntoTargetCaches(
  parent: MessageParent,
  target: MessageTarget,
  payload: MessageListItem | EntityMessage
) {
  if (target.kind === 'thread_reply') {
    setMessageTimelineData(parent, (prev) =>
      insertThreadReplyIntoMessageTimeline(
        prev,
        target.threadId,
        payload as EntityMessage
      )
    );
    setThreadRepliesData(parent, target.threadId, (prev) =>
      insertThreadReply(prev, payload as EntityMessage)
    );
    return;
  }

  setMessageTimelineData(parent, (prev) =>
    insertTopLevelMessageIntoMessageTimeline(prev, payload as MessageListItem)
  );
}

/** Removes a message from the rendered caches for its target. */
export function removeMessageFromTargetCaches(
  parent: MessageParent,
  target: MessageTarget
) {
  if (target.kind === 'thread_reply') {
    setThreadRepliesData(parent, target.threadId, (prev) =>
      removeThreadReply(prev, target.messageId)
    );
    setMessageTimelineData(parent, (prev) =>
      removeThreadReplyFromMessageTimeline(
        prev,
        target.threadId,
        target.messageId
      )
    );
    return;
  }

  setMessageTimelineData(parent, (prev) =>
    removeTopLevelMessageFromMessageTimeline(prev, target.messageId)
  );
}

/**
 * Marks a top-level message as soft-deleted in the rendered caches.
 * Pass `undefined` (or `null`) to clear the soft-delete (used for rollback).
 *
 * Reply deletion removes the reply instead of leaving a root tombstone.
 */
export function markTopLevelMessageDeletedInTargetCaches(
  parent: MessageParent,
  target: MessageTarget,
  deletedAt: string | null | undefined
) {
  if (target.kind !== 'top_level') return;

  patchTargetMessage(parent, target, { deleted_at: deletedAt });
}

/** Returns the current `deleted_at` value for a top-level message, if cached. */
export function getTopLevelMessageDeletedAt(
  parent: MessageParent,
  messageId: string
) {
  return getTargetMessage(parent, { kind: 'top_level', messageId })?.deleted_at;
}

export function topLevelMessageHasReplies(
  parent: MessageParent,
  messageId: string
): boolean {
  return (
    (findTopLevelMessageSnapshotInMessageTimeline(parent, messageId)?.message
      .thread.reply_count ?? 0) > 0 ||
    (getThreadRepliesData(parent, messageId)?.length ?? 0) > 0
  );
}

/** Captures rollback snapshots for a target before optimistic delete. */
export function captureDeleteSnapshotForTarget(
  parent: MessageParent,
  target: MessageTarget
): DeleteTargetSnapshot {
  if (target.kind === 'thread_reply') {
    return {
      kind: 'thread_reply',
      reply: getThreadReplySnapshot(
        getThreadRepliesData(parent, target.threadId),
        target.messageId
      ),
      preview: findThreadPreviewReplySnapshotInMessageTimeline(
        parent,
        target.threadId,
        target.messageId
      ),
    };
  }

  return {
    kind: 'top_level',
    message: findTopLevelMessageSnapshotInMessageTimeline(
      parent,
      target.messageId
    ),
  };
}

/** Restores a previously captured target snapshot into rendered caches. */
export function restoreMessageInTargetCaches(
  parent: MessageParent,
  target: MessageTarget,
  snapshot: DeleteTargetSnapshot
) {
  if (target.kind === 'thread_reply') {
    setThreadRepliesData(parent, target.threadId, (prev) =>
      snapshot.kind === 'thread_reply' && snapshot.reply
        ? restoreThreadReply(prev, snapshot.reply)
        : prev
    );
    setMessageTimelineData(parent, (prev) =>
      snapshot.kind === 'thread_reply'
        ? restoreThreadPreviewReplyInMessageTimeline(
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

  setMessageTimelineData(parent, (prev) =>
    snapshot.kind === 'top_level' && snapshot.message
      ? restoreTopLevelMessageInMessageTimeline(prev, snapshot.message)
      : prev
  );
}

/** Replaces a target message id across all rendered caches. */
export function replaceTargetMessageId(
  parent: MessageParent,
  target: MessageTarget,
  realId: string
) {
  if (target.kind === 'thread_reply') {
    setThreadRepliesData(parent, target.threadId, (prev) =>
      replaceThreadReplyId(prev, target.messageId, realId)
    );
    setMessageTimelineData(parent, (prev) =>
      replaceThreadReplyIdInMessageTimeline(
        prev,
        target.threadId,
        target.messageId,
        realId
      )
    );
    return;
  }

  setMessageTimelineData(parent, (prev) =>
    replaceTopLevelMessageIdInMessageTimeline(prev, target.messageId, realId)
  );
}

/** Find a cached message without inventing a partial message representation. */
export function getTargetMessage(
  parent: MessageParent,
  target: MessageTarget
): EntityMessage | undefined {
  if (target.kind === 'thread_reply') {
    return (
      getThreadRepliesData(parent, target.threadId)?.find(
        (item) => item.id === target.messageId
      ) ??
      findThreadPreviewReplySnapshotInMessageTimeline(
        parent,
        target.threadId,
        target.messageId
      )?.reply
    );
  }
  return (
    findTopLevelMessageSnapshotInMessageTimeline(parent, target.messageId)
      ?.message ??
    queryClient.getQueryData<MessageThread>(
      getThreadRepliesQueryKey(parent, target.messageId)
    )?.root
  );
}

/** Patch existing messages in every projection; only post/delete operations change membership. */
export function patchTargetMessage(
  parent: MessageParent,
  target: MessageTarget,
  patch: Partial<EntityMessage>
) {
  const update = <T extends EntityMessage>(message: T): T =>
    message.id === target.messageId ? { ...message, ...patch } : message;
  const rootId =
    target.kind === 'thread_reply' ? target.threadId : target.messageId;
  setMessageTimelineData(
    parent,
    (data) =>
      data && {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          items: page.items.map((root) =>
            root.id !== rootId
              ? root
              : {
                  ...update(root),
                  thread: {
                    ...root.thread,
                    preview: root.thread.preview.map(update),
                  },
                }
          ),
        })),
      }
  );
  queryClient.setQueryData<MessageThread>(
    getThreadRepliesQueryKey(parent, rootId),
    (thread) =>
      thread && {
        ...thread,
        root: update(thread.root),
        replies: thread.replies.map(update),
      }
  );
}

/** Soft-invalidates the rendered caches touched by a target message. */
export function softInvalidateTargetCaches(
  parent: MessageParent,
  target?: MessageTarget
) {
  softInvalidateMessageTimeline(parent);
  softInvalidateMessageTimelineByIds(parent);

  if (target) {
    softInvalidateThreadReplies(
      parent,
      target.kind === 'thread_reply' ? target.threadId : target.messageId
    );
  }
}
