/**
 * Pure domain vocabulary for the redesigned Chat sidebar.
 *
 * Kept framework-free and transport-independent so every grouping, DM window,
 * support-triage, Focus, quick-switch, and Jev policy can be unit-tested on
 * plain inputs without mounting Solid or mocking services.
 */

export type SidebarLens = 'browse' | 'focus' | 'support' | 'threads';

export type DmFilter = 'all' | 'people' | 'agents';

export type DmWindowLimit = 5 | 7 | 12 | 'all';

export type SupportChannelState =
  | 'urgent'
  | 'needs_reply'
  | 'agent_handling'
  | 'waiting_on_customer'
  | 'resolved';

export type SupportSenderRole =
  | 'you'
  | 'teammate'
  | 'agent'
  | 'customer'
  | 'unknown';

export type FocusBucket = 'direct' | 'support' | 'unread' | 'fyi';

export type TriageSource = 'jev' | 'heuristic';

export type TriageEngineStatus = 'idle' | 'jev' | 'heuristic' | 'paused';

/** Normalized channel record consumed by pure sidebar algorithms. */
export type SidebarChannel = {
  id: string;
  name: string;
  channelType: 'direct_message' | 'private' | 'public' | 'team';
  teamId?: string;
  isParticipant: boolean;
  updatedAtMs: number;
  viewedAtMs: number;
  createdAtMs: number;
  frecencyScore: number;
  participantIds: readonly string[];
  botParticipantIds: readonly string[];
  isAgentDm: boolean;
  latestMessage?: {
    messageId: string;
    senderId: string;
    content: string;
    createdAtMs: number;
    threadId?: string;
    mentions: readonly string[];
  };
};

/** Normalized section (shared team or account-private) definition. */
export type SidebarSection = {
  id: string;
  name: string;
  scope: 'team' | 'personal';
  teamId?: string;
  ruleContains?: string;
  channelIds: readonly string[];
  sortOrder: number;
};

/** Cached yes/no probabilities for a specific `(channelId, latestMessageId)` tail. */
export type ChannelTriageScores = {
  needsReply: number;
  urgent: number;
  resolved: number;
  fyiNoise: number;
};

export type ChannelTriageResult = {
  channelId: string;
  messageId: string;
  source: TriageSource;
  scores: ChannelTriageScores;
  classifiedAtMs: number;
};

export type SidebarPreferences = {
  activeLens: SidebarLens;
  unreadOnly: boolean;
  hideMuted: boolean;
  dmFilter: DmFilter;
  dmWindowLimit: DmWindowLimit;
  dmExpandedAll: boolean;
  hiddenTeamSectionIds: string[];
  expandedLargeSectionIds: string[];
  jevEnabled: boolean;
  collapsedPersonalZone: boolean;
  collapsedTeamZone: boolean;
  collapsedSupportBuckets: SupportChannelState[];
  collapsedFocusFyi: boolean;
};

export const DEFAULT_SIDEBAR_PREFERENCES: SidebarPreferences = {
  activeLens: 'browse',
  unreadOnly: false,
  hideMuted: false,
  dmFilter: 'all',
  dmWindowLimit: 7,
  dmExpandedAll: false,
  hiddenTeamSectionIds: [],
  expandedLargeSectionIds: [],
  jevEnabled: true,
  collapsedPersonalZone: false,
  collapsedTeamZone: false,
  collapsedSupportBuckets: ['resolved'],
  collapsedFocusFyi: true,
};

/** Number of channels at which a Browse section uses smart window density. */
export const LARGE_SECTION_SMART_LIMIT = 8;

/** Parse an ISO string, Date, or epoch ms into finite epoch milliseconds. */
export function toEpochMs(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : 0;
  }
  if (typeof value === 'string' && value.length > 0) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : 0;
  }
  return 0;
}

/** Compact age label for wait-time and recency pills (`now`, `4m`, `2h`, `3d`). */
export function formatCompactAge(ageMs: number): string {
  const safeMs = Math.max(0, ageMs);
  const minutes = Math.floor(safeMs / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}
