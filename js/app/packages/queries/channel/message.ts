import { useAnalytics } from '@app/component/analytics-context';
import type { OptimisticPostMessageAttachment } from '@channel/Input/message-payload';
import { toast } from '@core/component/Toast/Toast';
import type { DateValue } from '@core/util/date';
import { throwOnErr } from '@core/util/result';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import type {
  Attachment,
  ChannelMessage,
  CountedReaction,
  Message,
} from '@service-comms/generated/models';
import {
  type ApiChannelMessage,
  type ApiThreadReply,
  type IdResponse,
  type MessageResponse,
  storageServiceClient,
} from '@service-storage/client';
import type { ApiMessageAttachment } from '@service-storage/generated/schemas/apiMessageAttachment';
import type { NewChannelAttachment as NewAttachment } from '@service-storage/generated/schemas/newChannelAttachment';
import type { PostMessageRequest } from '@service-storage/generated/schemas/postMessageRequest';
import type { SimpleMention } from '@service-storage/generated/schemas/simpleMention';
import { useMutation } from '@tanstack/solid-query';
import { queryClient } from '../client';
import { createMutationNonce, registerNonce } from '../nonce';
import { getChannelMessagesQueryKeyPrefix } from './channel-messages';
import { ChannelNonceKeys } from './keys';
import {
  captureDeleteSnapshotForTarget,
  type DeleteTargetSnapshot,
  getTargetMessageState,
  getTopLevelMessageDeletedAt,
  insertMessageIntoTargetCaches,
  markTopLevelMessageDeletedInTargetCaches,
  removeMessageFromTargetCaches,
  replaceTargetMessageId,
  replaceTargetMessageState,
  resolveMessageTarget,
  restoreMessageInTargetCaches,
  softInvalidateTargetCaches,
  topLevelMessageHasReplies,
} from './reconcile';

/**
 * Register nonces for both message and attachment deduplication.
 * The server echoes the same nonce for both message and attachment WebSocket events.
 */
function registerMessageNonces(
  optimisticId: string,
  hasAttachments: boolean
): void {
  registerNonce(ChannelNonceKeys.MESSAGE, optimisticId);
  if (hasAttachments) {
    registerNonce(ChannelNonceKeys.ATTACHMENT, optimisticId);
  }
}

function normalizeDateValue(
  value: DateValue | null | undefined
): string | null | undefined {
  return value instanceof Date ? value.toISOString() : value;
}

type WithChannelId<T> = T & { channelId: string };
type WithOptimisticId<T> = T & { optimisticId: string };
type WithSenderId<T> = T & { senderId: string };

type InsertMessageContext = {
  optimisticId: string;
  target: ReturnType<typeof resolveMessageTarget>;
};

type DeleteMessageContext = {
  deletedMessage?: Message;
  deletedReactions: CountedReaction[];
  deletedAttachments: Attachment[];
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
  messageId: string;
  target: ReturnType<typeof resolveMessageTarget>;
  previousContent: string;
  previousEditedAt: DateValue | null | undefined;
  previousUpdatedAt: DateValue;
  previousAttachments: Attachment[];
};

type OptimisticApiMessageAttachment = ApiMessageAttachment & {
  previewSrc?: string;
};

function makeOptimisticAttachments(
  attachments: readonly OptimisticPostMessageAttachment[],
  now: string
): OptimisticApiMessageAttachment[] {
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
  vars: WithChannelId<WithOptimisticId<WithSenderId<PostMessageRequest>>>,
  attachments: OptimisticApiMessageAttachment[],
  now: string
): ApiChannelMessage {
  return {
    id: vars.optimisticId,
    channel_id: vars.channelId,
    sender_id: vars.senderId,
    content: vars.content,
    created_at: now,
    updated_at: now,
    deleted_at: undefined,
    edited_at: undefined,
    attachments,
    reactions: [],
    thread: {
      preview: [],
      reply_count: 0,
      latest_reply_at: null,
    },
  };
}

