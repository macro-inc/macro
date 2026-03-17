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
  insertMessageIntoTargetCaches,
  replaceTargetAttachments,
  replaceTargetReactions,
  softInvalidateTargetCaches,
  resolveMessageTarget,
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
          insertMessageIntoTargetCaches(
            payload.channel_id,
            resolveMessageTarget({
              channelId: payload.channel_id,
              messageId: payload.id,
              threadId,
            }),
            reply
          );
        } else {
          insertMessageIntoTargetCaches(
            payload.channel_id,
            resolveMessageTarget({
              channelId: payload.channel_id,
              messageId: payload.id,
            }),
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
    softInvalidateTargetCaches(
      payload.channel_id,
      resolveMessageTarget({
        channelId: payload.channel_id,
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
      queryClient.setQueryData<GetChannelResponse>(queryKey, (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          reactions: {
            ...prev.reactions,
            [payload.message_id]: payload.reactions,
          },
        };
      });

      if (ENABLE_NEW_CHANNELS) {
        const target = resolveMessageTarget({
          channelId: payload.channel_id,
          messageId: payload.message_id,
        });
        replaceTargetReactions(payload.channel_id, target, payload.reactions);
      }
    } catch (error) {
      console.error('Failed to update reaction cache from websocket:', error);
    }
  }

  softInvalidateChannelWithID(payload.channel_id);
  if (ENABLE_NEW_CHANNELS) {
    const target = resolveMessageTarget({
      channelId: payload.channel_id,
      messageId: payload.message_id,
    });
    softInvalidateTargetCaches(payload.channel_id, target);
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
  const target = ENABLE_NEW_CHANNELS
    ? resolveMessageTarget({
        channelId: payload.channel_id,
        messageId: payload.message_id,
      })
    : undefined;

  try {
    const queryKey = channelKeys.withID(payload.channel_id).queryKey;
    queryClient.setQueryData<GetChannelResponse>(queryKey, (prev) => {
      if (!prev) return prev;

      const remainingAttachments = prev.attachments.filter(
        (attachment) => attachment.message_id !== payload.message_id
      );
      const nextAttachments = isExternalUpdate
        ? [
            ...remainingAttachments,
            ...payload.attachments.filter(
              (attachment) =>
                !remainingAttachments.some(
                  (existingAttachment) =>
                    existingAttachment.id === attachment.id
                )
            ),
          ]
        : [...remainingAttachments, ...payload.attachments];

      return {
        ...prev,
        attachments: nextAttachments,
      };
    });

    if (ENABLE_NEW_CHANNELS && target) {
      replaceTargetAttachments(payload.channel_id, target, payload.attachments);
    }
  } catch (error) {
    console.error('Failed to update attachment cache from websocket:', error);
  }

  softInvalidateChannelWithID(payload.channel_id);
  if (ENABLE_NEW_CHANNELS) {
    softInvalidateTargetCaches(payload.channel_id, target);
  }
}
