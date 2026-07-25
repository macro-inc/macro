import type { Attachment } from '@core/component/AI/types';

const ITEM_ATTACHMENT_TYPES = new Set<Attachment['entity_type']>([
  'channel',
  'document',
  'email_thread',
  'project',
]);

function mentionedEntityIds(content: string): Set<string> {
  const ids = new Set<string>();
  const mentions = content.matchAll(
    /<m-document-mention>([\s\S]*?)<\/m-document-mention>/g
  );

  for (const match of mentions) {
    try {
      const data = JSON.parse(match[1]);
      if (typeof data.documentId === 'string') ids.add(data.documentId);
    } catch {
      // Malformed mention markup is rendered as an unknown mention. It should
      // not hide an otherwise usable attachment preview.
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
  const mentionedIds = mentionedEntityIds(content);

  return {
    images: attachments.filter(
      (attachment) => attachment.entity_type === 'static_file'
    ),
    items: attachments.filter(
      (attachment) =>
        ITEM_ATTACHMENT_TYPES.has(attachment.entity_type) &&
        !mentionedIds.has(attachment.entity_id)
    ),
  };
}
