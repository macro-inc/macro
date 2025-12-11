import {
  SUPPORTED_ATTACHMENT_EXTENSIONS,
  SUPPORTED_CHAT_ATTACHMENT_BLOCKS,
} from '@core/component/AI/constant';
import type { Attachment, Attachments } from '@core/component/AI/types';
import { asFileType } from '@core/component/AI/util';
import { useChannelsContext } from '@core/component/ChannelsProvider';
import type { ItemMention } from '@core/component/LexicalMarkdown/plugins/mentions';
import { ENABLE_CHAT_CHANNEL_ATTACHMENT } from '@core/constant/featureFlags';
import { getItemBlockName } from '@core/util/getItemBlockName';
import { useEmails } from '@macro-entity';
import { useHistory } from '@service-storage/history';
import { createMemo, createSignal } from 'solid-js';

export function useAttachments(initial?: Attachment[]): Attachments {
  const [attachments, setAttachments] = createSignal<Attachment[]>(
    initial ?? []
  );

  const addAttachment = (newAttachment: Attachment) => {
    // dedup
    if (
      attachments().some(
        (attached) => attached.attachmentId === newAttachment.attachmentId
      )
    )
      return;
    setAttachments((p) => [...p, newAttachment]);
  };

  const removeAttachment = (id: string) => {
    const attached = attachments();
    const newAttachments = attached.filter((a) => a.attachmentId !== id);
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
  const history = useHistory();

  return createMemo(() => {
    return history().filter((item) => {
      const blockName = getItemBlockName(item, true);
      return SUPPORTED_CHAT_ATTACHMENT_BLOCKS.includes(blockName);
    });
  });
};

export const useGetChatAttachmentInfo = () => {
  const history = useChatAttachableHistory();
  const { channels } = useChannelsContext();
  const emails = useEmails();

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
      id: `${item.id}-document-attachment`,
      attachmentId: item.id,
      attachmentType: 'document',
      metadata: {
        type: 'document',
        document_type: fileType,
        document_name: item.name,
      },
    };
  };

  const getChannelAttachment = ({
    itemId: id,
  }: ItemMention): Attachment | undefined => {
    if (!ENABLE_CHAT_CHANNEL_ATTACHMENT) return;

    const item = channels().find((item) => item.id === id);
    if (!item) return;

    return {
      id: `${item.id}-channel-attachment`,
      attachmentId: item.id,
      attachmentType: 'channel',
      metadata: {
        type: 'channel',
        channel_type: item.channel_type,
        channel_name: item.name ?? 'Channel',
      },
    };
  };

  const getEmailAttachment = (mention: ItemMention): Attachment | undefined => {
    return {
      id: `${mention.itemId}-email-attachment`,
      attachmentId: mention.itemId,
      attachmentType: 'email',
      metadata: {
        type: 'email',
        email_subject: mention.documentName ?? 'No Subject',
      },
    };
  };

  const mentionToAttachment = (
    mention: ItemMention
  ): Attachment | undefined => {
    if (mention.itemType === 'document') {
      return getDocumentAttachment(mention.itemId);
    } else if (mention.itemType === 'channel') {
      return getChannelAttachment(mention);
    } else if (mention.itemType === 'email') {
      return getEmailAttachment(mention);
    }
  };

  return {
    getDocumentAttachment,
    getChannelAttachment,
    getAttachmentFromMention: mentionToAttachment,
  };
};
