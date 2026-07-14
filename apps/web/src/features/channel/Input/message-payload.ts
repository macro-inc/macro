import type { ItemMention } from '@core/component/LexicalMarkdown/plugins';
import { STATIC_IMAGE, STATIC_VIDEO } from '@core/store/cacheChannelInput';
import type { NewChannelAttachment as NewAttachment } from '@service-storage/generated/schemas/newChannelAttachment';
import type { PostMessageRequest } from '@service-storage/generated/schemas/postMessageRequest';
import type { SimpleMention } from '@service-storage/generated/schemas/simpleMention';
import { match } from 'ts-pattern';
import { isMacroAiId } from '../macroAi';
import type { InputAttachmentData, InputSnapshot } from './types';

export function attachmentEntityType(
  kind: InputAttachmentData['kind']
): string {
  switch (kind) {
    case 'image':
      return STATIC_IMAGE;
    case 'video':
      return STATIC_VIDEO;
    case 'document':
      return 'document';
  }
}

function expandGroupMention(
  mention: ItemMention,
  participantIds: string[],
  seenUserIds: Set<string>
): SimpleMention[] {
  return match(mention.groupAlias)
    .with('here', () => {
      const result: SimpleMention[] = [];
      for (const userId of participantIds) {
        if (!seenUserIds.has(userId)) {
          seenUserIds.add(userId);
          result.push({ entity_type: 'user', entity_id: userId });
        }
      }
      return result;
    })
    .otherwise(() => []);
}

/**
 * Expands raw editor mentions into the flat list the API expects.
 *
 * - `group` mentions (e.g. @here) are fanned out to one user mention per
 *   participant, de-duplicated against explicitly mentioned users.
 * - Regular user mentions are de-duplicated so the same user isn't sent twice.
 */
export function expandMentions(
  mentions: ItemMention[],
  participantIds: string[]
): SimpleMention[] {
  const result: SimpleMention[] = [];
  const seenUserIds = new Set<string>();

  for (const mention of mentions) {
    if (mention.itemType === 'group') {
      result.push(...expandGroupMention(mention, participantIds, seenUserIds));
    } else if (mention.itemType === 'user') {
      if (seenUserIds.has(mention.itemId)) continue;
      seenUserIds.add(mention.itemId);
      // Macro AI rides the user-mention machinery in the editor but is a bot;
      // re-tag it so the backend dispatches a bot trigger.
      result.push({
        entity_type: isMacroAiId(mention.itemId) ? 'bot' : 'user',
        entity_id: mention.itemId,
      });
    } else {
      result.push({
        entity_type: mention.itemType,
        entity_id: mention.itemId,
      });
    }
  }

  return result;
}

type BuildPostMessageRequestOptions = {
  snapshot: InputSnapshot;
  threadId?: string;
  participantIds?: string[];
};

export type OptimisticPostMessageAttachment = {
  attachment: NewAttachment;
  previewSrc?: string;
};

export type PostMessageSendPayload = {
  message: PostMessageRequest;
  optimisticAttachments: OptimisticPostMessageAttachment[];
};

export function buildPostMessageSendPayload(
  options: BuildPostMessageRequestOptions
): PostMessageSendPayload {
  const { snapshot, threadId, participantIds } = options;
  const optimisticAttachments = snapshot.attachments.map((attachment) => {
    const postAttachment = {
      entity_id: attachment.id,
      entity_type: attachmentEntityType(attachment.kind),
      width: attachment.width ?? null,
      height: attachment.height ?? null,
    };

    return {
      attachment: postAttachment,
      previewSrc: attachment.previewSrc,
    };
  });

  return {
    message: {
      content: snapshot.value,
      thread_id: threadId,
      mentions: expandMentions(snapshot.mentions, participantIds ?? []),
      attachments: optimisticAttachments.map((item) => item.attachment),
    },
    optimisticAttachments,
  };
}

export function buildPostMessageRequest(
  options: BuildPostMessageRequestOptions
): PostMessageRequest {
  return buildPostMessageSendPayload(options).message;
}
