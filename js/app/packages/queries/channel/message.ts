import { TrackingEvents, withAnalytics } from '@coparse/analytics';
import { toast } from '@core/component/Toast/Toast';
import { throwOnErr } from '@core/util/maybeResult';
import {
  softInvalidateChannelMessages,
  type ChannelMessagesData,
} from '@queries/channel/channel-messages';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import {
  commsServiceClient,
  type ApiChannelMessage,
  type ApiThreadReply,
  type IdResponse,
  type MessageResponse,
} from '@service-comms/client';
import type { PostMessageRequest } from '@service-comms/generated/models';
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

/**
 * Map across all pages to find and update a specific message by ID.
 */
function updateMessageInPages(
  data: ChannelMessagesData,
  messageId: string,
  updater: (message: ApiChannelMessage) => ApiChannelMessage
): ChannelMessagesData {
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((m) => (m.id === messageId ? updater(m) : m)),
    })),
  };
}

type WithChannelId<T> = T & { channelId: string };
type WithOptimisticId<T> = T & { optimisticId: string };
type WithSenderId<T> = T & { senderId: string };

export type InsertMessageContext = {
  optimisticId: string;
};

export type DeleteMessageContext = {
  deletedMessage?: ApiChannelMessage;
  threadParentId?: string;
  deletedReply?: ApiThreadReply;
};

export type UpdateMessageContext = {
  messageId: string;
  previousContent: string;
  previousEditedAt: string | null | undefined;
  previousUpdatedAt: string;
};

/**
 * Optimistically insert a new message into the channel messages cache.
 * Handles both top-level messages and thread replies.
 */
export function optimisticInsertChannelMessage(
  vars: WithChannelId<WithOptimisticId<WithSenderId<PostMessageRequest>>>
): InsertMessageContext | undefined {
  const queryKey = channelKeys.messages(vars.channelId).queryKey;
  queryClient.cancelQueries({ queryKey });

  let context: InsertMessageContext | undefined;
  const now = new Date().toISOString();

  queryClient.setQueryData<ChannelMessagesData>(queryKey, (prev) => {
    if (!prev?.pages?.length) return prev;

    context = { optimisticId: vars.optimisticId };

    const optimisticAttachments = vars.attachments.map((a) => ({
      id: crypto.randomUUID(),
      entity_type: a.entity_type,
      entity_id: a.entity_id,
      created_at: now,
    }));

    if (vars.thread_id) {
      // Thread reply: update parent's thread preview
      return updateMessageInPages(prev, vars.thread_id, (parent) => ({
        ...parent,
        thread: {
          ...parent.thread,
          reply_count: parent.thread.reply_count + 1,
          latest_reply_at: now,
          preview: [
            ...parent.thread.preview,
            {
              id: vars.optimisticId,
              sender_id: vars.senderId,
              content: vars.content,
              created_at: now,
              updated_at: now,
              edited_at: null,
              reactions: [],
              attachments: optimisticAttachments,
            },
          ],
        },
      }));
    }

    // Top-level message: prepend to first page
    const newMessage: ApiChannelMessage = {
      id: vars.optimisticId,
      channel_id: vars.channelId,
      sender_id: vars.senderId,
      content: vars.content,
      created_at: now,
      updated_at: now,
      edited_at: null,
      deleted_at: null,
      thread: { reply_count: 0, latest_reply_at: null, preview: [] },
      reactions: [],
      attachments: optimisticAttachments,
    };

    const firstPage = prev.pages[0];
    return {
      ...prev,
      pages: [
        { ...firstPage, items: [newMessage, ...firstPage.items] },
        ...prev.pages.slice(1),
      ],
    };
  });

  return context;
}

/**
 * Rollback an optimistic message insert by removing the optimistic message.
 * Searches both top-level messages and thread previews.
 */
