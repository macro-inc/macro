import type { Attachment, Attachments } from '@core/component/AI/types';
import type { ItemMention } from '@core/component/LexicalMarkdown/plugins/mentions';

type MentionAttachmentLifecycleOptions = {
  attachments: Attachments;
  getAttachment: (mention: ItemMention) => Attachment | undefined;
};

type TrackedMention = {
  attachment: Attachment;
  count: number;
};

const mentionKey = (mention: ItemMention) =>
  `${mention.itemType}:${mention.itemId}`;

export function createMentionAttachmentLifecycle(
  options: MentionAttachmentLifecycleOptions
): {
  onCreate: (mention: ItemMention) => void;
  onRemove: (mention: ItemMention) => void;
} {
  const trackedMentions = new Map<string, TrackedMention>();

  return {
    onCreate: (mention) => {
      const attachment = options.getAttachment(mention);
      if (!attachment) return;

      const key = mentionKey(mention);
      const tracked = trackedMentions.get(key);
      trackedMentions.set(key, {
        attachment,
        count: (tracked?.count ?? 0) + 1,
      });
      options.attachments.addAttachment(attachment);
    },
    onRemove: (mention) => {
      const key = mentionKey(mention);
      const tracked = trackedMentions.get(key);

      if (!tracked) {
        options.attachments.removeAttachment(mention.itemId);
        return;
      }
      if (tracked.count > 1) {
        trackedMentions.set(key, {
          ...tracked,
          count: tracked.count - 1,
        });
        return;
      }

      trackedMentions.delete(key);
      options.attachments.removeAttachment(tracked.attachment.entity_id);
    },
  };
}
