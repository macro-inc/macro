import { SUPPORTED_CHAT_ATTACHMENT_BLOCKS } from '@core/component/AI/constant/fileType';
import type { Attachment } from '@core/component/AI/types';
import { useChannelsContext } from '@core/component/ChannelsProvider';
import type { ChannelWithParticipants } from '@core/user';
import { isOk } from '@core/util/maybeResult';
import { type EmailEntity, useEmails } from '@macro-entity';
import type {
  AttachmentType,
  ChannelType,
  ChatAttachmentWithName,
  FileType,
} from '@service-cognition/generated/schemas';
import { emailClient } from '@service-email/client';
import type { BasicDocument } from '@service-storage/generated/schemas/basicDocument';
import { useHistory } from '@service-storage/history';
import type { SplitContent } from 'app/component/split-layout/layoutManager';
import { globalSplitManager } from 'app/signal/splitLayout';
import type { Accessor } from 'solid-js';
import { createMemo, createResource } from 'solid-js';

function convertSplitToAttachment(
  split: SplitContent,
  item: BasicDocument | null,
  channel: ChannelWithParticipants | null = null,
  email: EmailEntity | null = null
): Attachment | null {
  let metadata: Attachment['metadata'];
  let attachmentType: AttachmentType;

  switch (split.type) {
    case 'image':
      if (!item) return null;
      const imageName = item.name || 'Image';
      const imageExtension = (item.fileType || 'png') as FileType;
      metadata = {
        type: 'image',
        image_name: imageName,
        image_extension: imageExtension,
      };
      attachmentType = 'image';
      break;
    case 'channel':
      if (!channel) return null;
      const channelName = channel.name || 'Channel';
      const channelType: ChannelType = channel.channel_type || 'public';
      metadata = {
        type: 'channel',
        channel_name: channelName,
        channel_type: channelType,
      };
      attachmentType = 'channel';
      break;
    case 'email':
      if (!email) return null;
      const emailSubject = email.name || 'No Subject';
      metadata = {
        type: 'email',
        email_subject: emailSubject,
      };
      attachmentType = 'email';
      break;
    default:
      if (!item) return null;
      const documentName = item.name || 'Document';
      const documentType = (item.fileType || 'txt') as FileType;
      metadata = {
        type: 'document',
        document_name: documentName,
        document_type: documentType,
      };
      attachmentType = 'document';
      break;
  }

  return {
    id: `split-${split.id}-${Date.now()}`,
    attachmentId: split.id,
    attachmentType,
    metadata,
  };
}

export function useTabAttachments(): Accessor<ChatAttachmentWithName[]> {
  const history = useHistory();
  const channelsContext = useChannelsContext();
  const channels = () => channelsContext.channels();
  const emails = useEmails();

  // Get valid active tabs using createMemo
  const tabs = createMemo(() => {
    const splitManager = globalSplitManager();
    if (!splitManager) return [];

    const splits = splitManager.splits();
    const historyItems = history();
    const channelList = channels();
    const emailList = emails();

    // Deduplicate by type:id key and resolve names from history/channels/emails
    const uniqueSplits = new Map<
      string,
      {
        split: SplitContent;
        item: BasicDocument | null;
        channel: ChannelWithParticipants | null;
        email: EmailEntity | null;
      }
    >();

    for (const split of splits) {
      // TODO: need smarter type checking/inference
      if (
        split.content.type === 'component' ||
        !SUPPORTED_CHAT_ATTACHMENT_BLOCKS.includes(split.content.type)
      ) {
        continue;
      }

      const key = `${split.content.type}:${split.content.id}`;
      if (!uniqueSplits.has(key)) {
        // For email splits, find in email list
        if (split.content.type === 'email') {
          const emailItem = emailList.find(
            (email) => email.id === split.content.id
          );
          if (!emailItem) {
            continue;
          }

          uniqueSplits.set(key, {
            split: split.content,
            item: null,
            channel: null,
            email: emailItem,
          });
          continue;
        }

        // Find matching item in history
        const historyItem =
          historyItems.find((item) => item.id === split.content.id) || null;
        if (!historyItem || historyItem.type !== 'document') {
          continue;
        }

        // Find matching channel if this is a channel split
        const channelItem =
          split.content.type === 'channel'
            ? channelList.find((channel) => channel.id === split.content.id) ||
              null
            : null;

        uniqueSplits.set(key, {
          split: split.content,
          item: historyItem,
          channel: channelItem,
          email: null,
        });
      }
    }

    return Array.from(uniqueSplits.values());
  });

  const emailTabs = createMemo(() => {
    const splitManager = globalSplitManager();
    if (!splitManager) return [];
    return splitManager
      .splits()
      .filter((split) => split.content.type === 'email');
  });

  const [emailAttachments] = createResource(emailTabs, async (eTabs) => {
    const threads = await Promise.allSettled(
      eTabs.map((email) =>
        emailClient
          .getThread({
            thread_id: email.content.id,
            limit: 1,
          })
          .then((r) => ({ id: email.content.id, result: r }))
      )
    ).then((threads) =>
      threads.flatMap((r) => {
        if (r.status === 'rejected') return [];
        return isOk(r.value.result)
          ? [
              {
                id: r.value.id,
                thread: r.value.result[1],
              },
            ]
          : [];
      })
    );

    const attachments: ChatAttachmentWithName[] = threads.flatMap((thread) => {
      // :(
      const subject = thread.thread.thread.messages[0]?.subject;
      if (!subject) return [];
      return [
        {
          attachmentType: 'email',
          attachmentId: thread.id,
          id: thread.id,
          metadata: {
            email_subject: subject,
            type: 'email',
          },
        },
      ];
    });
    return attachments;
  });

  const tabAttachments = createMemo(() => {
    const openTabs = tabs();
    const attachments: Attachment[] = [];
    for (const tabData of openTabs) {
      const { split, item, channel, email } = tabData;
      const attachment = convertSplitToAttachment(split, item, channel, email);
      if (attachment) {
        attachments.push(attachment);
      }
    }
    return attachments;
  });

  const combinedAttachments = createMemo(() => {
    const tabs = tabAttachments();
    const existingAttachments = new Set(tabs.map((a) => a.attachmentId));
    const queriedEmails = emailAttachments() ?? [];
    const newEmails = queriedEmails.filter(
      (e) => !existingAttachments.has(e.attachmentId)
    );
    return [...newEmails, ...tabs];
  });

  return combinedAttachments;
}
