import type { Attachment, Attachments } from '@core/component/AI/types';
import type { ItemMention } from '@core/component/LexicalMarkdown/plugins/mentions';

type AttachmentResolver = (
  mention: ItemMention
) => Promise<Attachment | undefined>;

/** Creates race-safe mention callbacks for one chat attachment collection. */
export function createMentionAttachmentCallbacks(
  attachments: Pick<Attachments, 'addAttachment' | 'removeAttachment'>,
  resolveAttachment: AttachmentResolver
) {
  const pendingMentionIds = new Set<string>();

  return {
    async onCreate(mention: ItemMention) {
      pendingMentionIds.add(mention.itemId);
      const attachment = await resolveAttachment(mention);
      const isStillPresent = pendingMentionIds.delete(mention.itemId);
      if (attachment && isStillPresent) {
        attachments.addAttachment(attachment);
      }
    },
    onRemove(mention: ItemMention) {
      pendingMentionIds.delete(mention.itemId);
      attachments.removeAttachment(mention.itemId);
    },
  };
}
