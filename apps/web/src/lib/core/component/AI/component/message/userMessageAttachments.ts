import type { Attachment } from '@core/component/AI/types';

const ITEM_ATTACHMENT_TYPES = new Set<Attachment['entity_type']>([
  'channel',
  'document',
  'email_thread',
  'project',
]);

const DOCUMENT_MENTION_PATTERN =
  /<m-document-mention>([\s\S]*?)<\/m-document-mention>/g;

function getMentionedItemIds(content: string): Set<string> {
  const ids = new Set<string>();

  for (const match of content.matchAll(DOCUMENT_MENTION_PATTERN)) {
    try {
      const mention = JSON.parse(match[1]);
      if (
        mention &&
        typeof mention === 'object' &&
        typeof mention.documentId === 'string' &&
        'documentName' in mention
      ) {
        ids.add(mention.documentId);
      }
    } catch {
      // Malformed mention markup renders as an unknown item, not a reference.
    }
  }

  return ids;
}

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
