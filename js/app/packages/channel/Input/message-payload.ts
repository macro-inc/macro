import { STATIC_IMAGE, STATIC_VIDEO } from '@core/store/cacheChannelInput';
import type { ItemMention } from '@core/component/LexicalMarkdown/plugins';
import type { PostMessageRequest } from '@service-comms/generated/models';
import type { SimpleMention } from '@service-comms/generated/models/simpleMention';
import type { InputAttachmentData, InputSnapshot } from './types';
import { match } from 'ts-pattern';

function attachmentEntityType(
  attachment: Pick<InputAttachmentData, 'kind'>
): string {
  switch (attachment.kind) {
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
function expandMentions(
  mentions: ItemMention[],
  participantIds: string[]
): SimpleMention[] {
  const result: SimpleMention[] = [];
  const seenUserIds = new Set<string>();

  for (const mention of mentions) {
    if (mention.itemType === 'group') {
      result.push(...expandGroupMention(mention, participantIds, seenUserIds));
    } else {
      if (mention.itemType === 'user') {
        if (seenUserIds.has(mention.itemId)) continue;
        seenUserIds.add(mention.itemId);
      }
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

export function buildPostMessageRequest(
  options: BuildPostMessageRequestOptions
): PostMessageRequest {
  const { snapshot, threadId, participantIds } = options;

  return {
    content: snapshot.value,
    thread_id: threadId,
    mentions: expandMentions(snapshot.mentions, participantIds ?? []),
    attachments: snapshot.attachments.map((attachment) => ({
      entity_id: attachment.id,
      entity_type: attachmentEntityType(attachment),
      width: attachment.width ?? null,
      height: attachment.height ?? null,
    })),
  };
}