function makeOptimisticThreadReply(
  vars: WithChannelId<WithOptimisticId<WithSenderId<PostMessageRequest>>>,
  attachments: OptimisticApiMessageAttachment[],
  now: string
): ApiThreadReply {
  return {
    id: vars.optimisticId,
    sender_id: vars.senderId,
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
export function optimisticInsertChannelMessage(
  vars: WithChannelId<
    WithOptimisticId<
      WithSenderId<
        PostMessageRequest & {
          optimisticAttachments?: readonly OptimisticPostMessageAttachment[];
        }
      >
    >
  >
): InsertMessageContext | undefined {
  const now = new Date().toISOString();
  const newAttachments = makeOptimisticAttachments(
    vars.optimisticAttachments ??
      vars.attachments.map((attachment) => ({ attachment })),
    now
  );
  const threadId = vars.thread_id ?? undefined;
  const target = resolveMessageTarget({
    channelId: vars.channelId,
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
    insertMessageIntoTargetCaches(vars.channelId, target, optimisticReply);
  } else {
    const optimisticMessage = makeOptimisticTopLevelMessage(
      vars,
      newAttachments,
      now
    );
    insertMessageIntoTargetCaches(vars.channelId, target, optimisticMessage);
  }

  return context;
}

/**
 * Rollback an optimistic message insert by removing the optimistic message.
 */
export function rollbackInsertChannelMessage(
  channelId: string,
  context: InsertMessageContext
): void {
  removeMessageFromTargetCaches(channelId, context.target);
}

/**
 * Replace an optimistic message ID with the real server-assigned ID.
 * Called in mutation onSuccess after server returns the real message.
 */
function replaceOptimisticMessage(
  vars: WithChannelId<{
    optimisticId: string;
    realId: string;
    threadId?: string;
  }>
): void {
  replaceTargetMessageId(
    vars.channelId,
    resolveMessageTarget({
      channelId: vars.channelId,
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
 * with no replies are removed outright. Thread replies don't have a
 * `deleted_at` field in the schema, so we always remove them from the caches
 * and capture a snapshot for rollback.
 */
export function optimisticDeleteChannelMessage(
  vars: WithChannelId<
    Pick<ChannelMessage, 'message_id'> & { threadId?: string }
  >
): DeleteMessageContext | undefined {
  const target = resolveMessageTarget({
    channelId: vars.channelId,
    messageId: vars.message_id,
    threadId: vars.threadId,
  });
  const context: DeleteMessageContext = {
    deletedReactions: [],
    deletedAttachments: [],
    target,
  };

  if (target.kind === 'top_level') {
    if (topLevelMessageHasReplies(vars.channelId, target.messageId)) {
      context.previousDeletedAt =
        getTopLevelMessageDeletedAt(vars.channelId, target.messageId) ?? null;
      markTopLevelMessageDeletedInTargetCaches(
        vars.channelId,
        target,
        new Date().toISOString()
      );
    } else {
      context.targetSnapshot = captureDeleteSnapshotForTarget(
        vars.channelId,
        target
      );
      removeMessageFromTargetCaches(vars.channelId, target);
    }
  } else {
    context.targetSnapshot = captureDeleteSnapshotForTarget(
      vars.channelId,
      target
    );
    removeMessageFromTargetCaches(vars.channelId, target);
  }

  return context;
}

/**
 * Rollback an optimistic message delete by restoring the deleted data.
 */
export function rollbackDeleteChannelMessage(
  channelId: string,
  context: DeleteMessageContext
): void {
  if (context.target.kind === 'top_level' && !context.targetSnapshot) {
    markTopLevelMessageDeletedInTargetCaches(
      channelId,
      context.target,
      context.previousDeletedAt
    );
    return;
  }

  if (context.targetSnapshot) {
    restoreMessageInTargetCaches(
      channelId,
      context.target,
      context.targetSnapshot
    );
  }
}

/**
 * Optimistically update a message's content in the channel cache.
 * Returns minimal context: only the previous content and timestamps.
 */
export function optimisticUpdateChannelMessage(
  vars: WithChannelId<
    Pick<ChannelMessage, 'message_id' | 'content'> & {
      attachment_ids_to_delete?: string[];
      attachments_to_add?: NewAttachment[];
    }
  >
): UpdateMessageContext | undefined {
  const target = resolveMessageTarget({
    channelId: vars.channelId,
    messageId: vars.message_id,
  });

  let context: UpdateMessageContext | undefined;
  const deletedAttachmentIDs = new Set(vars.attachment_ids_to_delete ?? []);
  const now = new Date().toISOString();

  const renderedState = getTargetMessageState(vars.channelId, target);
  if (renderedState) {
    context = {
      messageId: vars.message_id,
      target,
      previousContent: renderedState.content,
      previousEditedAt: renderedState.editedAt,
      previousUpdatedAt: renderedState.updatedAt,
      previousAttachments: renderedState.attachments.map((attachment) => ({
        ...attachment,
        channel_id: vars.channelId,
        message_id: vars.message_id,
      })),
    };
  }

  if (context) {
    const kept = context.previousAttachments.filter(
      (attachment) => !deletedAttachmentIDs.has(attachment.id)
    );
    const added: Attachment[] = (vars.attachments_to_add ?? []).map((a) => ({
      id: crypto.randomUUID(),
      channel_id: vars.channelId,
      message_id: vars.message_id,
      entity_id: a.entity_id,
      entity_type: a.entity_type,
      width: a.width,
      height: a.height,
      created_at: now,
    }));

    replaceTargetMessageState(vars.channelId, target, {
      content: vars.content,
      editedAt: now,
      updatedAt: now,
      attachments: [...kept, ...added],
    });
  }

  return context;
}

/**
 * Rollback an optimistic message update by restoring previous content.
 */
export function rollbackUpdateChannelMessage(
  channelId: string,
  context: UpdateMessageContext
): void {
  replaceTargetMessageState(channelId, context.target, {
    content: context.previousContent,
    editedAt: normalizeDateValue(context.previousEditedAt),
    updatedAt: normalizeDateValue(context.previousUpdatedAt) ?? '',
    attachments: context.previousAttachments,
  });
}

type SendMessageParams = {
  channelID: string;
  message: PostMessageRequest;
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
    IdResponse,
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
      return await throwOnErr(
        async () =>
          await storageServiceClient.postMessage({
            channel_id: vars.channelID,
            message: vars.message,
            nonce: vars.optimisticId,
          })
      );
    },
    ...withCallbacks<IdResponse, Error, SendMessageParams, SendMessageContext>(
      {
        onMutate: async (vars) => {
          registerMessageNonces(
            vars.optimisticId,
            vars.message.attachments.length > 0
          );
          await queryClient.cancelQueries({
            queryKey: getChannelMessagesQueryKeyPrefix(vars.channelID),
          });
          return optimisticInsertChannelMessage({
            channelId: vars.channelID,
            optimisticId: vars.optimisticId,
            senderId: vars.senderId,
            optimisticAttachments: vars.optimisticAttachments,
            ...vars.message,
          });
        },
        onSuccess(data, variables) {
          replaceOptimisticMessage({
            channelId: variables.channelID,
            optimisticId: variables.optimisticId,
            realId: data.id,
            threadId: variables.message.thread_id ?? undefined,
          });
          analytics.track('channel_message_sent', {
            contentLength: variables.message.content?.length ?? 0,
            attachmentsLength: variables.message.attachments.length,
            isThreadReply: variables.message.thread_id !== undefined,
          });
        },
        onError(error, vars, context) {
          console.error('failed to send message', error);
          toast.failure('Failed to send message');
          if (context) {
            rollbackInsertChannelMessage(vars.channelID, context);
          }
        },
        onSettled: (_data, _error, variables) => {
          softInvalidateTargetCaches(
            variables.channelID,
            resolveMessageTarget({
              channelId: variables.channelID,
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
  channelID: string;
  messageID: string;
  threadID?: string;
};

type DeleteMutationContext = DeleteMessageContext | undefined;

const deleteNonce = createMutationNonce<DeleteMessageParams>(
  ChannelNonceKeys.MESSAGE,
  (v) => `delete:${v.channelID}:${v.messageID}`
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
      await throwOnErr(
        async () =>
          await storageServiceClient.deleteMessage({
            channel_id: vars.channelID,
            message_id: vars.messageID,
            nonce: deleteNonce.use(vars),
          })
      );
    },
    ...withCallbacks<void, Error, DeleteMessageParams, DeleteMutationContext>(
      {
        onMutate: async (vars) => {
          deleteNonce.prepare(vars);
          await queryClient.cancelQueries({
            queryKey: getChannelMessagesQueryKeyPrefix(vars.channelID),
          });
          return optimisticDeleteChannelMessage({
            channelId: vars.channelID,
            message_id: vars.messageID,
            threadId: vars.threadID,
          });
        },
        onError(error, vars, context) {
          console.error('failed to delete message', error);
          toast.failure('Failed to delete message');
          if (context) {
            rollbackDeleteChannelMessage(vars.channelID, context);
          }
        },
        onSettled: (_data, _error, vars) => {
          deleteNonce.cleanup(vars);
          softInvalidateTargetCaches(
            vars.channelID,
            resolveMessageTarget({
              channelId: vars.channelID,
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
  channelID: string;
  messageID: string;
  content: string;
  mentions: SimpleMention[];
  attachmentIDsToDelete?: string[];
  attachmentsToAdd?: NewAttachment[];
};

type PatchMutationContext = UpdateMessageContext | undefined;

const patchNonce = createMutationNonce<PatchMessageParams>(
  ChannelNonceKeys.MESSAGE,
  (v) => `patch:${v.channelID}:${v.messageID}`
);

/**
 * Mutation to patch a channel message
 */
export function usePatchMessageMutation(
  callbacks?: MutationCallbacks<
    MessageResponse,
    Error,
    PatchMessageParams,
    PatchMutationContext
  >
) {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (vars: PatchMessageParams) => {
      return await throwOnErr(
        async () =>
          await storageServiceClient.patchMessage({
            channel_id: vars.channelID,
            message_id: vars.messageID,
            content: vars.content,
            mentions: vars.mentions,
            attachment_ids_to_delete: vars.attachmentIDsToDelete,
            attachments_to_add: vars.attachmentsToAdd,
            nonce: patchNonce.use(vars),
          })
      );
    },
    ...withCallbacks<
      MessageResponse,
      Error,
      PatchMessageParams,
      PatchMutationContext
    >(
      {
        onMutate: async (vars) => {
          patchNonce.prepare(vars);
          await queryClient.cancelQueries({
            queryKey: getChannelMessagesQueryKeyPrefix(vars.channelID),
          });
          return optimisticUpdateChannelMessage({
            channelId: vars.channelID,
            message_id: vars.messageID,
            content: vars.content,
            attachment_ids_to_delete: vars.attachmentIDsToDelete,
            attachments_to_add: vars.attachmentsToAdd,
          });
        },
        onError(error, vars, context) {
          console.error('failed to update message', error);
          toast.failure('Failed to update message');
          if (context) {
            rollbackUpdateChannelMessage(vars.channelID, context);
          }
        },
        onSettled: (_data, _error, vars) => {
          patchNonce.cleanup(vars);
          softInvalidateTargetCaches(
            vars.channelID,
            resolveMessageTarget({
              channelId: vars.channelID,
              messageId: vars.messageID,
            })
          );
        },
      },
      callbacks
    ),
  }));
}
