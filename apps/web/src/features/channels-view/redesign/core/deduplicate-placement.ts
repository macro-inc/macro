import {
  LARGE_SECTION_SMART_LIMIT,
  type SidebarChannel,
  type SidebarSection,
} from './sidebar-model';
import {
  detectCommonSectionPrefix,
  isSupportSection,
  stripCommonPrefix,
} from './support-triage';

/**
 * One-Home-Per-Channel spatial placement algorithm for the Browse sidebar.
 *
 * Eliminates the noisy duplication in the legacy sectioned sidebar where
 * filing channels into sections still left every channel duplicated inside
 * `[Team] channels` and `All channels`.
 *
 * Placement precedence:
 * 1. Personal sections claim their matching/assigned joined channels first
 *    (letting individuals override team taxonomy locally without mutating it).
 * 2. Team sections claim remaining matching/assigned channels (including hidden
 *    team sections so hiding a noisy team section actually cleans the rail).
 * 3. Remaining joined non-DM channels live in `ungroupedChannels`.
 */

export type PlacedSectionChannel = {
  channel: SidebarChannel;
  displayName: string;
};

export type PlacedSection = {
  section: SidebarSection;
  isSupport: boolean;
  commonPrefix?: string;
  allChannels: PlacedSectionChannel[];
  visibleChannels: PlacedSectionChannel[];
  /** Total claimed member IDs in this section (including not-yet-windowed IDs). */
  totalMemberCount: number;
  /** Number of claimed member IDs not yet fetched into the current window. */
  unresolvedCount: number;
  overflowCount: number;
  unreadCount: number;
  mentionCount: number;
};

export type BrowsePlacement = {
  personalSections: PlacedSection[];
  teamSections: PlacedSection[];
  hiddenTeamSections: SidebarSection[];
  ungroupedChannels: SidebarChannel[];
  claimedChannelIds: ReadonlySet<string>;
};

function orderSections(
  sections: readonly SidebarSection[],
  savedOrder: readonly string[]
): SidebarSection[] {
  const rank = new Map<string, number>();
  savedOrder.forEach((key, index) => {
    const id = key.startsWith('label:') ? key.slice('label:'.length) : key;
    if (!rank.has(id)) rank.set(id, index);
  });

  return sections.slice().sort((left, right) => {
    const leftRank = rank.get(left.id);
    const rightRank = rank.get(right.id);
    if (leftRank !== undefined && rightRank !== undefined) {
      return leftRank - rightRank;
    }
    if (leftRank !== undefined) return -1;
    if (rightRank !== undefined) return 1;
    return (
      left.sortOrder - right.sortOrder || left.name.localeCompare(right.name)
    );
  });
}

function sortSectionMembers(
  channels: readonly SidebarChannel[],
  sort: 'smart' | 'name' | 'updated_at' | 'viewed_at' | 'created_at',
  unreadOrMentionedIds: ReadonlySet<string>,
  mentionCounts: ReadonlyMap<string, number>
): SidebarChannel[] {
  const copy = channels.slice();
  if (sort === 'name') {
    return copy.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    );
  }
  if (sort === 'viewed_at') {
    return copy.sort(
      (a, b) => b.viewedAtMs - a.viewedAtMs || a.name.localeCompare(b.name)
    );
  }
  if (sort === 'created_at') {
    return copy.sort(
      (a, b) => b.createdAtMs - a.createdAtMs || a.name.localeCompare(b.name)
    );
  }
  if (sort === 'updated_at') {
    return copy.sort(
      (a, b) => b.updatedAtMs - a.updatedAtMs || a.name.localeCompare(b.name)
    );
  }

  // Smart density sort: mentions -> unread -> most recently active -> A-Z.
  return copy.sort((left, right) => {
    const mentionDiff =
      (mentionCounts.get(right.id) ?? 0) - (mentionCounts.get(left.id) ?? 0);
    if (mentionDiff !== 0) return mentionDiff;
    const unreadDiff =
      Number(unreadOrMentionedIds.has(right.id)) -
      Number(unreadOrMentionedIds.has(left.id));
    if (unreadDiff !== 0) return unreadDiff;
    const timeDiff = right.updatedAtMs - left.updatedAtMs;
    if (timeDiff !== 0) return timeDiff;
    return left.name.localeCompare(right.name, undefined, {
      sensitivity: 'base',
    });
  });
}

