import { STATIC_IMAGE, STATIC_VIDEO } from '@core/store/cacheChannelInput';
import type { PostMessageRequest } from '@service-comms/generated/models';
import type { InputAttachmentData, InputSnapshot } from './types';

function attachmentEntityType(
  attachment: Pick<InputAttachmentData, 'kind'>
): string {
  switch (attachment.kind) {
    case 'image':
      return STATIC_IMAGE;
    case 'video':
      return STATIC_VIDEO;
    case 'document':
      return 'document';
  }
}

export function buildPostMessageRequest(
  snapshot: InputSnapshot,
  threadId?: string
): PostMessageRequest {
  return {
    content: snapshot.value,
    thread_id: threadId,
    mentions: snapshot.mentions.map((mention) => ({
      entity_id: mention.itemId,
      entity_type: mention.itemType,
    })),
    attachments: snapshot.attachments.map((attachment) => ({
      entity_id: attachment.id,
      entity_type: attachmentEntityType(attachment),
    })),
  };
}
