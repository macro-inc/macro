import type {
  Attachment,
  CountedReaction,
  GetChannelResponse,
  Message,
} from '@service-comms/generated/models';
import { queryClient } from '../client';
import { channelKeys } from './keys';
import { softInvalidateChannelWithID } from './channel';

/**
 * Websocket payload types
 */
type CommsMessagePayload = Message & { channel_id: string };

type CommsReactionPayload = {
  channel_id: string;
  message_id: string;
  reactions: CountedReaction[];
};

type CommsAttachmentPayload = {
  channel_id: string;
  message_id: string;
  attachments: Attachment[];
};

/**
 * Handle incoming message from websocket.
 * Always invalidate to ensure cross-tab/cross-device sync.
 */
export function handleCommsMessage(payload: CommsMessagePayload): void {
  // Invalidate to refetch fresh data from server
  const queryKey = channelKeys.withID(payload.channel_id).queryKey;
  queryClient.setQueryData<GetChannelResponse>(queryKey, (prev) => {
    if (!prev) return prev;
    return {
      ...prev,
      messages: [...prev.messages, payload],
    }
  })
  softInvalidateChannelWithID(payload.channel_id);
}

/**
 * Handle reaction update from websocket.
 * Updates the cache directly with the new reaction state.
 */
export function handleCommsReaction(payload: CommsReactionPayload): void {
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

  softInvalidateChannelWithID(payload.channel_id);
}

/**
 * Handle attachment update from websocket.
 * Updates the cache directly with the new attachments.
 */
export function handleCommsAttachment(payload: CommsAttachmentPayload): void {
  const queryKey = channelKeys.withID(payload.channel_id).queryKey;

  queryClient.setQueryData<GetChannelResponse>(queryKey, (prev) => {
    if (!prev) return prev;

    // Merge new attachments, avoiding duplicates by id
    const existingIds = new Set(prev.attachments.map((a) => a.id));
    const newAttachments = payload.attachments.filter(
      (a) => !existingIds.has(a.id)
    );

    return {
      ...prev,
      attachments: [...prev.attachments, ...newAttachments],
    };
  });

  softInvalidateChannelWithID(payload.channel_id);
}
