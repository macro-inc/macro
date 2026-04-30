import { SUPPORTED_ATTACHMENT_EXTENSIONS } from '@core/component/AI/constant';
import { globalAttachableHistory } from '@core/component/AI/signal/globalAttachments';
import type { Attachment, Attachments } from '@core/component/AI/types';
import { asFileType } from '@core/component/AI/util';
import type { ItemMention } from '@core/component/LexicalMarkdown/plugins/mentions';
import { ENABLE_CHAT_CHANNEL_ATTACHMENT } from '@core/constant/featureFlags';
import { useChannelsContext } from '@core/context/channels';
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
  const history = useChatAttachableHistory();
  const { channels } = useChannelsContext();

  const getDocumentAttachment = (id: string): Attachment | undefined => {
    const item = history().find((item) => item.id === id);
    if (!item) return;
    if (item.type !== 'document') return;

    const fileType = asFileType(item.fileType);

    if (!fileType) {
      console.error('Invalid file type', item.fileType);
      return;
    } else if (!SUPPORTED_ATTACHMENT_EXTENSIONS.includes(fileType)) {
      console.error('Invalid file type', item.fileType);
      return;
    }

    return {
      entity_id: item.id,
      entity_type: 'document',
    };
  };

  const getProjectAttachment = (id: string): Attachment | undefined => {
    const item = history().find((item) => item.id === id);
    if (!item || item.type !== 'project') return;
    return {
      entity_id: item.id,
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
      return getDocumentAttachment(mention.itemId);
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
