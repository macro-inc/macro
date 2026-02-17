import type { EntityItem, UserItem } from '@core/context/quickAccess';
import type {
  MentionItem,
  GroupMentionItem,
} from '../../../../utils/mentionsUtils';

/**
 * Helper function to get search text from EntityItem.
 */
export function getEntitySearchText(item: EntityItem): string {
  return item.searchText;
}

/**
 * Helper function to get timestamps from EntityItem.
 */
export function getEntityTimestamps(item: EntityItem) {
  return {
    updatedAt: item.timestamps.updatedAt,
    viewedAt: item.timestamps.viewedAt,
  };
}

/**
 * Helper function to get search text from UserItem.
 */
export function getUserSearchText(item: UserItem): string {
  return item.searchText;
}

/**
 * Helper function to get timestamps from UserItem.
 */
export function getUserTimestamps(item: UserItem) {
  return {
    lastInteraction: item.timestamps.lastInteraction,
  };
}

/**
 * Helper function to get search text from email EntityItem.
 */
export function getEmailSearchText(item: EntityItem): string {
  return item.searchText;
}

/**
 * Helper function to get timestamps from email EntityItem.
 */
export function getEmailTimestamps(item: EntityItem) {
  return {
    updatedAt: item.timestamps.updatedAt,
    viewedAt: item.timestamps.viewedAt,
  };
}

/**
 * Extract the domain from an email address.
 */
export function getDomainFromEmail(email: string): string | undefined {
  return email ? email.split('@')[1] : undefined;
}

/**
 * Separate items into open tabs and other items.
 * Open tabs appear first in the results.
 */
export function separateTabResults<T extends { id: string }>(
  allResults: T[],
  openTabIds: Set<string>
): { tabResults: T[]; otherResults: T[] } {
  const tabResults: T[] = [];
  const otherResults: T[] = [];

  for (const item of allResults) {
    if (openTabIds.has(item.id)) {
      tabResults.push(item);
    } else {
      otherResults.push(item);
    }
  }

  return { tabResults, otherResults };
}

/**
 * Combine filtered users with special groups.
 */
export function combineUsersAndGroups(
  users: MentionItem[],
  groups: GroupMentionItem[]
): MentionItem[] {
  return [...groups, ...users];
}

/**
 * Deduplicate items by ID, keeping the first occurrence.
 */
export function deduplicateById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
}

/**
 * Merge local and remote results, deduplicating by ID.
 * Local results take precedence (appear first).
 */
export function mergeAndDeduplicateResults<T extends { id: string }>(
  localResults: T[],
  remoteResults: T[]
): T[] {
  const localIds = new Set(localResults.map((item) => item.id));
  const uniqueRemote = remoteResults.filter((item) => !localIds.has(item.id));
  return [...localResults, ...uniqueRemote];
}

/**
 * Filter items to exclude the current block.
 */
export function excludeCurrentBlock<T extends { id: string }>(
  items: T[],
  currentBlockId: string | undefined
): T[] {
  if (!currentBlockId) return items;
  return items.filter((item) => item.id !== currentBlockId);
}

/**
 * Check if a string matches a prefix (case-insensitive).
 */
export function matchesPrefix(value: string, prefix: string): boolean {
  return value.toLowerCase().startsWith(prefix.toLowerCase());
}

/**
 * Filter available groups based on search term.
 */
export function filterGroups(
  availableGroups: Array<{
    alias: string;
    match: (term: string) => boolean;
  }>,
  searchTerm: string
): GroupMentionItem[] {
  const term = searchTerm.toLowerCase();
  return availableGroups
    .filter((g) => g.match(term))
    .map(
      (g): GroupMentionItem => ({
        kind: 'group',
        id: g.alias,
        data: { id: g.alias, groupAlias: g.alias },
      })
    );
}
