import { heuristicChannelTriage } from './jev-triage';
import {
  type ChannelTriageResult,
  formatCompactAge,
  type SidebarChannel,
  type SidebarSection,
  type SupportChannelState,
  type SupportSenderRole,
  type TriageSource,
} from './sidebar-model';

/**
 * Support / customer-channel detection, common-prefix stripping, and
 * operational triage bucketing (`Needs reply`, `Agent handling`,
 * `Waiting on customer`, `Quiet & resolved`).
 */

const SUPPORT_SECTION_RE =
  /\b(support|customers?|clients?|helpdesk|accounts?|vip)\b/i;

const SUPPORT_CHANNEL_PREFIX_RE =
  /^(?:macro\s+)?support\s*(?:x|×|-|:|\||\/)\s*/i;

const CUSTOMER_CHANNEL_NAME_RE =
  /(?:^|\b)(?:support\s*(?:x|×|-|:|\|)|cust(?:omer)?[-_\s]|client[-_\s]|helpdesk[-_\s])/i;

const BOT_PRINCIPAL_PREFIX = 'bot|';
const QUIET_RESOLVED_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function isSupportSection(
  section: Pick<SidebarSection, 'name' | 'ruleContains'>
): boolean {
  if (SUPPORT_SECTION_RE.test(section.name)) return true;
  if (section.ruleContains && SUPPORT_SECTION_RE.test(section.ruleContains)) {
    return true;
  }
  return false;
}

/** Identify whether a channel is a customer/support channel. */
export function isSupportChannel(
  channel: Pick<SidebarChannel, 'id' | 'name' | 'channelType'>,
  supportSectionChannelIds: ReadonlySet<string>
): boolean {
  if (channel.channelType === 'direct_message') return false;
  if (supportSectionChannelIds.has(channel.id)) return true;
  return CUSTOMER_CHANNEL_NAME_RE.test(channel.name);
}

/**
 * Strip redundant prefixes like `Macro Support x Acme Corp` → `Acme Corp` so
 * 256px sidebar rows stay immediately readable. Always keeps a non-empty label.
 */
export function stripSupportDisplayName(name: string): string {
  const trimmed = name.trim();
  const stripped = trimmed
    .replace(SUPPORT_CHANNEL_PREFIX_RE, '')
    .replace(/^(?:cust(?:omer)?|client|helpdesk)[-_\s:]+/i, '')
    .trim();
  return stripped.length > 0 ? stripped : trimmed;
}

/**
 * Detect a dominant repeated prefix across a section's channels (for example
 * `Macro Support x ` or `proj-`) and return the clean prefix to strip visually
 * when at least 60% of channels share it and it is at least 6 characters long.
 */
export function detectCommonSectionPrefix(
  names: readonly string[]
): string | undefined {
  if (names.length < 3) return undefined;

  const counts = new Map<string, number>();
  for (const raw of names) {
    const match = raw.match(
      /^([a-z0-9\s]{3,32}?(?:\s*(?:x|×|-|:|\|)\s+|[-_/]))/i
    );
    if (!match?.[1]) continue;
    const prefix = match[1];
    if (prefix.length < 5) continue;
    const normalized = prefix.toLowerCase();
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }

  let bestPrefix: string | undefined;
  let bestCount = 0;
  for (const [prefix, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      bestPrefix = prefix;
    }
  }

  if (!bestPrefix || bestCount / names.length < 0.6) return undefined;
  return bestPrefix;
}

export function stripCommonPrefix(
  name: string,
  normalizedPrefix: string | undefined
): string {
  if (!normalizedPrefix) return name;
  if (name.toLowerCase().startsWith(normalizedPrefix)) {
    const rest = name.slice(normalizedPrefix.length).trim();
    if (rest.length > 0) return rest;
  }
  return name;
}

