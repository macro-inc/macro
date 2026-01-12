import type { SimpleMention } from '@service-comms/generated/models/simpleMention';

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
