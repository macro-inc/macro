import { getChatAttachmentInfo } from '@core/component/AI/signal/attachment';
import type { Attachments } from '@core/component/AI/types';
import { createMentionAttachmentLifecycle } from '@core/component/AI/util/mentionAttachmentLifecycle';
import { buildChatEditor } from './buildChatEditor';

export function buildChatEditorWithAttachments(attachments: Attachments) {
  const { getAttachmentFromMention } = getChatAttachmentInfo();
  const mentionAttachments = createMentionAttachmentLifecycle({
    attachments,
    getAttachment: getAttachmentFromMention,
  });

  return buildChatEditor().withMentions({
    onCreate: mentionAttachments.onCreate,
    onRemove: mentionAttachments.onRemove,
    block: 'chat',
    showOpenTabs: true,
  });
}
