import { TrackingEvents, withAnalytics } from '@coparse/analytics';
import { toast } from '@core/component/Toast/Toast';
import type { DateValue } from '@core/util/date';
import { throwOnErr } from '@core/util/maybeResult';
import { softInvalidateChannelWithID } from '@queries/channel/channel';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import {
  commsServiceClient,
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

type WithChannelId<T> = T & { channelId: string };
type WithOptimisticId<T> = T & { optimisticId: string };
type WithSenderId<T> = T & { senderId: string };

export type InsertMessageContext = {
  optimisticId: string;
};

export type DeleteMessageContext = {
  deletedMessage: Message;
  deletedReactions: CountedReaction[];
  deletedAttachments: Attachment[];
};

export type UpdateMessageContext = {
  messageId: string;
  previousContent: string;
  previousEditedAt: DateValue | null | undefined;
  previousUpdatedAt: DateValue;
};

/**
 * Optimistically insert a new message into the channel cache.
 * Returns minimal context for rollback (just the optimistic ID).
 */
export function optimisticInsertChannelMessage(
  vars: WithChannelId<WithOptimisticId<WithSenderId<PostMessageRequest>>>
): InsertMessageContext | undefined {
  const queryKey = channelKeys.withID(vars.channelId).queryKey;
  queryClient.cancelQueries({ queryKey });

  let context: InsertMessageContext | undefined;

  queryClient.setQueriesData(
    { queryKey },
    (prev: GetChannelResponse | undefined) => {
      if (!prev) return prev;

      context = { optimisticId: vars.optimisticId };
      const now = new Date().toISOString();

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

      const newAttachments: Attachment[] = vars.attachments.map((a) => ({
        id: crypto.randomUUID(),
        channel_id: vars.channelId,
        created_at: new Date().toISOString(),
        message_id: vars.optimisticId,
        ...a,
      }));

      return {
        ...prev,
        messages: [...prev.messages, newMessage],
        attachments: [...prev.attachments, ...newAttachments],
      };
    }
  );

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
}

/**
 * Replace an optimistic message ID with the real server-assigned ID.
 * Called in mutation onSuccess after server returns the real message.
 */
export function replaceOptimisticMessage(
  vars: WithChannelId<{ optimisticId: string; realId: string }>
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

      const updatedMessages = [...prev.messages];
      updatedMessages[messageIndex] = {
        ...updatedMessages[messageIndex],
        id: vars.realId,
      };

      return {
        ...prev,
        messages: updatedMessages,
        attachments: prev.attachments.map((a) =>
          a.message_id === vars.optimisticId
            ? { ...a, message_id: vars.realId }
            : a
        ),
      };
    }
  );
}

/**
 * Optimistically delete a message from the channel cache.
 * Returns minimal context: only the deleted message, reactions, and attachments.
 */
export function optimisticDeleteChannelMessage(
  vars: WithChannelId<Pick<ChannelMessage, 'message_id'>>
): DeleteMessageContext | undefined {
  const queryKey = channelKeys.withID(vars.channelId).queryKey;
  queryClient.cancelQueries({ queryKey });

  let context: DeleteMessageContext | undefined;

  queryClient.setQueriesData(
    { queryKey },
    (prev: GetChannelResponse | undefined) => {
      if (!prev) return prev;

      const deletedMessage = prev.messages.find(
        (m) => m.id === vars.message_id
      );
      if (!deletedMessage) return prev;

      context = {
        deletedMessage,
        deletedReactions: prev.reactions[vars.message_id] ?? [],
        deletedAttachments: prev.attachments.filter(
          (a) => a.message_id === vars.message_id
        ),
      };

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
}

/**
 * Optimistically update a message's content in the channel cache.
 * Returns minimal context: only the previous content and timestamps.
 */
export function optimisticUpdateChannelMessage(
  vars: WithChannelId<Pick<ChannelMessage, 'message_id' | 'content'>>
): UpdateMessageContext | undefined {
  const queryKey = channelKeys.withID(vars.channelId).queryKey;
  queryClient.cancelQueries({ queryKey });

  let context: UpdateMessageContext | undefined;

  queryClient.setQueriesData(
    { queryKey },
    (prev: GetChannelResponse | undefined) => {
      if (!prev) return prev;

      const message = prev.messages.find((m) => m.id === vars.message_id);
      if (!message) return prev;

      context = {
        messageId: vars.message_id,
        previousContent: message.content,
        previousEditedAt: message.edited_at,
        previousUpdatedAt: message.updated_at,
      };

      const now = new Date().toISOString();

      return {
        ...prev,
        messages: prev.messages.map((m) =>
          m.id === vars.message_id
            ? { ...m, content: vars.content, edited_at: now, updated_at: now }
            : m
        ),
      };
    }
  );

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
      };
    }
  );
}

const { track } = withAnalytics();

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
        onMutate: (vars) => {
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
          });
          track(TrackingEvents.BLOCKCHANNEL.MESSAGE.SEND, {
            channelId: variables.channelID,
            contentLength: variables.message.content?.length ?? 0,
            attachmentsLength: variables.message.attachments.length,
            inThread: variables.message.thread_id !== undefined,
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
        },
      },
      callbacks
    ),
  }));
}

type DeleteMessageParams = { channelID: string; messageID: string };

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
        onMutate: (vars) => {
          deleteNonce.prepare(vars);
          return optimisticDeleteChannelMessage({
            channelId: vars.channelID,
            message_id: vars.messageID,
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
        onMutate: (vars) => {
          patchNonce.prepare(vars);
          return optimisticUpdateChannelMessage({
            channelId: vars.channelID,
            message_id: vars.messageID,
            content: vars.content,
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
        },
      },
      callbacks
    ),
  }));
}
