import { SUPPORTED_ATTACHMENT_EXTENSIONS } from '@core/component/AI/constant';
import { globalAttachableHistory } from '@core/component/AI/signal/globalAttachments';
import type { Attachment, Attachments } from '@core/component/AI/types';
import { asFileType } from '@core/component/AI/util';
import type { ItemMention } from '@core/component/LexicalMarkdown/plugins/mentions';
import { ENABLE_CHAT_CHANNEL_ATTACHMENT } from '@core/constant/featureFlags';
import { useChannelsContext } from '@core/context/channels';
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

export const useGetChatAttachmentInfo = () => {
  const { channels } = useChannelsContext();

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

  const getProjectAttachment = (id: string): Attachment | undefined => {
    return {
      entity_id: id,
      entity_type: 'project',
    };
  };

  const getChannelAttachment = ({
    itemId: id,
  }: ItemMention): Attachment | undefined => {
    if (!ENABLE_CHAT_CHANNEL_ATTACHMENT) return;

    const item = channels().find((item) => item.id === id);
    if (!item) return;

    return {
      entity_id: item.id,
      entity_type: 'channel',
    };
  };

  const getEmailAttachment = (mention: ItemMention): Attachment | undefined => {
    return {
      entity_id: mention.itemId,
      entity_type: 'email_thread',
    };
  };

  const mentionToAttachment = (
    mention: ItemMention
  ): Attachment | undefined => {
    if (mention.itemType === 'document') {
      return getDocumentAttachment(mention.itemId, mention.fileType);
    } else if (mention.itemType === 'channel') {
      return getChannelAttachment(mention);
    } else if (mention.itemType === 'thread') {
      return getEmailAttachment(mention);
    } else if (mention.itemType === 'project') {
      return getProjectAttachment(mention.itemId);
    }
  };

  return {
    getDocumentAttachment,
    getChannelAttachment,
    getAttachmentFromMention: mentionToAttachment,
  };
};
