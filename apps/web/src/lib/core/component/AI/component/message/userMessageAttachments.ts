import type { Attachment } from '@core/component/AI/types';
import { getMentionedItemIds } from '@core/util/documentMentions';

const ITEM_ATTACHMENT_TYPES = new Set<Attachment['entity_type']>([
  'channel',
  'document',
  'email_thread',
  'project',
]);

export function getVisibleUserMessageAttachments(
  content: string,
  attachments: Attachment[]
): {
  images: Attachment[];
  items: Attachment[];
} {
  const mentionedItemIds = getMentionedItemIds(content);

  return {
    images: attachments.filter(
      (attachment) => attachment.entity_type === 'static_file'
    ),
    items: attachments.filter(
      (attachment) =>
        ITEM_ATTACHMENT_TYPES.has(attachment.entity_type) &&
        !mentionedItemIds.has(attachment.entity_id)
    ),
  };
}