export function rollbackInsertChannelMessage(
  channelId: string,
  context: InsertMessageContext
): void {
  const queryKey = channelKeys.messages(channelId).queryKey;

  queryClient.setQueryData<ChannelMessagesData>(queryKey, (prev) => {
    if (!prev?.pages?.length) return prev;

    return {
      ...prev,
      pages: prev.pages.map((page) => ({
        ...page,
        items: page.items
          .filter((m) => m.id !== context.optimisticId)
          .map((m) => {
            if (m.thread.preview.some((r) => r.id === context.optimisticId)) {
              return {
                ...m,
                thread: {
                  ...m.thread,
                  reply_count: m.thread.reply_count - 1,
                  preview: m.thread.preview.filter(
                    (r) => r.id !== context.optimisticId
                  ),
                },
              };
            }
            return m;
          }),
      })),
    };
  });
}

/**
 * Replace an optimistic message ID with the real server-assigned ID.
 * Searches both top-level messages and thread previews.
 */
export function replaceOptimisticMessage(
  vars: WithChannelId<{ optimisticId: string; realId: string }>
): void {
  const queryKey = channelKeys.messages(vars.channelId).queryKey;

  queryClient.setQueryData<ChannelMessagesData>(queryKey, (prev) => {
    if (!prev?.pages?.length) return prev;

    return {
      ...prev,
      pages: prev.pages.map((page) => ({
        ...page,
        items: page.items.map((m) => {
          if (m.id === vars.optimisticId) {
            return { ...m, id: vars.realId };
          }
          if (m.thread.preview.some((r) => r.id === vars.optimisticId)) {
            return {
              ...m,
              thread: {
                ...m.thread,
                preview: m.thread.preview.map((r) =>
                  r.id === vars.optimisticId ? { ...r, id: vars.realId } : r
                ),
              },
            };
          }
          return m;
        }),
      })),
    };
  });
}

/**
 * Optimistically delete a message from the channel messages cache.
 * Searches both top-level messages and thread previews.
 */
export function optimisticDeleteChannelMessage(
  vars: WithChannelId<{ messageId: string }>
): DeleteMessageContext | undefined {
  const queryKey = channelKeys.messages(vars.channelId).queryKey;
  queryClient.cancelQueries({ queryKey });

  let context: DeleteMessageContext | undefined;

  queryClient.setQueryData<ChannelMessagesData>(queryKey, (prev) => {
    if (!prev?.pages?.length) return prev;

    // Check top-level messages
    for (const page of prev.pages) {
      const msg = page.items.find((m) => m.id === vars.messageId);
      if (msg) {
        context = { deletedMessage: msg };
        return {
          ...prev,
          pages: prev.pages.map((p) => ({
            ...p,
            items: p.items.filter((m) => m.id !== vars.messageId),
          })),
        };
      }
    }

    // Check thread replies
    for (const page of prev.pages) {
      for (const msg of page.items) {
        const reply = msg.thread.preview.find((r) => r.id === vars.messageId);
        if (reply) {
          context = { threadParentId: msg.id, deletedReply: reply };
          return updateMessageInPages(prev, msg.id, (m) => ({
            ...m,
            thread: {
              ...m.thread,
              reply_count: m.thread.reply_count - 1,
              preview: m.thread.preview.filter((r) => r.id !== vars.messageId),
            },
          }));
        }
      }
    }

    return prev;
  });

  return context;
}

/**
 * Rollback an optimistic message delete by restoring the deleted data.
 */
export function rollbackDeleteChannelMessage(
  channelId: string,
  context: DeleteMessageContext
): void {
  const queryKey = channelKeys.messages(channelId).queryKey;

  queryClient.setQueryData<ChannelMessagesData>(queryKey, (prev) => {
    if (!prev?.pages?.length) return prev;

    if (context.deletedMessage) {
      // Re-insert top-level message at start of first page
      const firstPage = prev.pages[0];
      return {
        ...prev,
        pages: [
          {
            ...firstPage,
            items: [context.deletedMessage, ...firstPage.items],
          },
          ...prev.pages.slice(1),
        ],
      };
    }

    if (context.threadParentId && context.deletedReply) {
      return updateMessageInPages(prev, context.threadParentId, (m) => ({
        ...m,
        thread: {
          ...m.thread,
          reply_count: m.thread.reply_count + 1,
          preview: [...m.thread.preview, context.deletedReply!],
        },
      }));
    }

    return prev;
  });
}

