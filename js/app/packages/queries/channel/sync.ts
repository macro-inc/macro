import type {
  Attachment as ApiAttachment,
  CountedReaction,
  Message as ApiMessage,
} from '@service-comms/generated/models';
import { ENABLE_NEW_CHANNELS } from '@core/constant/featureFlags';
import type { ApiThreadReply } from '@service-comms/client';
import type { GetChannelResponse } from './types';
import { queryClient } from '../client';
import { softInvalidateChannelWithID } from './channel';
import { channelKeys, ChannelNonceKeys } from './keys';
import { consumeNonce } from '../nonce';
import {
  createMessageTarget,
  insertTargetMessage,
  replaceTargetReactions,
  softInvalidateTarget,
} from './reconcile';

/**
 * Websocket payload types
 */
type CommsMessagePayload = ApiMessage & { channel_id: string; nonce: string };

type CommsReactionPayload = {
  channel_id: string;
  message_id: string;
  reactions: CountedReaction[];
  nonce: string;
};

type CommsAttachmentPayload = {
  channel_id: string;
  message_id: string;
  attachments: ApiAttachment[];
  nonce: string;
};

/**
 * Handle incoming message from websocket.
 *
 * If the nonce was registered by this client (optimistic update), we skip the cache
 * update since it was already applied. Otherwise, this is an external update
 * (other user, other tab, or server-initiated) and we apply it to the cache.
 *
 * We always call softInvalidateChannelWithID to ensure eventual consistency:
 * - Marks query as stale for background refetch when component remounts
 * - Handles cross-tab sync where optimistic state may differ
 * - Catches edge cases like server-side message modifications
 */
export function handleCommsMessage(payload: CommsMessagePayload): void {
  const isExternalUpdate = !consumeNonce(
    ChannelNonceKeys.MESSAGE,
    payload.nonce
  );

  if (isExternalUpdate) {
    try {
      const queryKey = channelKeys.withID(payload.channel_id).queryKey;
      queryClient.setQueryData<GetChannelResponse>(queryKey, (prev) => {
        if (!prev) return prev;

        if (prev.messages.some((m) => m.id === payload.id)) {
          return prev;
        }

        return {
          ...prev,
          messages: [...prev.messages, payload],
        };
      });

      if (ENABLE_NEW_CHANNELS) {
        const threadId = payload.thread_id;
        if (threadId) {
          const reply: ApiThreadReply = {
            id: payload.id,
            sender_id: payload.sender_id,
            content: payload.content,
            created_at: payload.created_at,
            updated_at: payload.updated_at,
            edited_at: payload.edited_at,
            attachments: [],
            reactions: [],
          };
          insertTargetMessage(
            payload.channel_id,
            createMessageTarget({ messageId: payload.id, threadId }),
            reply
          );
        } else {
          insertTargetMessage(
            payload.channel_id,
            createMessageTarget({ messageId: payload.id }),
            {
              id: payload.id,
              channel_id: payload.channel_id,
              sender_id: payload.sender_id,
              content: payload.content,
              created_at: payload.created_at,
              updated_at: payload.updated_at,
              deleted_at: payload.deleted_at,
              edited_at: payload.edited_at,
              attachments: [],
              reactions: [],
              thread: {
                preview: [],
                reply_count: 0,
                latest_reply_at: null,
              },
            }
          );
        }
      }
    } catch (error) {
      console.error('Failed to update message cache from websocket:', error);
    }
  }

  softInvalidateChannelWithID(payload.channel_id);
  if (ENABLE_NEW_CHANNELS) {
    softInvalidateTarget(
      payload.channel_id,
      createMessageTarget({
        messageId: payload.id,
        threadId: payload.thread_id ?? undefined,
      })
    );
  }
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
      const queryKey = channelKeys.withID(payload.channel_id).queryKey;
      let threadId: string | undefined;
      queryClient.setQueryData<GetChannelResponse>(queryKey, (prev) => {
        if (!prev) return prev;
        threadId =
          prev.messages.find((message) => message.id === payload.message_id)
            ?.thread_id ?? undefined;
        return {
          ...prev,
          reactions: {
            ...prev.reactions,
            [payload.message_id]: payload.reactions,
          },
        };
      });

      if (ENABLE_NEW_CHANNELS) {
        replaceTargetReactions(
          payload.channel_id,
          createMessageTarget({
            messageId: payload.message_id,
            threadId,
          }),
          payload.reactions
        );
      }
    } catch (error) {
      console.error('Failed to update reaction cache from websocket:', error);
    }
  }

  softInvalidateChannelWithID(payload.channel_id);
  if (ENABLE_NEW_CHANNELS) {
    const threadId =
      queryClient
        .getQueryData<GetChannelResponse>(
          channelKeys.withID(payload.channel_id).queryKey
        )
        ?.messages.find((message) => message.id === payload.message_id)
        ?.thread_id ?? undefined;
    softInvalidateTarget(
      payload.channel_id,
      createMessageTarget({
        messageId: payload.message_id,
        threadId,
      })
    );
  }
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
      const queryKey = channelKeys.withID(payload.channel_id).queryKey;
      queryClient.setQueryData<GetChannelResponse>(queryKey, (prev) => {
        if (!prev) return prev;

        const existingIds = new Set(prev.attachments.map((a) => a.id));
        const newAttachments = payload.attachments.filter(
          (a) => !existingIds.has(a.id)
        );

        return {
          ...prev,
          attachments: [...prev.attachments, ...newAttachments],
        };
      });
    } catch (error) {
      console.error('Failed to update attachment cache from websocket:', error);
    }
  }

  softInvalidateChannelWithID(payload.channel_id);
}
