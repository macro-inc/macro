import type { DmFilter, DmWindowLimit, SidebarChannel } from './sidebar-model';

/**
 * Smart DM windowing & People / Agents separation.
 *
 * Prevents expanding Direct Messages from flooding the sidebar with 50-100+
 * stale conversations: always keeps unread, mentioned, live-call, and
 * currently selected DMs visible, fills remaining slots up to `limit` with
 * the most recent/frequent conversations, and exposes `overflowCount` for
 * progressive "Show N more" disclosure.
 */

export type DmWindowResult = {
  visible: SidebarChannel[];
  overflowCount: number;
  totalFilteredCount: number;
  peopleCount: number;
  agentCount: number;
  unreadPeopleCount: number;
  unreadAgentCount: number;
};

export function isAgentDirectMessage(channel: SidebarChannel): boolean {
  if (channel.isAgentDm) return true;
  return (
    channel.channelType === 'direct_message' &&
    channel.botParticipantIds.length > 0 &&
    channel.participantIds.length <= 1
  );
}

export function buildDmWindow(options: {
  directMessages: readonly SidebarChannel[];
  filter: DmFilter;
  limit: DmWindowLimit;
  expandedAll: boolean;
  unreadOrMentionedIds: ReadonlySet<string>;
  activeCallChannelIds: ReadonlySet<string>;
  mutedIds: ReadonlySet<string>;
  selectedChannelId?: string;
  unreadOnly: boolean;
  hideMuted: boolean;
  query?: string;
}): DmWindowResult {
  let peopleCount = 0;
  let agentCount = 0;
  let unreadPeopleCount = 0;
  let unreadAgentCount = 0;

  const eligible: SidebarChannel[] = [];
  const normalizedQuery = options.query?.trim().toLowerCase() ?? '';

  for (const dm of options.directMessages) {
    if (!dm.isParticipant) continue;

    const isAgent = isAgentDirectMessage(dm);
    const isUnread = options.unreadOrMentionedIds.has(dm.id);
    const isMuted = options.mutedIds.has(dm.id);

    if (isAgent) {
      agentCount += 1;
      if (isUnread) unreadAgentCount += 1;
    } else {
      peopleCount += 1;
      if (isUnread) unreadPeopleCount += 1;
    }

    if (options.filter === 'people' && isAgent) continue;
    if (options.filter === 'agents' && !isAgent) continue;
    if (
      options.unreadOnly &&
      !isUnread &&
      !options.activeCallChannelIds.has(dm.id)
    ) {
      continue;
    }
    if (
      options.hideMuted &&
      isMuted &&
      !isUnread &&
      dm.id !== options.selectedChannelId
    ) {
      continue;
    }
    if (normalizedQuery && !dm.name.toLowerCase().includes(normalizedQuery)) {
      continue;
    }

    eligible.push(dm);
  }

  const mustKeep = (dm: SidebarChannel) =>
    options.activeCallChannelIds.has(dm.id) ||
    options.unreadOrMentionedIds.has(dm.id) ||
    dm.id === options.selectedChannelId;

  const priorityRank = (dm: SidebarChannel) => {
    if (options.activeCallChannelIds.has(dm.id)) return 0;
    if (options.unreadOrMentionedIds.has(dm.id)) return 1;
    return 2;
  };

  // Sort active/unread first, then most recently active, with frecency tiebreak.
  const sorted = eligible.slice().sort((left, right) => {
    const rankDiff = priorityRank(left) - priorityRank(right);
    if (rankDiff !== 0) return rankDiff;
    const timeDiff = right.updatedAtMs - left.updatedAtMs;
    if (timeDiff !== 0) return timeDiff;
    const frecencyDiff = right.frecencyScore - left.frecencyScore;
    if (frecencyDiff !== 0) return frecencyDiff;
    return left.name.localeCompare(right.name);
  });

  // Inline search or explicit "Show all" bypasses the window cap.
  if (
    options.expandedAll ||
    options.limit === 'all' ||
    normalizedQuery.length > 0 ||
    options.unreadOnly
  ) {
    return {
      visible: sorted,
      overflowCount: 0,
      totalFilteredCount: sorted.length,
      peopleCount,
      agentCount,
      unreadPeopleCount,
      unreadAgentCount,
    };
  }

  const visible: SidebarChannel[] = [];
  const seen = new Set<string>();

  for (const dm of sorted) {
    if (mustKeep(dm)) {
      visible.push(dm);
      seen.add(dm.id);
    }
  }

  for (const dm of sorted) {
    if (visible.length >= options.limit) break;
    if (seen.has(dm.id)) continue;
    visible.push(dm);
    seen.add(dm.id);
  }

  return {
    visible,
    overflowCount: Math.max(0, sorted.length - visible.length),
    totalFilteredCount: sorted.length,
    peopleCount,
    agentCount,
    unreadPeopleCount,
    unreadAgentCount,
  };
}
