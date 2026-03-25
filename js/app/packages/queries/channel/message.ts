import { toast } from '@core/component/Toast/Toast';
import { ENABLE_NEW_CHANNELS } from '@core/constant/featureFlags';
import type { DateValue } from '@core/util/date';
import { throwOnErr } from '@core/util/maybeResult';
import { softInvalidateChannelWithID } from '@queries/channel/channel';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import {
  commsServiceClient,
  type ApiChannelMessage,
  type ApiThreadReply,
  type IdResponse,
  type MessageResponse,
} from '@service-comms/client';
import type {
  ChannelMessage,
  CountedReaction,
  PostMessageRequest,
} from '@service-comms/generated/models';
import type { Attachment, GetChannelResponse, Message } from './types';
import { useMutation } from '@tanstack/solid-query';
import { queryClient } from '../client';
import { channelKeys, ChannelNonceKeys } from './keys';
import { createMutationNonce, registerNonce } from '../nonce';
import {
  captureDeleteSnapshotForTarget,
  getTargetMessageState,
  insertMessageIntoTargetCaches,
  removeMessageFromTargetCaches,
  replaceTargetMessageState,
  restoreMessageInTargetCaches,
  softInvalidateTargetCaches,
  replaceTargetMessageId,
  resolveMessageTarget,
  type DeleteTargetSnapshot,
} from './reconcile';
import { useAnalytics } from '@app/component/analytics-context';

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

export type InsertMessageContext = {
  optimisticId: string;
  target: ReturnType<typeof resolveMessageTarget>;
};

export type DeleteMessageContext = {
  deletedMessage?: Message;
  deletedReactions: CountedReaction[];
  deletedAttachments: Attachment[];
  target: ReturnType<typeof resolveMessageTarget>;
  targetSnapshot?: DeleteTargetSnapshot;
};

export type UpdateMessageContext = {
  messageId: string;
  target: ReturnType<typeof resolveMessageTarget>;
  previousContent: string;
  previousEditedAt: DateValue | null | undefined;
  previousUpdatedAt: DateValue;
  previousAttachments: Attachment[];
};

function makeOptimisticAttachments(
  channelId: string,
  optimisticId: string,
  attachments: PostMessageRequest['attachments'],
  now: string
): Attachment[] {
  return attachments.map((attachment) => ({
    id: crypto.randomUUID(),
    channel_id: channelId,
    created_at: now,
    message_id: optimisticId,
    ...attachment,
  }));
}

function makeOptimisticTopLevelMessage(
  vars: WithChannelId<WithOptimisticId<WithSenderId<PostMessageRequest>>>,
  attachments: Attachment[],
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
    attachments: attachments.map(
      ({ id, entity_id, entity_type, created_at }) => ({
        id,
        entity_id,
        entity_type,
        created_at,
      })
    ),
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
  attachments: Attachment[],
  now: string
): ApiThreadReply {
  return {
    id: vars.optimisticId,
    sender_id: vars.senderId,
    content: vars.content,
    created_at: now,
    updated_at: now,
    edited_at: undefined,
    attachments: attachments.map(
      ({ id, entity_id, entity_type, created_at }) => ({
        id,
        entity_id,
        entity_type,
        created_at,
      })
    ),
    reactions: [],
  };
}

/**
 * Optimistically insert a new message into the channel cache.
 * Returns minimal context for rollback (just the optimistic ID).
 */
