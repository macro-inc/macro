import type { Attachment } from '@core/component/AI/types';
import type { ItemMention } from '@core/component/LexicalMarkdown/plugins/mentions';
import { ENABLE_CHAT_CHANNEL_ATTACHMENT } from '@core/constant/featureFlags';

export function getDirectMentionAttachment(
  mention: ItemMention
): Attachment | undefined {
  if (mention.itemType === 'call') {
    return {
      entity_id: mention.itemId,
      entity_type: 'document',
    };
  }
  if (mention.itemType === 'thread') {
    return {
      entity_id: mention.itemId,
      entity_type: 'email_thread',
    };
  }
  if (mention.itemType === 'project') {
    return {
      entity_id: mention.itemId,
      entity_type: 'project',
    };
  }
  if (mention.itemType === 'channel' && ENABLE_CHAT_CHANNEL_ATTACHMENT) {
    return {
      entity_id: mention.itemId,
      entity_type: 'channel',
    };
  }
}
