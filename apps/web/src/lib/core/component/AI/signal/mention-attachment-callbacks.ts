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
  const pendingMentionRequests = new Map<string, symbol>();

  return {
    async onCreate(mention: ItemMention) {
      const request = Symbol(mention.itemId);
      pendingMentionRequests.set(mention.itemId, request);
      const attachment = await resolveAttachment(mention);
      if (pendingMentionRequests.get(mention.itemId) !== request) return;
      pendingMentionRequests.delete(mention.itemId);
      if (attachment) attachments.addAttachment(attachment);
    },
    onRemove(mention: ItemMention) {
      pendingMentionRequests.delete(mention.itemId);
      attachments.removeAttachment(mention.itemId);
    },
  };
}