export function buildBrowsePlacement(options: {
  channels: readonly SidebarChannel[];
  sections: readonly SidebarSection[];
  sectionOrder: readonly string[];
  hiddenTeamSectionIds: ReadonlySet<string>;
  expandedLargeSectionIds: ReadonlySet<string>;
  /** Per-section visible window limits (progressive +25 paging on large sections). */
  sectionWindowLimits?: ReadonlyMap<string, number>;
  sectionSortById?: ReadonlyMap<
    string,
    'smart' | 'name' | 'updated_at' | 'viewed_at' | 'created_at'
  >;
  unreadIds: ReadonlySet<string>;
  unreadOrMentionedIds: ReadonlySet<string>;
  mentionCounts: ReadonlyMap<string, number>;
  mutedIds: ReadonlySet<string>;
  selectedChannelId?: string;
  unreadOnly: boolean;
  hideMuted: boolean;
}): BrowsePlacement {
  const channelsById = new Map<string, SidebarChannel>();
  for (const channel of options.channels) {
    if (channel.channelType !== 'direct_message') {
      channelsById.set(channel.id, channel);
    }
  }

  const personalRaw = orderSections(
    options.sections.filter((section) => section.scope === 'personal'),
    options.sectionOrder
  );
  const teamRaw = orderSections(
    options.sections.filter((section) => section.scope === 'team'),
    options.sectionOrder
  );

  const claimed = new Set<string>();

  const placeSection = (section: SidebarSection): PlacedSection => {
    const rawMembers: SidebarChannel[] = [];
    let totalMemberCount = 0;
    let unreadCount = 0;
    let mentionCount = 0;

    for (const id of section.channelIds) {
      if (claimed.has(id)) continue;
      const channel = channelsById.get(id);
      // Personal sections are strictly participant-only when resolved.
      if (channel && section.scope === 'personal' && !channel.isParticipant) {
        continue;
      }
      claimed.add(id);
      totalMemberCount += 1;
      if (options.unreadIds.has(id)) unreadCount += 1;
      mentionCount += options.mentionCounts.get(id) ?? 0;
      if (channel) {
        rawMembers.push(channel);
      }
    }

    const commonPrefix = detectCommonSectionPrefix(
      rawMembers.map((channel) => channel.name)
    );
    const isLarge =
      Math.max(rawMembers.length, totalMemberCount) > LARGE_SECTION_SMART_LIMIT;
    const sortMode =
      options.sectionSortById?.get(section.id) ?? (isLarge ? 'smart' : 'name');

    const filtered = rawMembers.filter((channel) => {
      const isUnread = options.unreadOrMentionedIds.has(channel.id);
      if (options.unreadOnly && !isUnread) return false;
      if (
        options.hideMuted &&
        options.mutedIds.has(channel.id) &&
        !isUnread &&
        channel.id !== options.selectedChannelId
      ) {
        return false;
      }
      return true;
    });

    const sorted = sortSectionMembers(
      filtered,
      sortMode,
      options.unreadOrMentionedIds,
      options.mentionCounts
    );

    const allPlaced: PlacedSectionChannel[] = sorted.map((channel) => ({
      channel,
      displayName: stripCommonPrefix(channel.name, commonPrefix),
    }));

    const explicitWindow = options.sectionWindowLimits?.get(section.id);
    const expandAll =
      explicitWindow === undefined &&
      (options.expandedLargeSectionIds.has(section.id) ||
        options.unreadOnly ||
        allPlaced.length <= LARGE_SECTION_SMART_LIMIT);

    const effectiveCap =
      explicitWindow ??
      (expandAll ? allPlaced.length : LARGE_SECTION_SMART_LIMIT);

    let visibleChannels: PlacedSectionChannel[];
    if (expandAll || allPlaced.length <= effectiveCap) {
      visibleChannels = allPlaced;
    } else {
      const kept: PlacedSectionChannel[] = [];
      const seen = new Set<string>();
      for (const entry of allPlaced) {
        if (
          options.unreadOrMentionedIds.has(entry.channel.id) ||
          entry.channel.id === options.selectedChannelId
        ) {
          kept.push(entry);
          seen.add(entry.channel.id);
        }
      }
      for (const entry of allPlaced) {
        if (kept.length >= effectiveCap) break;
        if (seen.has(entry.channel.id)) continue;
        kept.push(entry);
        seen.add(entry.channel.id);
      }
      visibleChannels = kept;
    }

    const unresolvedCount = Math.max(0, totalMemberCount - rawMembers.length);
    const effectiveTotal =
      options.unreadOnly || options.hideMuted
        ? allPlaced.length
        : Math.max(allPlaced.length, totalMemberCount);

    return {
      section,
      isSupport: isSupportSection(section),
      commonPrefix,
      allChannels: allPlaced,
      visibleChannels,
      totalMemberCount,
      unresolvedCount,
      overflowCount: Math.max(0, effectiveTotal - visibleChannels.length),
      unreadCount,
      mentionCount,
    };
  };

  // 1. Personal sections claim first.
  const personalSections = personalRaw.map(placeSection);

  // 2. Team sections claim remaining channels; hidden team sections still
  //    claim their members so hiding a noisy team section genuinely hides it.
  const teamSections: PlacedSection[] = [];
  const hiddenTeamSections: SidebarSection[] = [];

  for (const section of teamRaw) {
    if (options.hiddenTeamSectionIds.has(section.id)) {
      hiddenTeamSections.push(section);
      for (const id of section.channelIds) {
        claimed.add(id);
      }
      continue;
    }
    teamSections.push(placeSection(section));
  }

  // 3. Ungrouped joined channels only (zero duplicates with sections above).
  const ungroupedChannels = options.channels
    .filter((channel) => {
      if (channel.channelType === 'direct_message') return false;
      if (!channel.isParticipant) return false;
      if (claimed.has(channel.id)) return false;
      const isUnread = options.unreadOrMentionedIds.has(channel.id);
      if (options.unreadOnly && !isUnread) return false;
      if (
        options.hideMuted &&
        options.mutedIds.has(channel.id) &&
        !isUnread &&
        channel.id !== options.selectedChannelId
      ) {
        return false;
      }
      return true;
    })
    .sort((left, right) => {
      const mentionDiff =
        (options.mentionCounts.get(right.id) ?? 0) -
        (options.mentionCounts.get(left.id) ?? 0);
      if (mentionDiff !== 0) return mentionDiff;
      const unreadDiff =
        Number(options.unreadOrMentionedIds.has(right.id)) -
        Number(options.unreadOrMentionedIds.has(left.id));
      if (unreadDiff !== 0) return unreadDiff;
      return (
        right.updatedAtMs - left.updatedAtMs ||
        left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
      );
    });

  return {
    personalSections,
    teamSections,
    hiddenTeamSections,
    ungroupedChannels,
    claimedChannelIds: claimed,
  };
}
