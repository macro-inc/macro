import { useAnalytics } from '@app/lib/analytics/analytics-context';
import type { OptimisticPostMessageAttachment } from '@channel/Input/message-payload';
import { toast } from '@core/component/Toast/Toast';
import type { DateValue } from '@core/util/date';
import {
  bumpSoupEntityTouchedAt,
  invalidateSoupEntity,
  refetchSoupEntity,
} from '@queries/soup/normalized-cache';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import type { MessageAttachment } from '@service-storage/generated/schemas/messageAttachment';
import type { NewAttachment } from '@service-storage/generated/schemas/newAttachment';
import type { SimpleMention } from '@service-storage/generated/schemas/simpleMention';
import type { ThreadPatch } from '@service-storage/generated/schemas/threadPatch';
import type { MessageListItem, MessageParent } from '@service-storage/messages';
import {
  type Message as EntityMessage,
  entityMessagesClient,
  type PostMessage,
} from '@service-storage/messages';
import { useMutation } from '@tanstack/solid-query';
import { queryClient } from '../client';
import { createMutationNonce, registerNonce } from '../nonce';
import { MessageNonceKeys } from './keys';
import { senderFromStorageId } from './message-sender';
import {
  captureDeleteSnapshotForTarget,
  type DeleteTargetSnapshot,
  getTargetMessage,
  getTopLevelMessageDeletedAt,
  insertMessageIntoTargetCaches,
  markTopLevelMessageDeletedInTargetCaches,
  patchTargetMessage,
  removeMessageFromTargetCaches,
  replaceTargetMessageId,
  resolveMessageTarget,
  restoreMessageInTargetCaches,
  softInvalidateTargetCaches,
  topLevelMessageHasReplies,
} from './reconcile';
import { applyMessage, applyThreadState } from './sync';
import { getMessageTimelineQueryKeyPrefix } from './timeline';

/** Deduplicate the one committed-message event echoed by the server. */
function registerMessageNonces(optimisticId: string): void {
  registerNonce(MessageNonceKeys.MESSAGE, optimisticId);
}

function normalizeDateValue(
  value: DateValue | null | undefined
): string | null | undefined {
  return value instanceof Date ? value.toISOString() : value;
}

type WithParent<T> = T & { parent: MessageParent };
type WithOptimisticId<T> = T & { optimisticId: string };
type WithSenderId<T> = T & { senderId: string };

type InsertMessageContext = {
  optimisticId: string;
  target: ReturnType<typeof resolveMessageTarget>;
};

type DeleteMessageContext = {
  target: ReturnType<typeof resolveMessageTarget>;
  /** Snapshot used to restore a removed thread reply on rollback. */
  targetSnapshot?: DeleteTargetSnapshot;
  /**
   * Previous `deleted_at` value for a soft-deleted top-level message,
   * captured so rollback can revert the optimistic mutation.
   */
  previousDeletedAt?: string | null;
};

type UpdateMessageContext = {
  target: ReturnType<typeof resolveMessageTarget>;
  previousContent: string;
  previousEditedAt: DateValue | null | undefined;
  previousUpdatedAt: DateValue;
  previousAttachments: MessageAttachment[];
};

type OptimisticMessageAttachment = MessageAttachment & {
  previewSrc?: string;
};

function makeOptimisticAttachments(
  attachments: readonly OptimisticPostMessageAttachment[],
  now: string
): OptimisticMessageAttachment[] {
  return attachments.map(({ attachment, previewSrc }) => ({
    id: crypto.randomUUID(),
    entity_id: attachment.entity_id,
    entity_type: attachment.entity_type,
    created_at: now,
    width: attachment.width ?? undefined,
    height: attachment.height ?? undefined,
    previewSrc,
  }));
}

