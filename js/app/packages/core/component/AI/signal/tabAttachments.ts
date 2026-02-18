import { SUPPORTED_CHAT_ATTACHMENT_BLOCKS } from '@core/component/AI/constant/fileType';
import type { Attachment } from '@core/component/AI/types';
import { useChannelsContext } from '@core/context/channels';
import type { ChannelWithParticipants } from '@core/user';
import { isOk } from '@core/util/maybeResult';
import type { EmailEntity } from '@entity';
import type { HistoryItem } from '@queries/history/history';
import { useHistoryQuery } from '@queries/history/history';
import type {
  AttachmentType,
  ChannelType,
  ChatAttachmentWithName,
  FileType,
} from '@service-cognition/generated/schemas';
import { emailClient } from '@service-email/client';
import { useQuery } from '@tanstack/solid-query';
import type { SplitContent } from 'app/component/split-layout/layoutManager';
import {
  globalPreviewEntities,
  globalSplitManager,
} from 'app/signal/splitLayout';
import type { Accessor } from 'solid-js';
import { createMemo } from 'solid-js';

type Item = HistoryItem | null;

function convertSplitToAttachment(
  split: SplitContent,
  item: Item,
  channel: ChannelWithParticipants | null = null,
  email: EmailEntity | null = null
): Attachment | null {
  let metadata: Attachment['metadata'];
  let attachmentType: AttachmentType;

  switch (split.type) {
    case 'image': {
      if (!item || item.type !== 'document') return null;
      const imageName = item.name || 'Image';
      const imageExtension = (item.fileType || 'png') as FileType;
      // this is correct
      metadata = {
        type: 'document',
        document_name: imageName,
        document_type: imageExtension,
      };
      attachmentType = 'document';
      break;
    }
    case 'channel': {
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
    }
    case 'email': {
      if (!email) return null;
      const emailSubject = email.name || 'No Subject';
      metadata = {
        type: 'email',
        email_subject: emailSubject,
      };
      attachmentType = 'email';
      break;
    }
    case 'project':
      if (!item || item.type !== 'project') return null;
      metadata = {
        type: 'project',
        project_name: item.name,
      };
      attachmentType = 'project';
      break;
    default: {
      if (!item || item.type !== 'document') return null;
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
  }

  return {
    id: `split-${split.id}-${Date.now()}`,
    attachmentId: split.id,
    attachmentType,
    metadata,
  };
}

export function useTabAttachments(): Accessor<ChatAttachmentWithName[]> {
  const historyQuery = useHistoryQuery();
  const channelsContext = useChannelsContext();
  const channels = channelsContext.channels;
  // TODO: hook into email query because useEmails was deprecated
  const emails: Accessor<EmailEntity[]> = () => [];

  // Get valid active tabs using createMemo
  const tabs = createMemo(() => {
    const splitManager = globalSplitManager();
    const splits = splitManager?.splits() ?? [];
    const historyItems = historyQuery.data ?? [];
    const channelList = channels();
    const emailList = emails();

    // Deduplicate by type:id key and resolve names from history/channels/emails
    const uniqueSplits = new Map<
      string,
      {
        split: SplitContent;
        item: Item;
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

      const channelItem =
        split.content.type === 'channel'
          ? channelList.find((channel) => channel.id === split.content.id) ||
            null
          : null;
      if (split.content.type === 'channel') {
        uniqueSplits.set(key, {
          split: split.content,
          item: null,
          channel: channelItem,
          email: null,
        });
        continue;
      }

      const historyItem =
        historyItems.find((item) => item.id === split.content.id) || null;
      if (historyItem) {
        uniqueSplits.set(key, {
          split: split.content,
          item: historyItem,
          channel: channelItem,
          email: null,
        });
      }
    }

    // Include entities from preview panels
    for (const [, previewContent] of globalPreviewEntities()) {
      if (
        previewContent.type === 'component' ||
        !SUPPORTED_CHAT_ATTACHMENT_BLOCKS.includes(previewContent.type)
      ) {
        continue;
      }

      const key = `${previewContent.type}:${previewContent.id}`;
      if (uniqueSplits.has(key)) continue;

      if (previewContent.type === 'email') {
        const emailItem = emailList.find(
          (email) => email.id === previewContent.id
        );
        if (emailItem) {
          uniqueSplits.set(key, {
            split: previewContent,
            item: null,
            channel: null,
            email: emailItem,
          });
        }
        continue;
      }

      if (previewContent.type === 'channel') {
        const channelItem =
          channelList.find((channel) => channel.id === previewContent.id) ||
          null;
        uniqueSplits.set(key, {
          split: previewContent,
          item: null,
          channel: channelItem,
          email: null,
        });
        continue;
      }

      const historyItem =
        historyItems.find((item) => item.id === previewContent.id) || null;
      if (historyItem) {
        uniqueSplits.set(key, {
          split: previewContent,
          item: historyItem,
          channel: null,
          email: null,
        });
      }
    }

    return Array.from(uniqueSplits.values());
  });

  const emailTabs = createMemo(() => {
    const result: { content: SplitContent }[] = [];
    const splitManager = globalSplitManager();
    if (splitManager) {
      result.push(
        ...splitManager
          .splits()
          .filter((split) => split.content.type === 'email')
      );
    }
    // Include previewed emails
    for (const [, previewContent] of globalPreviewEntities()) {
      if (previewContent.type === 'email') {
        result.push({ content: previewContent });
      }
    }
    return result;
  });

  const emailQuery = useQuery(() => ({
    queryKey: [
      'tab-attachments',
      'emails',
      emailTabs().map((t) => t.content.id),
    ],
    queryFn: async () => {
      const eTabs = emailTabs();
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

      const attachments: ChatAttachmentWithName[] = threads.flatMap(
        (thread) => {
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
        }
      );
      return attachments;
    },
    enabled: emailTabs().length > 0,
  }));

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
    const queriedEmails = emailQuery.isSuccess ? (emailQuery.data ?? []) : [];
    const newEmails = queriedEmails.filter(
      (e) => !existingAttachments.has(e.attachmentId)
    );
    return [...newEmails, ...tabs];
  });

  return combinedAttachments;
}