export function resolveSenderRole(options: {
  channel: SidebarChannel;
  currentUserId: string | undefined;
  teamMemberIds: ReadonlySet<string>;
}): SupportSenderRole {
  const senderId = options.channel.latestMessage?.senderId;
  if (!senderId) return 'unknown';

  const senderLower = senderId.toLowerCase();
  if (
    options.currentUserId &&
    senderLower === options.currentUserId.toLowerCase()
  ) {
    return 'you';
  }

  if (
    senderLower.startsWith(BOT_PRINCIPAL_PREFIX) ||
    options.channel.isAgentDm ||
    options.channel.botParticipantIds.some(
      (botId) =>
        botId.toLowerCase() === senderLower ||
        `${BOT_PRINCIPAL_PREFIX}${botId.toLowerCase()}` === senderLower
    )
  ) {
    return 'agent';
  }

  if (
    options.teamMemberIds.has(senderId) ||
    options.teamMemberIds.has(senderLower)
  ) {
    return 'teammate';
  }

  return 'customer';
}

export type SupportTriageItem = {
  channel: SidebarChannel;
  displayName: string;
  state: SupportChannelState;
  senderRole: SupportSenderRole;
  triageSource: TriageSource;
  waitAgeLabel: string;
  waitingMs: number;
  unread: boolean;
  mentions: number;
  previewText: string;
  scores: ChannelTriageResult['scores'];
};

export type SupportDeskModel = {
  items: SupportTriageItem[];
  byState: Record<SupportChannelState, SupportTriageItem[]>;
  needsReplyGroup: SupportTriageItem[];
  needsReplyCount: number;
  urgentCount: number;
  agentHandlingCount: number;
  waitingOnCustomerCount: number;
  resolvedCount: number;
  totalCount: number;
};

export function classifySupportChannel(options: {
  channel: SidebarChannel;
  currentUserId: string | undefined;
  teamMemberIds: ReadonlySet<string>;
  unread: boolean;
  mentions: number;
  triage?: ChannelTriageResult;
  nowMs: number;
}): SupportTriageItem {
  const { channel, nowMs } = options;
  const senderRole = resolveSenderRole({
    channel,
    currentUserId: options.currentUserId,
    teamMemberIds: options.teamMemberIds,
  });

  const resolvedTriage =
    options.triage &&
    options.triage.messageId === (channel.latestMessage?.messageId ?? 'empty')
      ? options.triage
      : heuristicChannelTriage({
          channel,
          isSupport: true,
          senderRole,
          mentionedCurrentUser: options.mentions > 0,
          nowMs,
        });

  const { scores } = resolvedTriage;
  const lastAtMs = channel.latestMessage?.createdAtMs ?? channel.updatedAtMs;
  const waitingMs = lastAtMs > 0 ? Math.max(0, nowMs - lastAtMs) : 0;

  let state: SupportChannelState;
  if (!channel.latestMessage) {
    state = 'resolved';
  } else if (
    scores.resolved >= 0.72 &&
    scores.needsReply < 0.45 &&
    scores.urgent < 0.5 &&
    options.mentions === 0
  ) {
    state = 'resolved';
  } else if (senderRole === 'you' || senderRole === 'teammate') {
    state =
      !options.unread && waitingMs >= QUIET_RESOLVED_AGE_MS
        ? 'resolved'
        : 'waiting_on_customer';
  } else if (senderRole === 'agent') {
    if (scores.urgent >= 0.7 || options.mentions > 0) {
      state = 'urgent';
    } else if (!options.unread && waitingMs >= QUIET_RESOLVED_AGE_MS) {
      state = 'resolved';
    } else {
      state = 'agent_handling';
    }
  } else {
    // External customer or unknown non-team speaker spoke last.
    if (scores.urgent >= 0.65) {
      state = 'urgent';
    } else if (
      scores.needsReply >= 0.45 ||
      options.unread ||
      options.mentions > 0
    ) {
      state = 'needs_reply';
    } else if (waitingMs >= QUIET_RESOLVED_AGE_MS) {
      state = 'resolved';
    } else {
      state = 'needs_reply';
    }
  }

  return {
    channel,
    displayName: stripSupportDisplayName(channel.name),
    state,
    senderRole,
    triageSource: resolvedTriage.source,
    waitAgeLabel: formatCompactAge(waitingMs),
    waitingMs,
    unread: options.unread,
    mentions: options.mentions,
    previewText: (channel.latestMessage?.content ?? '')
      .replace(/\s+/g, ' ')
      .trim(),
    scores,
  };
}