function makeOptimisticTopLevelMessage(
  vars: WithParent<WithOptimisticId<WithSenderId<PostMessage>>>,
  attachments: OptimisticMessageAttachment[],
  now: string
): MessageListItem {
  return {
    id: vars.optimisticId,
    parent: vars.parent,
    sender: senderFromStorageId(vars.senderId),
    sender_id: vars.senderId,
    mentions: vars.mentions ?? [],
    thread_id: vars.thread_id ?? null,
    content: vars.content,
    created_at: now,
    updated_at: now,
    deleted_at: undefined,
    edited_at: undefined,
    attachments,
    reactions: [],
    state: {
      root_id: vars.optimisticId,
      user_id: vars.senderId,
      created_at: now,
      updated_at: now,
      resolved: false,
      anchor: vars.anchor ?? null,
    },
    thread: {
      preview: [],
      reply_count: 0,
      latest_reply_at: null,
    },
  };
}

function makeOptimisticThreadReply(
  vars: WithParent<WithOptimisticId<WithSenderId<PostMessage>>>,
  attachments: OptimisticMessageAttachment[],
  now: string
): EntityMessage {
  return {
    id: vars.optimisticId,
    parent: vars.parent,
    sender: senderFromStorageId(vars.senderId),
    sender_id: vars.senderId,
    mentions: vars.mentions ?? [],
    thread_id: vars.thread_id ?? null,
    content: vars.content,
    created_at: now,
    updated_at: now,
    edited_at: undefined,
    attachments,
    reactions: [],
  };
}

/**
 * Optimistically insert a new message into the channel cache.
 * Returns minimal context for rollback (just the optimistic ID).
 */
export function optimisticInsertMessage(
  vars: WithParent<
    WithOptimisticId<
      WithSenderId<
        PostMessage & {
          optimisticAttachments?: readonly OptimisticPostMessageAttachment[];
        }
      >
    >
  >
): InsertMessageContext | undefined {
  const now = new Date().toISOString();
  const newAttachments = makeOptimisticAttachments(
    vars.optimisticAttachments ??
      (vars.attachments ?? []).map((attachment) => ({ attachment })),
    now
  );
  const threadId = vars.thread_id ?? undefined;
  const target = resolveMessageTarget({
    parent: vars.parent,
    messageId: vars.optimisticId,
    threadId,
  });
  const context: InsertMessageContext = {
    optimisticId: vars.optimisticId,
    target,
  };

  if (target.kind === 'thread_reply') {
    const optimisticReply = makeOptimisticThreadReply(
      vars,
      newAttachments,
      now
    );
    insertMessageIntoTargetCaches(vars.parent, target, optimisticReply);
  } else {
    const optimisticMessage = makeOptimisticTopLevelMessage(
      vars,
      newAttachments,
      now
    );
    insertMessageIntoTargetCaches(vars.parent, target, optimisticMessage);
  }

  return context;
}

/**
 * Rollback an optimistic message insert by removing the optimistic message.
 */
export function rollbackInsertChannelMessage(
  parent: MessageParent,
  context: InsertMessageContext
): void {
  removeMessageFromTargetCaches(parent, context.target);
}

/**
 * Replace an optimistic message ID with the real server-assigned ID.
 * Called in mutation onSuccess after server returns the real message.
 */
function replaceOptimisticMessage(
  vars: WithParent<{
    optimisticId: string;
    realId: string;
    threadId?: string;
  }>
): void {
  replaceTargetMessageId(
    vars.parent,
    resolveMessageTarget({
      parent: vars.parent,
      messageId: vars.optimisticId,
      threadId: vars.threadId,
    }),
    vars.realId
  );
}

/**
 * Optimistically delete a message from the channel cache.
 *
 * Top-level messages with thread replies are soft-deleted in place (we set
 * `deleted_at`) so the UI renders the "this message was deleted" placeholder
 * while preserving the replies hanging off the message. Top-level messages
 * with no replies are removed outright. Replies are removed from the caches,
 * with a snapshot retained for rollback.
 */
