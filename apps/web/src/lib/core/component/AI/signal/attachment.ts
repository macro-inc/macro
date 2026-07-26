import { SUPPORTED_ATTACHMENT_EXTENSIONS } from '@core/component/AI/constant';
import { globalAttachableHistory } from '@core/component/AI/signal/globalAttachments';
import type { Attachment, Attachments } from '@core/component/AI/types';
import { asFileType } from '@core/component/AI/util';
import { getDirectMentionAttachment } from '@core/component/AI/util/directMentionAttachment';
import type { ItemMention } from '@core/component/LexicalMarkdown/plugins/mentions';
import {
  getCachedItemPreview,
  isAccessiblePreviewItem,
} from '@queries/preview';
import { createSignal } from 'solid-js';

export function useAttachments(initial?: Attachment[]): Attachments {
  const [attachments, setAttachments] = createSignal<Attachment[]>(
    initial ?? []
  );

  const addAttachment = (newAttachment: Attachment) => {
    // dedup
    if (
      attachments().some(
        (attached) => attached.entity_id === newAttachment.entity_id
      )
    )
      return;
    setAttachments((p) => [...p, newAttachment]);
  };

  const removeAttachment = (id: string) => {
    const attached = attachments();
    const newAttachments = attached.filter((a) => a.entity_id !== id);
    setAttachments(newAttachments);
  };

  return {
    attached: attachments,
    setAttached: setAttachments,
    addAttachment,
    removeAttachment,
  };
}

export const useChatAttachableHistory = () => {
  return globalAttachableHistory;
};

export const getChatAttachmentInfo = () => {
  // fallback for callers that only have an id: the mentions menu and
  // attachment pickers render previews, so the item is usually cached
  const cachedDocumentFileType = (id: string): string | undefined => {
    const preview = getCachedItemPreview(id);
    if (!preview || !isAccessiblePreviewItem(preview)) return;
    if (preview.type !== 'document') return;
    return preview.fileType;
  };

  const getDocumentAttachment = (
    id: string,
    fileType?: string | null
  ): Attachment | undefined => {
    // mention nodes use '' when the block name has no file type mapping,
    // so empty string falls back to the cache too
    const knownFileType = fileType || cachedDocumentFileType(id);
    const validFileType = asFileType(knownFileType);

    if (!validFileType) {
      console.error('Invalid file type', knownFileType);
      return;
    } else if (!SUPPORTED_ATTACHMENT_EXTENSIONS.includes(validFileType)) {
      console.error('Invalid file type', knownFileType);
      return;
    }

    return {
      entity_id: id,
      entity_type: 'document',
    };
  };

  const mentionToAttachment = (
    mention: ItemMention
  ): Attachment | undefined => {
    const directAttachment = getDirectMentionAttachment(mention);
    if (directAttachment) return directAttachment;

    if (mention.itemType === 'document') {
      return getDocumentAttachment(mention.itemId, mention.fileType);
    }
  };

  return {
    getDocumentAttachment,
    getAttachmentFromMention: mentionToAttachment,
  };
};
