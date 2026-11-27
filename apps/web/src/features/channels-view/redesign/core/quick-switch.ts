import type { SidebarChannel, SidebarSection } from './sidebar-model';
import { stripSupportDisplayName } from './support-triage';

/**
 * Instant keyboard-first quick-switcher ranking over the full local channel
 * directory and sections.
 *
 * Fixes the inverted legacy search order (`orderSectionSearchResults`), which
 * placed unjoined channels above the viewer's own active conversations:
 * 1. Unread / mentioned joined conversations
 * 2. Joined channels & DMs (exact -> prefix -> word-start -> substring -> fuzzy, then frecency/recency)
 * 3. Sections & views
 * 4. Unjoined discoverable team channels (always cleanly after joined hits)
 */

export type QuickSwitchItem =
  | {
      kind: 'channel';
      group: 'unread' | 'joined' | 'discover';
      channel: SidebarChannel;
      displayName: string;
      sectionName?: string;
      unread: boolean;
      mentions: number;
      score: number;
    }
  | {
      kind: 'section';
      group: 'sections';
      section: SidebarSection;
      score: number;
    };

/** Score how cleanly `query` matches `target` (0 = no match, higher = better). */
export function fuzzyMatchScore(target: string, rawQuery: string): number {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return 1;

  const text = target.toLowerCase();
  if (text === query) return 1000;
  if (text.startsWith(query))
    return 800 - Math.min(200, text.length - query.length);

  const wordBoundaryIndex = text.search(
    new RegExp(`(?:^|[\\s\\-_x×:|/])${escapeRegExp(query)}`)
  );
  if (wordBoundaryIndex >= 0) {
    return 650 - Math.min(150, wordBoundaryIndex);
  }

  const substringIndex = text.indexOf(query);
  if (substringIndex >= 0) {
    return 500 - Math.min(150, substringIndex);
  }

  // Ordered character subsequence match (e.g., "msac" -> "Macro Support x Acme").
  let qi = 0;
  let consecutive = 0;
  let maxConsecutive = 0;
  let firstMatch = -1;
  for (let ti = 0; ti < text.length && qi < query.length; ti++) {
    if (text[ti] === query[qi]) {
      if (firstMatch < 0) firstMatch = ti;
      qi += 1;
      consecutive += 1;
      if (consecutive > maxConsecutive) maxConsecutive = consecutive;
    } else {
      consecutive = 0;
    }
  }
  if (qi < query.length) return 0;

  return 200 + maxConsecutive * 25 - Math.min(100, firstMatch * 2);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildQuickSwitchResults(options: {
  query: string;
  channels: readonly SidebarChannel[];
  sections: readonly SidebarSection[];
  unreadIds: ReadonlySet<string>;
  unreadOrMentionedIds: ReadonlySet<string>;
  mentionCounts: ReadonlyMap<string, number>;
  limit?: number;
}): QuickSwitchItem[] {
  const limit = options.limit ?? 60;
  const query = options.query.trim();

  const sectionNameByChannelId = new Map<string, string>();
  for (const section of options.sections) {
    for (const id of section.channelIds) {
      if (!sectionNameByChannelId.has(id)) {
        sectionNameByChannelId.set(id, section.name);
      }
    }
  }

  const unreadHits: Extract<QuickSwitchItem, { kind: 'channel' }>[] = [];
  const joinedHits: Extract<QuickSwitchItem, { kind: 'channel' }>[] = [];
  const discoverHits: Extract<QuickSwitchItem, { kind: 'channel' }>[] = [];

  for (const channel of options.channels) {
    const stripped = stripSupportDisplayName(channel.name);
    const fullScore = fuzzyMatchScore(channel.name, query);
    const strippedScore =
      stripped !== channel.name ? fuzzyMatchScore(stripped, query) : 0;
    const matchScore = Math.max(fullScore, strippedScore);
    if (matchScore === 0) continue;

    const unread = options.unreadIds.has(channel.id);
    const mentions = options.mentionCounts.get(channel.id) ?? 0;
    const isUnreadOrMentioned = options.unreadOrMentionedIds.has(channel.id);

    const recencyBonus =
      channel.frecencyScore > 0 ? Math.min(80, channel.frecencyScore * 10) : 0;
    const score = matchScore + recencyBonus + mentions * 40 + (unread ? 25 : 0);

    if (!channel.isParticipant) {
      discoverHits.push({
        kind: 'channel',
        group: 'discover',
        channel,
        displayName: channel.name,
        sectionName: sectionNameByChannelId.get(channel.id),
        unread: false,
        mentions: 0,
        score,
      });
    } else if (isUnreadOrMentioned) {
      unreadHits.push({
        kind: 'channel',
        group: 'unread',
        channel,
        displayName: channel.name,
        sectionName: sectionNameByChannelId.get(channel.id),
        unread,
        mentions,
        score,
      });
    } else {
      joinedHits.push({
        kind: 'channel',
        group: 'joined',
        channel,
        displayName: channel.name,
        sectionName: sectionNameByChannelId.get(channel.id),
        unread: false,
        mentions: 0,
        score,
      });
    }
  }

  const sectionHits: Extract<QuickSwitchItem, { kind: 'section' }>[] = [];
  if (query.length > 0) {
    for (const section of options.sections) {
      const score = fuzzyMatchScore(section.name, query);
      if (score > 0) {
        sectionHits.push({
          kind: 'section',
          group: 'sections',
          section,
          score,
        });
      }
    }
  }

  const sortChannelHits = (
    a: Extract<QuickSwitchItem, { kind: 'channel' }>,
    b: Extract<QuickSwitchItem, { kind: 'channel' }>
  ) =>
    b.score - a.score ||
    b.channel.updatedAtMs - a.channel.updatedAtMs ||
    a.displayName.localeCompare(b.displayName);

  unreadHits.sort(sortChannelHits);
  joinedHits.sort(sortChannelHits);
  sectionHits.sort(
    (a, b) => b.score - a.score || a.section.name.localeCompare(b.section.name)
  );
  discoverHits.sort(sortChannelHits);

  // When query is empty, show unread/mentions first, then recent joined, then
  // up to 8 discoverable channels so the switcher feels instant and useful.
  const combined: QuickSwitchItem[] = [
    ...unreadHits,
    ...joinedHits,
    ...sectionHits.slice(0, 6),
    ...discoverHits.slice(0, query.length > 0 ? 15 : 8),
  ];

  return combined.slice(0, limit);
}