export function optimisticDeleteMessage(
  vars: WithParent<{ message_id: string; threadId?: string }>
): DeleteMessageContext | undefined {
  const target = resolveMessageTarget({
    parent: vars.parent,
    messageId: vars.message_id,
    threadId: vars.threadId,
  });
  const context: DeleteMessageContext = {
    target,
  };

  if (target.kind === 'top_level') {
    if (
      vars.parent.type === 'document' ||
      topLevelMessageHasReplies(vars.parent, target.messageId)
    ) {
      context.previousDeletedAt =
        getTopLevelMessageDeletedAt(vars.parent, target.messageId) ?? null;
      markTopLevelMessageDeletedInTargetCaches(
        vars.parent,
        target,
        new Date().toISOString()
      );
    } else {
      context.targetSnapshot = captureDeleteSnapshotForTarget(
        vars.parent,
        target
      );
      removeMessageFromTargetCaches(vars.parent, target);
    }
  } else {
    context.targetSnapshot = captureDeleteSnapshotForTarget(
      vars.parent,
      target
    );
    removeMessageFromTargetCaches(vars.parent, target);
  }

  return context;
}

/**
 * Rollback an optimistic message delete by restoring the deleted data.
 */
export function rollbackDeleteMessage(
  parent: MessageParent,
  context: DeleteMessageContext
): void {
  if (context.target.kind === 'top_level' && !context.targetSnapshot) {
    markTopLevelMessageDeletedInTargetCaches(
      parent,
      context.target,
      context.previousDeletedAt
    );
    return;
  }

  if (context.targetSnapshot) {
    restoreMessageInTargetCaches(
      parent,
      context.target,
      context.targetSnapshot
    );
  }
}

/**
 * Optimistically update a message's content in the channel cache.
 * Returns minimal context: only the previous content and timestamps.
 */
export function optimisticUpdateMessage(
  vars: WithParent<{
    message_id: string;
    content: string;
    attachment_ids_to_delete?: string[];
    attachments_to_add?: NewAttachment[];
  }>
): UpdateMessageContext | undefined {
  const target = resolveMessageTarget({
    parent: vars.parent,
    messageId: vars.message_id,
  });

  let context: UpdateMessageContext | undefined;
  const deletedAttachmentIDs = new Set(vars.attachment_ids_to_delete ?? []);
  const now = new Date().toISOString();

  const renderedState = getTargetMessage(vars.parent, target);
  if (renderedState) {
    context = {
      target,
      previousContent: renderedState.content,
      previousEditedAt: renderedState.edited_at,
      previousUpdatedAt: renderedState.updated_at,
      previousAttachments: renderedState.attachments,
    };
  }

  if (context) {
    const kept = context.previousAttachments.filter(
      (attachment) => !deletedAttachmentIDs.has(attachment.id)
    );
    const added: MessageAttachment[] = (vars.attachments_to_add ?? []).map(
      (a) => ({
        id: crypto.randomUUID(),
        entity_id: a.entity_id,
        entity_type: a.entity_type,
        width: a.width,
        height: a.height,
        created_at: now,
      })
    );

    patchTargetMessage(vars.parent, target, {
      content: vars.content,
      edited_at: now,
      updated_at: now,
      attachments: [...kept, ...added],
    });
  }

  return context;
}

/**
 * Rollback an optimistic message update by restoring previous content.
 */
export function rollbackUpdateMessage(
  parent: MessageParent,
  context: UpdateMessageContext
): void {
  patchTargetMessage(parent, context.target, {
    content: context.previousContent,
    edited_at: normalizeDateValue(context.previousEditedAt),
    updated_at: normalizeDateValue(context.previousUpdatedAt) ?? '',
    attachments: context.previousAttachments,
  });
}

type SendMessageParams = {
  parent: MessageParent;
  message: PostMessage;
  optimisticAttachments?: readonly OptimisticPostMessageAttachment[];
  optimisticId: string;
  senderId: string;
};