export function optimisticInsertChannelMessage(
  vars: WithChannelId<WithOptimisticId<WithSenderId<PostMessageRequest>>>
): InsertMessageContext | undefined {
  const queryKey = channelKeys.withID(vars.channelId).queryKey;
  queryClient.cancelQueries({ queryKey });

  const now = new Date().toISOString();
  const newAttachments = makeOptimisticAttachments(
    vars.channelId,
    vars.optimisticId,
    vars.attachments,
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

  queryClient.setQueriesData(
    { queryKey },
    (prev: GetChannelResponse | undefined) => {
      if (!prev) return prev;

      const newMessage: Message = {
        id: vars.optimisticId,
        channel_id: vars.channelId,
        sender_id: vars.senderId,
        content: vars.content,
        thread_id: vars.thread_id ?? undefined,
        created_at: now,
        updated_at: now,
        deleted_at: undefined,
        edited_at: undefined,
      };

      return {
        ...prev,
        messages: [...prev.messages, newMessage],
        attachments: [...prev.attachments, ...newAttachments],
      };
    }
  );

  if (ENABLE_NEW_CHANNELS()) {
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
  const queryKey = channelKeys.withID(channelId).queryKey;

  queryClient.setQueriesData(
    { queryKey },
    (prev: GetChannelResponse | undefined) => {
      if (!prev) return prev;

      return {
        ...prev,
        messages: prev.messages.filter((m) => m.id !== context.optimisticId),
        attachments: prev.attachments.filter(
          (a) => a.message_id !== context.optimisticId
        ),
      };
    }
  );

  if (ENABLE_NEW_CHANNELS()) {
    removeMessageFromTargetCaches(channelId, context.target);
  }
}

/**
 * Replace an optimistic message ID with the real server-assigned ID.
 * Called in mutation onSuccess after server returns the real message.
 */
export function replaceOptimisticMessage(
  vars: WithChannelId<{
    optimisticId: string;
    realId: string;
    threadId?: string;
  }>
): void {
  const queryKey = channelKeys.withID(vars.channelId).queryKey;

  queryClient.setQueriesData(
    { queryKey },
    (prev: GetChannelResponse | undefined) => {
      if (!prev) return prev;

      const messageIndex = prev.messages.findIndex(
        (m) => m.id === vars.optimisticId
      );

      if (messageIndex === -1) return prev;

      const hasAuthoritativeAttachments = prev.attachments.some(
        (attachment) => attachment.message_id === vars.realId
      );

      const updatedMessages = [...prev.messages];
      updatedMessages[messageIndex] = {
        ...updatedMessages[messageIndex],
        id: vars.realId,
      };

      return {
        ...prev,
        messages: updatedMessages,
        attachments: hasAuthoritativeAttachments
          ? prev.attachments.filter(
              (attachment) => attachment.message_id !== vars.optimisticId
            )
          : prev.attachments.map((attachment) =>
              attachment.message_id === vars.optimisticId
                ? { ...attachment, message_id: vars.realId }
                : attachment
            ),
      };
    }
  );

  if (ENABLE_NEW_CHANNELS()) {
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
}

/**
 * Optimistically delete a message from the channel cache.
 * Returns minimal context: only the deleted message, reactions, and attachments.
 */
export function optimisticDeleteChannelMessage(
  vars: WithChannelId<
    Pick<ChannelMessage, 'message_id'> & { threadId?: string }
  >
): DeleteMessageContext | undefined {
  const queryKey = channelKeys.withID(vars.channelId).queryKey;
  queryClient.cancelQueries({ queryKey });

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

  queryClient.setQueriesData(
    { queryKey },
    (prev: GetChannelResponse | undefined) => {
      if (!prev) return prev;

      const deletedMessage = prev.messages.find(
        (m) => m.id === vars.message_id
      );
      if (!deletedMessage) return prev;

      context.deletedMessage = deletedMessage;
      context.deletedReactions = prev.reactions[vars.message_id] ?? [];
      context.deletedAttachments = prev.attachments.filter(
        (a) => a.message_id === vars.message_id
      );

      const filteredMessages = prev.messages.filter(
        (m) => m.id !== vars.message_id
      );

      // Remove reactions for the deleted message
      const { [vars.message_id]: _removedReactions, ...remainingReactions } =
        prev.reactions;

      // Remove attachments linked to the deleted message
      const filteredAttachments = prev.attachments.filter(
        (a) => a.message_id !== vars.message_id
      );

      return {
        ...prev,
        messages: filteredMessages,
        reactions: remainingReactions,
        attachments: filteredAttachments,
      };
    }
  );

  if (ENABLE_NEW_CHANNELS()) {
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
  const queryKey = channelKeys.withID(channelId).queryKey;

  queryClient.setQueriesData(
    { queryKey },
    (prev: GetChannelResponse | undefined) => {
      if (!prev) return prev;
      if (!context.deletedMessage) return prev;

      return {
        ...prev,
        messages: [...prev.messages, context.deletedMessage],
        reactions: {
          ...prev.reactions,
          ...(context.deletedReactions.length > 0 && {
            [context.deletedMessage.id]: context.deletedReactions,
          }),
        },
        attachments: [...prev.attachments, ...context.deletedAttachments],
      };
    }
  );

  if (ENABLE_NEW_CHANNELS() && context.targetSnapshot) {
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
    }
  >
): UpdateMessageContext | undefined {
  const queryKey = channelKeys.withID(vars.channelId).queryKey;
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

  queryClient.setQueriesData(
    { queryKey },
    (prev: GetChannelResponse | undefined) => {
      if (!prev) return prev;

      const message = prev.messages.find((m) => m.id === vars.message_id);
      if (!message) return prev;

      context = {
        messageId: vars.message_id,
        target,
        previousContent: message.content,
        previousEditedAt: message.edited_at,
        previousUpdatedAt: message.updated_at,
        previousAttachments: prev.attachments.filter(
          (attachment) => attachment.message_id === vars.message_id
        ),
      };

      return {
        ...prev,
        messages: prev.messages.map((m) =>
          m.id === vars.message_id
            ? { ...m, content: vars.content, edited_at: now, updated_at: now }
            : m
        ),
        attachments: prev.attachments.filter(
          (attachment) =>
            attachment.message_id !== vars.message_id ||
            !deletedAttachmentIDs.has(attachment.id)
        ),
      };
    }
  );

  if (ENABLE_NEW_CHANNELS() && context) {
    replaceTargetMessageState(vars.channelId, target, {
      content: vars.content,
      editedAt: now,
      updatedAt: now,
      attachments: context.previousAttachments.filter(
        (attachment) => !deletedAttachmentIDs.has(attachment.id)
      ),
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
  const queryKey = channelKeys.withID(channelId).queryKey;

  queryClient.setQueriesData(
    { queryKey },
    (prev: GetChannelResponse | undefined) => {
      if (!prev) return prev;

      return {
        ...prev,
        messages: prev.messages.map((m) =>
          m.id === context.messageId
            ? {
                ...m,
                content: context.previousContent,
                edited_at: context.previousEditedAt,
                updated_at: context.previousUpdatedAt,
              }
            : m
        ),
        attachments: [
          ...prev.attachments.filter(
            (attachment) => attachment.message_id !== context.messageId
          ),
          ...context.previousAttachments,
        ],
      };
    }
  );

  if (ENABLE_NEW_CHANNELS()) {
    replaceTargetMessageState(channelId, context.target, {
      content: context.previousContent,
      editedAt: normalizeDateValue(context.previousEditedAt),
      updatedAt: normalizeDateValue(context.previousUpdatedAt) ?? '',
      attachments: context.previousAttachments,
    });
  }
}

type SendMessageParams = {
  channelID: string;
  message: PostMessageRequest;
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
          await commsServiceClient.postMessage({
            channel_id: vars.channelID,
            message: vars.message,
            nonce: vars.optimisticId,
          })
      );
    },
    ...withCallbacks<IdResponse, Error, SendMessageParams, SendMessageContext>(
      {
        onMutate: async (vars) => {
          await queryClient.cancelQueries({
            queryKey: channelKeys.withID(vars.channelID).queryKey,
          });
          // Register nonces for deduplication when WebSocket events arrive
          registerMessageNonces(
            vars.optimisticId,
            vars.message.attachments.length > 0
          );
          return optimisticInsertChannelMessage({
            channelId: vars.channelID,
            optimisticId: vars.optimisticId,
            senderId: vars.senderId,
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
          softInvalidateChannelWithID(variables.channelID);
          if (ENABLE_NEW_CHANNELS()) {
            softInvalidateTargetCaches(
              variables.channelID,
              resolveMessageTarget({
                channelId: variables.channelID,
                messageId: variables.optimisticId,
                threadId: variables.message.thread_id ?? undefined,
              })
            );
          }
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
          await commsServiceClient.deleteMessage({
            channel_id: vars.channelID,
            message_id: vars.messageID,
            nonce: deleteNonce.use(vars),
          })
      );
    },
    ...withCallbacks<void, Error, DeleteMessageParams, DeleteMutationContext>(
      {
        onMutate: async (vars) => {
          await queryClient.cancelQueries({
            queryKey: channelKeys.withID(vars.channelID).queryKey,
          });
          deleteNonce.prepare(vars);
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
          softInvalidateChannelWithID(vars.channelID);
          if (ENABLE_NEW_CHANNELS()) {
            softInvalidateTargetCaches(
              vars.channelID,
              resolveMessageTarget({
                channelId: vars.channelID,
                messageId: vars.messageID,
                threadId: vars.threadID,
              })
            );
          }
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
  attachmentIDsToDelete?: string[];
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
          await commsServiceClient.patchMessage({
            channel_id: vars.channelID,
            message_id: vars.messageID,
            content: vars.content,
            attachment_ids_to_delete: vars.attachmentIDsToDelete,
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
          await queryClient.cancelQueries({
            queryKey: channelKeys.withID(vars.channelID).queryKey,
          });
          patchNonce.prepare(vars);
          return optimisticUpdateChannelMessage({
            channelId: vars.channelID,
            message_id: vars.messageID,
            content: vars.content,
            attachment_ids_to_delete: vars.attachmentIDsToDelete,
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
          softInvalidateChannelWithID(vars.channelID);
          if (ENABLE_NEW_CHANNELS()) {
            softInvalidateTargetCaches(
              vars.channelID,
              resolveMessageTarget({
                channelId: vars.channelID,
                messageId: vars.messageID,
              })
            );
          }
        },
      },
      callbacks
    ),
  }));
}
