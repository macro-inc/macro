import { useAnalytics } from '@app/lib/analytics/analytics-context';
import type { OptimisticPostMessageAttachment } from '@channel/Input/message-payload';
import { toast } from '@core/component/Toast/Toast';
import type { DateValue } from '@core/util/date';
import { markMessageSent } from '@core/util/message-send-motion';
import {
  bumpSoupEntityTouchedAt,
  invalidateSoupEntity,
  optimisticUpdateSoupItemUpdatedAt,
  refetchSoupEntity,
  type SoupTransaction,
} from '@queries/soup/normalized-cache';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import type { MessageAttachment } from '@service-storage/generated/schemas/messageAttachment';
import type { NewAttachment } from '@service-storage/generated/schemas/newAttachment';
import type { SimpleMention } from '@service-storage/generated/schemas/simpleMention';
import type { ThreadPatch } from '@service-storage/generated/schemas/threadPatch';
import type {
  MessageListItem,
  MessageParent,
  MessageThread,
} from '@service-storage/messages';
import {
  type Message as EntityMessage,
  entityMessagesClient,
  type PostMessage,
} from '@service-storage/messages';
import { useMutation } from '@tanstack/solid-query';
import { v7 as uuidv7 } from 'uuid';
import { queryClient } from '../client';
import { createMutationNonce, registerNonce } from '../nonce';
import { MessageNonceKeys } from './keys';
import { senderFromStorageId } from './message-sender';
import {
  captureDeleteSnapshotForTarget,
  type DeleteTargetSnapshot,
  getCachedThreadState,
  getTargetMessage,
  getTopLevelMessageDeletedAt,
  insertMessageIntoTargetCaches,
  markTopLevelMessageDeletedInTargetCaches,
  patchTargetMessage,
  removeMessageFromTargetCaches,
  resolveMessageTarget,
  restoreMessageInTargetCaches,
  softInvalidateTargetCaches,
  topLevelMessageHasReplies,
} from './reconcile';
import { applyMessage, applyRootDeletion, applyThreadState } from './sync';
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
  /**
   * Thread state of a discussion root, read before this delete removed the
   * root from the caches that hold it, so the committed teardown can be
   * applied on success.
   */
  threadState?: MessageThread['state'];
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

  markMessageSent(`channel:${vars.optimisticId}`);

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
 * Optimistically delete a message from the channel cache.
 *
 * A channel root with thread replies is soft-deleted in place (we set
 * `deleted_at`) so the UI renders the "this message was deleted" placeholder
 * above the replies it keeps: that conversation continues without its first
 * message. Every other delete leaves nothing behind — a channel root with no
 * replies, a reply, and a document root, which takes its whole discussion with
 * it — so it is removed outright, with a snapshot retained for rollback. The
 * discussion's teardown itself is applied on success rather than here: it
 * deletes the document's mark, which a rollback could not put back.
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

  if (target.kind === 'top_level' && vars.parent.type !== 'channel') {
    context.threadState = getCachedThreadState(vars.parent, target.messageId);
  }

  if (
    target.kind === 'top_level' &&
    vars.parent.type === 'channel' &&
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

/**
 * Mint the id of a message about to be sent. The server stores it as the
 * message id, so it must be a UUIDv7 stamped with the current time.
 */
export function newMessageId(): string {
  return uuidv7();
}

type SendMessageParams = {
  parent: MessageParent;
  message: PostMessage;
  optimisticAttachments?: readonly OptimisticPostMessageAttachment[];
  /** From `newMessageId`; the message's final id, not a placeholder. */
  optimisticId: string;
  senderId: string;
};

type SendMessageContext = {
  insert: InsertMessageContext | undefined;
  updatedAt: SoupTransaction | undefined;
};

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
      // The server keeps optimisticId as the message id, so the optimistic
      // message never changes id; it is also the nonce the server echoes.
      return entityMessagesClient.post(vars.parent, {
        ...vars.message,
        id: vars.optimisticId,
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
          const insert = optimisticInsertMessage({
            parent: vars.parent,
            optimisticId: vars.optimisticId,
            senderId: vars.senderId,
            optimisticAttachments: vars.optimisticAttachments,
            ...vars.message,
          });
          const updatedAt =
            vars.parent.type === 'channel'
              ? optimisticUpdateSoupItemUpdatedAt(
                  vars.parent.id,
                  'channel',
                  new Date().toISOString()
                )
              : undefined;

          return { insert, updatedAt };
        },
        onSuccess(data, variables, context) {
          const threadId = variables.message.thread_id ?? undefined;
          // A server predating client-minted ids ignores `id` and mints its
          // own. Rebuild the optimistic row under the server id so it keeps
          // its thread state (including the anchor) and never holds a dead id;
          // `applyMessage` below then settles it on the server's fields.
          if (data.id !== variables.optimisticId && context?.insert) {
            rollbackInsertChannelMessage(variables.parent, context.insert);
            optimisticInsertMessage({
              parent: variables.parent,
              optimisticId: data.id,
              senderId: variables.senderId,
              optimisticAttachments: variables.optimisticAttachments,
              ...variables.message,
            });
          }

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

          if (variables.parent.type === 'channel')
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
          if (context?.insert) {
            rollbackInsertChannelMessage(vars.parent, context.insert);
          }
          context?.updatedAt?.rollback();
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
    EntityMessage,
    Error,
    DeleteMessageParams,
    DeleteMutationContext
  >
) {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (vars: DeleteMessageParams) => {
      return entityMessagesClient.delete(
        vars.parent,
        vars.messageID,
        deleteNonce.use(vars)
      );
    },
    ...withCallbacks<
      EntityMessage,
      Error,
      DeleteMessageParams,
      DeleteMutationContext
    >(
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
        onSuccess(data, _vars, context) {
          applyRootDeletion(data, context?.threadState);
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
    // Resolving collapses the card at once; a failure restores the prior state.
    onMutate: (input) => {
      const { resolved } = input.patch;
      if (resolved == null) return;
      const previous = getCachedThreadState(input.parent, input.rootId);
      if (!previous || previous.resolved === resolved) return;
      applyThreadState(input.parent, { ...previous, resolved });
      return { previous };
    },
    onError: (_error, input, context) => {
      if (context?.previous) applyThreadState(input.parent, context.previous);
      toast.failure('Could not update discussion');
    },
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