type SendMessageContext = InsertMessageContext | undefined;

/**
 * Mutation to send an channel message.
 */
export function useSendMessageMutation(
  callbacks?: MutationCallbacks<
    EntityMessage,
    Error,
    SendMessageParams,
    SendMessageContext
  >
) {
  const analytics = useAnalytics();

  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (vars: SendMessageParams) => {
      // Use optimisticId as nonce - allows server to echo it back for correlation
      return entityMessagesClient.post(vars.parent, {
        ...vars.message,
        nonce: vars.optimisticId,
      });
    },
    ...withCallbacks<
      EntityMessage,
      Error,
      SendMessageParams,
      SendMessageContext
    >(
      {
        onMutate: async (vars) => {
          registerMessageNonces(vars.optimisticId);
          await queryClient.cancelQueries({
            queryKey: getMessageTimelineQueryKeyPrefix(vars.parent),
          });
          return optimisticInsertMessage({
            parent: vars.parent,
            optimisticId: vars.optimisticId,
            senderId: vars.senderId,
            optimisticAttachments: vars.optimisticAttachments,
            ...vars.message,
          });
        },
        onSuccess(data, variables) {
          const threadId = variables.message.thread_id ?? undefined;
          replaceOptimisticMessage({
            parent: variables.parent,
            optimisticId: variables.optimisticId,
            realId: data.id,
            threadId,
          });

          // Sending is a `messaged` activity server-side; stamp the touch now
          // so the Recent order moves the channel up without waiting on the
          // activity consumer, which the refetch below can outrun.
          if (variables.parent.type === 'channel')
            bumpSoupEntityTouchedAt(variables.parent.id);

          // The sender does not receive the notification that normally refreshes
          // this soup entity. Refresh root messages here so the channel moves to
          // its updated position in soup lists.
          if (threadId === undefined && variables.parent.type === 'channel') {
            refetchSoupEntity(variables.parent.id, 'channel');
            invalidateSoupEntity(variables.parent.id);
          }

          analytics.track('channel_message_sent', {
            contentLength: variables.message.content?.length ?? 0,
            attachmentsLength: variables.message.attachments?.length ?? 0,
            isThreadReply: threadId !== undefined,
          });
          applyMessage(data, 'edited');
        },
        onError(error, vars, context) {
          console.error('failed to send message', error);
          toast.failure('Failed to send message');
          if (context) {
            rollbackInsertChannelMessage(vars.parent, context);
          }
        },
        onSettled: (_data, _error, variables) => {
          softInvalidateTargetCaches(
            variables.parent,
            resolveMessageTarget({
              parent: variables.parent,
              messageId: variables.optimisticId,
              threadId: variables.message.thread_id ?? undefined,
            })
          );
        },
      },
      callbacks
    ),
  }));
}

type DeleteMessageParams = {
  parent: MessageParent;
  messageID: string;
  threadID?: string;
};

type DeleteMutationContext = DeleteMessageContext | undefined;

const deleteNonce = createMutationNonce<DeleteMessageParams>(
  MessageNonceKeys.MESSAGE,
  (v) => `delete:${v.parent.type}:${v.parent.id}:${v.messageID}`
);

/**
 * Mutation to delete a channel message
 */
