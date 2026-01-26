import { $isSingleDocumentMention } from '@core/component/LexicalMarkdown/utils';
import { $convertMentionToCard, $isDocumentMentionNode } from '@lexical-core';
import type { SimpleMention } from '@service-comms/generated/models/simpleMention';
import { $getRoot, $isParagraphNode } from 'lexical';

export type MentionItem = {
  itemType: string;
  itemId: string;
};

/**
 * Expands group participants to individual user mentions, deduplicating against seen users.
 */
export function expandGroupParticipants(
  participants: string[],
  seenUserIds: Set<string>
): SimpleMention[] {
  const result: SimpleMention[] = [];
  for (const userId of participants) {
    if (!seenUserIds.has(userId)) {
      seenUserIds.add(userId);
      result.push({ entity_type: 'user', entity_id: userId });
    }
  }
  return result;
}

/**
 * Converts a mention to SimpleMention format, deduplicating user mentions against seen users.
 * Returns null if the mention is a duplicate user.
 */
export function toSimpleMention(
  mention: MentionItem,
  seenUserIds: Set<string>
): SimpleMention | null {
  if (mention.itemType === 'user') {
    if (seenUserIds.has(mention.itemId)) return null;
    seenUserIds.add(mention.itemId);
  }
  return { entity_type: mention.itemType, entity_id: mention.itemId };
}

export function $convertSingleMentionToCard() {
  if ($isSingleDocumentMention()) {
    const root = $getRoot();
    const rootChildren = root.getChildren();
    if (rootChildren.length > 0) {
      const firstChild = rootChildren[0];
      if ($isParagraphNode(firstChild)) {
        const paragraphChildren = firstChild.getChildren();
        if (paragraphChildren.length > 0) {
          const mention = paragraphChildren[0];
          console.log({ mention });
          if ($isDocumentMentionNode(mention)) {
            $convertMentionToCard(mention);
          }
        }
      }
    }
  }
}
