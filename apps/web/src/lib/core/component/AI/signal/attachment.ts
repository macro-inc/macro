import { SUPPORTED_ATTACHMENT_EXTENSIONS } from '@core/component/AI/constant';
import { globalAttachableHistory } from '@core/component/AI/signal/globalAttachments';
import type { Attachment, Attachments } from '@core/component/AI/types';
import { asFileType } from '@core/component/AI/util';
import type { ItemMention } from '@core/component/LexicalMarkdown/plugins/mentions';
import { ENABLE_CHAT_CHANNEL_ATTACHMENT } from '@core/constant/featureFlags';
import { getItemPreview, isAccessiblePreviewItem } from '@queries/preview';
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

export const useGetChatAttachmentInfo = () => {
  const resolveDocumentFileType = async (
    id: string
  ): Promise<string | undefined> => {
    try {
      const preview = await getItemPreview(
        { id, type: 'document' },
        { requireFresh: true }
      );
      if (!isAccessiblePreviewItem(preview) || preview.type !== 'document')
        return;
      return preview.fileType;
    } catch {
      return undefined;
    }
  };

  const getDocumentAttachment = async (
    id: string,
    fileType?: string | null
  ): Promise<Attachment | undefined> => {
    // Legacy mention nodes use an empty file type, so resolve those through
    // the imperative preview reader rather than a synchronous UI cache.
    const knownFileType = fileType || (await resolveDocumentFileType(id));
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

  const getChannelAttachment = ({
    itemId: id,
  }: ItemMention): Attachment | undefined => {
    if (!ENABLE_CHAT_CHANNEL_ATTACHMENT) return;

    return {
      entity_id: id,
      entity_type: 'channel',
    };
  };

  const mentionToAttachment = async (
    mention: ItemMention
  ): Promise<Attachment | undefined> => {
    if (mention.itemType === 'document') {
      return await getDocumentAttachment(mention.itemId, mention.fileType);
    } else if (mention.itemType === 'skill') {
      return { entity_id: mention.itemId, entity_type: 'skill' };
    } else if (mention.itemType === 'call') {
      return { entity_id: mention.itemId, entity_type: 'document' };
    } else if (mention.itemType === 'channel') {
      return getChannelAttachment(mention);
    } else if (mention.itemType === 'thread') {
      return { entity_id: mention.itemId, entity_type: 'email_thread' };
    } else if (mention.itemType === 'project') {
      return { entity_id: mention.itemId, entity_type: 'project' };
    }
  };

  return {
    getDocumentAttachment,
    getChannelAttachment,
    getAttachmentFromMention: mentionToAttachment,
  };
};