export function useDeleteMessageMutation(
  callbacks?: MutationCallbacks<
    void,
    Error,
    DeleteMessageParams,
    DeleteMutationContext
  >
) {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (vars: DeleteMessageParams) => {
      await entityMessagesClient.delete(
        vars.parent,
        vars.messageID,
        deleteNonce.use(vars)
      );
    },
    ...withCallbacks<void, Error, DeleteMessageParams, DeleteMutationContext>(
      {
        onMutate: async (vars) => {
          deleteNonce.prepare(vars);
          await queryClient.cancelQueries({
            queryKey: getMessageTimelineQueryKeyPrefix(vars.parent),
          });
          return optimisticDeleteMessage({
            parent: vars.parent,
            message_id: vars.messageID,
            threadId: vars.threadID,
          });
        },
        onError(error, vars, context) {
          console.error('failed to delete message', error);
          toast.failure('Failed to delete message');
          if (context) {
            rollbackDeleteMessage(vars.parent, context);
          }
        },
        onSettled: (_data, _error, vars) => {
          deleteNonce.cleanup(vars);
          softInvalidateTargetCaches(
            vars.parent,
            resolveMessageTarget({
              parent: vars.parent,
              messageId: vars.messageID,
              threadId: vars.threadID,
            })
          );
        },
      },
      callbacks
    ),
  }));
}

type PatchMessageParams = {
  parent: MessageParent;
  messageID: string;
  content: string;
  mentions: SimpleMention[];
  attachmentIDsToDelete?: string[];
  attachmentsToAdd?: NewAttachment[];
};

type PatchMutationContext = UpdateMessageContext | undefined;

const patchNonce = createMutationNonce<PatchMessageParams>(
  MessageNonceKeys.MESSAGE,
  (v) => `patch:${v.parent.type}:${v.parent.id}:${v.messageID}`
);

/**
 * Mutation to patch a channel message
 */
export function usePatchMessageMutation(
  callbacks?: MutationCallbacks<
    EntityMessage,
    Error,
    PatchMessageParams,
    PatchMutationContext
  >
) {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (vars: PatchMessageParams) => {
      return entityMessagesClient.patch(vars.parent, vars.messageID, {
        content: vars.content,
        mentions: vars.mentions,
        attachments: {
          type: 'delta',
          value: {
            remove: vars.attachmentIDsToDelete ?? [],
            add: vars.attachmentsToAdd ?? [],
          },
        },
        nonce: patchNonce.use(vars),
      });
    },
    ...withCallbacks<
      EntityMessage,
      Error,
      PatchMessageParams,
      PatchMutationContext
    >(
      {
        onMutate: async (vars) => {
          patchNonce.prepare(vars);
          await queryClient.cancelQueries({
            queryKey: getMessageTimelineQueryKeyPrefix(vars.parent),
          });
          return optimisticUpdateMessage({
            parent: vars.parent,
            message_id: vars.messageID,
            content: vars.content,
            attachment_ids_to_delete: vars.attachmentIDsToDelete,
            attachments_to_add: vars.attachmentsToAdd,
          });
        },
        onSuccess(data) {
          applyMessage(data, 'edited');
        },
        onError(error, vars, context) {
          console.error('failed to update message', error);
          toast.failure('Failed to update message');
          if (context) {
            rollbackUpdateMessage(vars.parent, context);
          }
        },
        onSettled: (_data, _error, vars) => {
          patchNonce.cleanup(vars);
          softInvalidateTargetCaches(
            vars.parent,
            resolveMessageTarget({
              parent: vars.parent,
              messageId: vars.messageID,
            })
          );
        },
      },
      callbacks
    ),
  }));
}

export function usePatchThreadMutation() {
  return useMutation(() => ({
    mutationFn: async (input: {
      parent: MessageParent;
      rootId: string;
      patch: ThreadPatch;
    }) => {
      const state = await entityMessagesClient.patchThread(
        input.parent,
        input.rootId,
        input.patch
      );
      applyThreadState(input.parent, state);
      return state;
    },
    onError: () => toast.failure('Could not update discussion'),
  }));
}
export function useDeleteThreadMutation() {
  return useMutation(() => ({
    mutationFn: async (input: { parent: MessageParent; rootId: string }) => {
      const state = await entityMessagesClient.deleteThread(
        input.parent,
        input.rootId
      );
      applyThreadState(input.parent, state);
      return state;
    },
    onError: () => toast.failure('Could not delete discussion'),
  }));
}