export function buildSupportDeskModel(options: {
  channels: readonly SidebarChannel[];
  sections: readonly SidebarSection[];
  currentUserId: string | undefined;
  teamMemberIds: ReadonlySet<string>;
  unreadIds: ReadonlySet<string>;
  mentionCounts: ReadonlyMap<string, number>;
  triageByChannelId: ReadonlyMap<string, ChannelTriageResult>;
  filterQuery?: string;
  nowMs: number;
}): SupportDeskModel {
  const supportSectionChannelIds = new Set<string>();
  for (const section of options.sections) {
    if (isSupportSection(section)) {
      for (const id of section.channelIds) supportSectionChannelIds.add(id);
    }
  }

  const normalizedQuery = options.filterQuery?.trim().toLowerCase() ?? '';

  const items: SupportTriageItem[] = [];
  for (const channel of options.channels) {
    if (!channel.isParticipant) continue;
    if (!isSupportChannel(channel, supportSectionChannelIds)) continue;

    const item = classifySupportChannel({
      channel,
      currentUserId: options.currentUserId,
      teamMemberIds: options.teamMemberIds,
      unread: options.unreadIds.has(channel.id),
      mentions: options.mentionCounts.get(channel.id) ?? 0,
      triage: options.triageByChannelId.get(channel.id),
      nowMs: options.nowMs,
    });

    if (
      normalizedQuery &&
      !item.displayName.toLowerCase().includes(normalizedQuery) &&
      !channel.name.toLowerCase().includes(normalizedQuery) &&
      !item.previewText.toLowerCase().includes(normalizedQuery)
    ) {
      continue;
    }

    items.push(item);
  }

  const byState: Record<SupportChannelState, SupportTriageItem[]> = {
    urgent: [],
    needs_reply: [],
    agent_handling: [],
    waiting_on_customer: [],
    resolved: [],
  };

  for (const item of items) {
    byState[item.state].push(item);
  }

  // Urgent & Needs reply: highest urgency/mentions first, then longest waiting
  // (oldest unanswered message) so customers waiting longest never sink.
  const sortActionable = (left: SupportTriageItem, right: SupportTriageItem) =>
    Number(right.state === 'urgent') - Number(left.state === 'urgent') ||
    right.mentions - left.mentions ||
    right.scores.urgent - left.scores.urgent ||
    right.waitingMs - left.waitingMs ||
    left.displayName.localeCompare(right.displayName);

  // Passive states: most recently active first.
  const sortRecent = (left: SupportTriageItem, right: SupportTriageItem) =>
    right.channel.updatedAtMs - left.channel.updatedAtMs ||
    left.displayName.localeCompare(right.displayName);

  byState.urgent.sort(sortActionable);
  byState.needs_reply.sort(sortActionable);
  byState.agent_handling.sort(sortRecent);
  byState.waiting_on_customer.sort(sortRecent);
  byState.resolved.sort(sortRecent);

  const needsReplyGroup = [...byState.urgent, ...byState.needs_reply].sort(
    sortActionable
  );

  return {
    items,
    byState,
    needsReplyGroup,
    needsReplyCount: needsReplyGroup.length,
    urgentCount: byState.urgent.length,
    agentHandlingCount: byState.agent_handling.length,
    waitingOnCustomerCount: byState.waiting_on_customer.length,
    resolvedCount: byState.resolved.length,
    totalCount: items.length,
  };
}
