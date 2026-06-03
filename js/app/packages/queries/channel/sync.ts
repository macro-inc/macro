import type { ApiThreadReply } from '@service-storage/client';
import type { ApiChannelContextMessage as ApiMessage } from '@service-storage/generated/schemas/apiChannelContextMessage';
import type { ApiCountedReaction as CountedReaction } from '@service-storage/generated/schemas/apiCountedReaction';
import type { ApiMessageAttachment as ApiAttachment } from '@service-storage/generated/schemas/apiMessageAttachment';
import type { ApiMessageSender } from '@service-storage/generated/schemas/apiMessageSender';
import { consumeNonce } from '../nonce';
import { ChannelNonceKeys } from './keys';
import { senderFromStorageId } from './message-sender';
import {
  getTargetMessageState,
  insertMessageIntoTargetCaches,
  markTopLevelMessageDeletedInTargetCaches,
  removeMessageFromTargetCaches,
  replaceTargetAttachments,
  replaceTargetMessageState,
  replaceTargetReactions,
  resolveMessageTarget,
  softInvalidateTargetCaches,
  topLevelMessageHasReplies,
} from './reconcile';

/**
 * Websocket payload types
 */
type CommsMessagePayload = ApiMessage & {
  channel_id: string;
  nonce: string;
  sender?: ApiMessageSender;
};

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
 * We always call softInvalidateTargetCaches to ensure eventual consistency:
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
      if (payload.deleted_at) {
        const target = resolveMessageTarget({
          channelId: payload.channel_id,
          messageId: payload.id,
          threadId: payload.thread_id ?? undefined,
        });
        if (
          target.kind === 'top_level' &&
          topLevelMessageHasReplies(payload.channel_id, target.messageId)
        ) {
          markTopLevelMessageDeletedInTargetCaches(
            payload.channel_id,
            target,
            payload.deleted_at
          );
        } else {
          removeMessageFromTargetCaches(payload.channel_id, target);
        }
      } else {
        const target = resolveMessageTarget({
          channelId: payload.channel_id,
          messageId: payload.id,
          threadId: payload.thread_id ?? undefined,
        });
        const existingState = getTargetMessageState(payload.channel_id, target);

        if (existingState) {
          replaceTargetMessageState(payload.channel_id, target, {
            content: payload.content,
            editedAt: payload.edited_at,
            updatedAt: payload.updated_at,
            attachments: existingState.attachments,
          });
        } else if (target.kind === 'thread_reply') {
          const reply: ApiThreadReply = {
            id: payload.id,
            sender: payload.sender ?? senderFromStorageId(payload.sender_id),
            sender_id: payload.sender_id,
            content: payload.content,
            created_at: payload.created_at,
            updated_at: payload.updated_at,
            edited_at: payload.edited_at,
            attachments: [],
            reactions: [],
          };
          insertMessageIntoTargetCaches(payload.channel_id, target, reply);
        } else {
          insertMessageIntoTargetCaches(payload.channel_id, target, {
            id: payload.id,
            channel_id: payload.channel_id,
            sender: payload.sender ?? senderFromStorageId(payload.sender_id),
            sender_id: payload.sender_id,
            content: payload.content,
            created_at: payload.created_at,
            updated_at: payload.updated_at,
            edited_at: payload.edited_at,
            attachments: [],
            reactions: [],
            thread: {
              preview: [],
              reply_count: 0,
              latest_reply_at: null,
            },
          });
        }
      }
    } catch (error) {
      console.error('Failed to update message cache from websocket:', error);
    }
  }

  softInvalidateTargetCaches(
    payload.channel_id,
    resolveMessageTarget({
      channelId: payload.channel_id,
      messageId: payload.id,
      threadId: payload.thread_id ?? undefined,
    })
  );
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

  const target = resolveMessageTarget({
    channelId: payload.channel_id,
    messageId: payload.message_id,
  });

  if (isExternalUpdate) {
    try {
      replaceTargetReactions(payload.channel_id, target, payload.reactions);
    } catch (error) {
      console.error('Failed to update reaction cache from websocket:', error);
    }
  }

  softInvalidateTargetCaches(payload.channel_id, target);
}

/**
 * Handle attachment update from websocket.
 * Updates the cache directly with the new attachments.
 *
 * Soft invalidation ensures eventual consistency across tabs/devices.
 */
export function handleCommsAttachment(payload: CommsAttachmentPayload): void {
  const target = resolveMessageTarget({
    channelId: payload.channel_id,
    messageId: payload.message_id,
  });

  try {
    replaceTargetAttachments(payload.channel_id, target, payload.attachments);
  } catch (error) {
    console.error('Failed to update attachment cache from websocket:', error);
  }
  softInvalidateTargetCaches(payload.channel_id, target);
}
