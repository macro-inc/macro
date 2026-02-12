import type {
  Attachment as ApiAttachment,
  CountedReaction,
  Message as ApiMessage,
} from '@service-comms/generated/models';
import type { GetChannelResponse } from './types';
import { queryClient } from '../client';
import { softInvalidateChannelWithID } from './channel';
import { channelKeys, ChannelNonceKeys } from './keys';
import { consumeNonce } from '../nonce';

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
    } catch (error) {
      console.error('Failed to update message cache from websocket:', error);
    }
  }

  softInvalidateChannelWithID(payload.channel_id);
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
    } catch (error) {
      console.error('Failed to update reaction cache from websocket:', error);
    }
  }

  softInvalidateChannelWithID(payload.channel_id);
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
