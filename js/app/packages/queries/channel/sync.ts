import type {
  Attachment,
  CountedReaction,
  Message,
} from '@service-comms/generated/models';
import type { ApiChannelMessage } from '@service-comms/client';
import { queryClient } from '../client';
import {
  softInvalidateChannelMessages,
  type ChannelMessagesData,
} from './channel-messages';
import { channelKeys, ChannelNonceKeys } from './keys';
import { consumeNonce } from '../nonce';

/**
 * Websocket payload types
 */
type CommsMessagePayload = Message & { channel_id: string; nonce: string };

type CommsReactionPayload = {
  channel_id: string;
  message_id: string;
  reactions: CountedReaction[];
  nonce: string;
};

type CommsAttachmentPayload = {
  channel_id: string;
  message_id: string;
  attachments: Attachment[];
  nonce: string;
};

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

/**
 * Handle incoming message from websocket.
 *
 * If the nonce was registered by this client (optimistic update), we skip the cache
 * update since it was already applied. Otherwise, this is an external update
 * (other user, other tab, or server-initiated) and we apply it to the cache.
 *
 * We always call softInvalidateChannelMessages to ensure eventual consistency.
 */
export function handleCommsMessage(payload: CommsMessagePayload): void {
  const isExternalUpdate = !consumeNonce(
    ChannelNonceKeys.MESSAGE,
    payload.nonce
  );

  if (isExternalUpdate) {
    try {
      const queryKey = channelKeys.messages(payload.channel_id).queryKey;
      queryClient.setQueryData<ChannelMessagesData>(queryKey, (prev) => {
        if (!prev?.pages?.length) return prev;

        if (payload.thread_id) {
          // Thread reply: update parent message's thread preview
          return updateMessageInPages(prev, payload.thread_id, (parent) => ({
            ...parent,
            thread: {
              ...parent.thread,
              reply_count: parent.thread.reply_count + 1,
              latest_reply_at: payload.created_at,
              preview: [
                ...parent.thread.preview,
                {
                  id: payload.id,
                  sender_id: payload.sender_id,
                  content: payload.content,
                  created_at: payload.created_at,
                  updated_at: payload.updated_at,
                  edited_at: payload.edited_at ?? null,
                  reactions: [],
                  attachments: [],
                },
              ],
            },
          }));
        }

        // Top-level message: prepend to first page (newest-first order)
        const firstPage = prev.pages[0];
        if (firstPage.items.some((m) => m.id === payload.id)) return prev;

        const newMessage: ApiChannelMessage = {
          id: payload.id,
          channel_id: payload.channel_id,
          sender_id: payload.sender_id,
          content: payload.content,
          created_at: payload.created_at,
          updated_at: payload.updated_at,
          edited_at: payload.edited_at ?? null,
          deleted_at: payload.deleted_at ?? null,
          thread: { reply_count: 0, latest_reply_at: null, preview: [] },
          reactions: [],
          attachments: [],
        };

        return {
          ...prev,
          pages: [
            { ...firstPage, items: [newMessage, ...firstPage.items] },
            ...prev.pages.slice(1),
          ],
        };
      });
    } catch (error) {
      console.error('Failed to update message cache from websocket:', error);
    }
  }

  softInvalidateChannelMessages(payload.channel_id);
}

/**
 * Handle reaction update from websocket.
 * Updates the cache directly with the new reaction state.
 *
 * Soft invalidation ensures eventual consistency across tabs/devices.
 */
export function handleCommsReaction(payload: CommsReactionPayload): void {
  const isExternalUpdate = !consumeNonce(
    ChannelNonceKeys.REACTION,
    payload.nonce
  );

  if (isExternalUpdate) {
    try {
      const queryKey = channelKeys.messages(payload.channel_id).queryKey;
      queryClient.setQueryData<ChannelMessagesData>(queryKey, (prev) => {
        if (!prev?.pages?.length) return prev;

        // Check top-level messages
        for (const page of prev.pages) {
          if (page.items.some((m) => m.id === payload.message_id)) {
            return updateMessageInPages(prev, payload.message_id, (m) => ({
              ...m,
              reactions: payload.reactions,
            }));
          }
        }

        // Check thread replies
        return {
          ...prev,
          pages: prev.pages.map((page) => ({
            ...page,
            items: page.items.map((m) => {
              const replyIdx = m.thread.preview.findIndex(
                (r) => r.id === payload.message_id
              );
              if (replyIdx === -1) return m;
              const updatedPreview = [...m.thread.preview];
              updatedPreview[replyIdx] = {
                ...updatedPreview[replyIdx],
                reactions: payload.reactions,
              };
              return { ...m, thread: { ...m.thread, preview: updatedPreview } };
            }),
          })),
        };
      });
    } catch (error) {
      console.error('Failed to update reaction cache from websocket:', error);
    }
  }

  softInvalidateChannelMessages(payload.channel_id);
}

/**
 * Handle attachment update from websocket.
 * Updates the cache directly with the new attachments.
 *
 * Soft invalidation ensures eventual consistency across tabs/devices.
 */
export function handleCommsAttachment(payload: CommsAttachmentPayload): void {
  const isExternalUpdate = !consumeNonce(
    ChannelNonceKeys.ATTACHMENT,
    payload.nonce
  );

  if (isExternalUpdate) {
    try {
      const queryKey = channelKeys.messages(payload.channel_id).queryKey;
      queryClient.setQueryData<ChannelMessagesData>(queryKey, (prev) => {
        if (!prev?.pages?.length) return prev;

        // Convert old Attachment shape to ApiMessageAttachment
        const toApiAttachment = (a: Attachment) => ({
          id: a.id,
          entity_type: a.entity_type,
          entity_id: a.entity_id,
          created_at: a.created_at,
        });

        // Check top-level messages
        for (const page of prev.pages) {
          if (page.items.some((m) => m.id === payload.message_id)) {
            return updateMessageInPages(prev, payload.message_id, (m) => {
              const existingIds = new Set(m.attachments.map((a) => a.id));
              const newAttachments = payload.attachments
                .filter((a) => !existingIds.has(a.id))
                .map(toApiAttachment);
              return {
                ...m,
                attachments: [...m.attachments, ...newAttachments],
              };
            });
          }
        }

        // Check thread replies
        return {
          ...prev,
          pages: prev.pages.map((page) => ({
            ...page,
            items: page.items.map((m) => {
              const replyIdx = m.thread.preview.findIndex(
                (r) => r.id === payload.message_id
              );
              if (replyIdx === -1) return m;
              const reply = m.thread.preview[replyIdx];
              const existingIds = new Set(reply.attachments.map((a) => a.id));
              const newAttachments = payload.attachments
                .filter((a) => !existingIds.has(a.id))
                .map(toApiAttachment);
              const updatedPreview = [...m.thread.preview];
              updatedPreview[replyIdx] = {
                ...reply,
                attachments: [...reply.attachments, ...newAttachments],
              };
              return { ...m, thread: { ...m.thread, preview: updatedPreview } };
            }),
          })),
        };
      });
    } catch (error) {
      console.error('Failed to update attachment cache from websocket:', error);
    }
  }

  softInvalidateChannelMessages(payload.channel_id);
}