/**
 * Optimistically update a message's content in the channel messages cache.
 * Searches both top-level messages and thread previews.
 */
export function optimisticUpdateChannelMessage(
  vars: WithChannelId<{ messageId: string; content: string }>
): UpdateMessageContext | undefined {
  const queryKey = channelKeys.messages(vars.channelId).queryKey;
  queryClient.cancelQueries({ queryKey });

  let context: UpdateMessageContext | undefined;

  queryClient.setQueryData<ChannelMessagesData>(queryKey, (prev) => {
    if (!prev?.pages?.length) return prev;

    const now = new Date().toISOString();

    // Check top-level messages
    for (const page of prev.pages) {
      const message = page.items.find((m) => m.id === vars.messageId);
      if (message) {
        context = {
          messageId: vars.messageId,
          previousContent: message.content,
          previousEditedAt: message.edited_at,
          previousUpdatedAt: message.updated_at,
        };
        return updateMessageInPages(prev, vars.messageId, (m) => ({
          ...m,
          content: vars.content,
          edited_at: now,
          updated_at: now,
        }));
      }
    }

    // Check thread replies
    for (const page of prev.pages) {
      for (const msg of page.items) {
        const reply = msg.thread.preview.find((r) => r.id === vars.messageId);
        if (reply) {
          context = {
            messageId: vars.messageId,
            previousContent: reply.content,
            previousEditedAt: reply.edited_at,
            previousUpdatedAt: reply.updated_at,
          };
          return {
            ...prev,
            pages: prev.pages.map((p) => ({
              ...p,
              items: p.items.map((m) => {
                if (m.id !== msg.id) return m;
                return {
                  ...m,
                  thread: {
                    ...m.thread,
                    preview: m.thread.preview.map((r) =>
                      r.id === vars.messageId
                        ? {
                            ...r,
                            content: vars.content,
                            edited_at: now,
                            updated_at: now,
                          }
                        : r
                    ),
                  },
                };
              }),
            })),
          };
        }
      }
    }

    return prev;
  });

  return context;
}

/**
 * Rollback an optimistic message update by restoring previous content.
 */
export function rollbackUpdateChannelMessage(
  channelId: string,
  context: UpdateMessageContext
): void {
  const queryKey = channelKeys.messages(channelId).queryKey;

  queryClient.setQueryData<ChannelMessagesData>(queryKey, (prev) => {
    if (!prev?.pages?.length) return prev;

    // Try top-level first
    for (const page of prev.pages) {
      if (page.items.some((m) => m.id === context.messageId)) {
        return updateMessageInPages(prev, context.messageId, (m) => ({
          ...m,
          content: context.previousContent,
          edited_at: context.previousEditedAt ?? null,
          updated_at: context.previousUpdatedAt,
        }));
      }
    }

    // Try thread replies
    return {
      ...prev,
      pages: prev.pages.map((page) => ({
        ...page,
        items: page.items.map((m) => {
          if (!m.thread.preview.some((r) => r.id === context.messageId))
            return m;
          return {
            ...m,
            thread: {
              ...m.thread,
              preview: m.thread.preview.map((r) =>
                r.id === context.messageId
                  ? {
                      ...r,
                      content: context.previousContent,
                      edited_at: context.previousEditedAt ?? null,
                      updated_at: context.previousUpdatedAt,
                    }
                  : r
              ),
            },
          };
        }),
      })),
    };
  });
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
          softInvalidateChannelMessages(variables.channelID);
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
            messageId: vars.messageID,
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
          softInvalidateChannelMessages(vars.channelID);
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
            messageId: vars.messageID,
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
          softInvalidateChannelMessages(vars.channelID);
        },
      },
      callbacks
    ),
  }));
}
