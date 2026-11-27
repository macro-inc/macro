import { heuristicChannelTriage } from './jev-triage';
import {
  type ChannelTriageResult,
  type FocusBucket,
  formatCompactAge,
  type SidebarChannel,
  type TriageSource,
} from './sidebar-model';
import {
  resolveSenderRole,
  type SupportDeskModel,
  stripSupportDisplayName,
} from './support-triage';

/**
 * Focus ("Needs you") triage lens: surfaces every actionable conversation in
 * four calm buckets (`direct`, `support`, `unread`, `fyi`), applying Email
 * Focus's "one clear reason per row" discipline so high-signal messages never
 * drown in automated or muted chatter.
 */

export type FocusReason =
  | { kind: 'urgent'; tone: 'warning' }
  | { kind: 'mentioned'; tone: 'accent' }
  | { kind: 'needs_reply'; tone: 'warning' }
  | { kind: 'waiting'; age: string; tone: 'warning' }
  | { kind: 'agent'; tone: 'neutral' }
  | { kind: 'fyi'; tone: 'muted' };

export type FocusItem = {
  channel: SidebarChannel;
  displayName: string;
  bucket: FocusBucket;
  reason?: FocusReason;
  triageSource: TriageSource;
  mentions: number;
  unread: boolean;
  previewText: string;
  ageLabel: string;
};

export type FocusModel = {
  direct: FocusItem[];
  support: FocusItem[];
  unread: FocusItem[];
  fyi: FocusItem[];
  actionableCount: number;
  totalCount: number;
};

export function buildFocusModel(options: {
  channels: readonly SidebarChannel[];
  supportDesk: SupportDeskModel;
  currentUserId: string | undefined;
  teamMemberIds: ReadonlySet<string>;
  unreadIds: ReadonlySet<string>;
  unreadOrMentionedIds: ReadonlySet<string>;
  mentionCounts: ReadonlyMap<string, number>;
  mutedIds: ReadonlySet<string>;
  triageByChannelId: ReadonlyMap<string, ChannelTriageResult>;
  nowMs: number;
}): FocusModel {
  const direct: FocusItem[] = [];
  const support: FocusItem[] = [];
  const unread: FocusItem[] = [];
  const fyi: FocusItem[] = [];

  const placed = new Set<string>();

  // 1. Support channels that genuinely need a reply (even if someone already
  //    clicked in without replying!) belong in the Support bucket — unless
  //    the viewer was directly @mentioned, which elevates them to Direct.
  for (const item of options.supportDesk.needsReplyGroup) {
    if (options.mutedIds.has(item.channel.id) && item.mentions === 0) continue;

    const isUrgent = item.state === 'urgent';
    const focusItem: FocusItem = {
      channel: item.channel,
      displayName: item.displayName,
      bucket: item.mentions > 0 ? 'direct' : 'support',
      reason: isUrgent
        ? { kind: 'urgent', tone: 'warning' }
        : item.mentions > 0
          ? { kind: 'mentioned', tone: 'accent' }
          : { kind: 'waiting', age: item.waitAgeLabel, tone: 'warning' },
      triageSource: item.triageSource,
      mentions: item.mentions,
      unread: item.unread,
      previewText: item.previewText,
      ageLabel: item.waitAgeLabel,
    };

    placed.add(item.channel.id);
    if (focusItem.bucket === 'direct') direct.push(focusItem);
    else support.push(focusItem);
  }

  const supportIds = new Set(
    options.supportDesk.items.map((item) => item.channel.id)
  );

  // 2. Remaining unread or mentioned joined channels and DMs.
  for (const channel of options.channels) {
    if (!channel.isParticipant) continue;
    if (placed.has(channel.id)) continue;

    const mentions = options.mentionCounts.get(channel.id) ?? 0;
    const isUnread = options.unreadIds.has(channel.id);
    if (!isUnread && mentions === 0) continue;

    // Muted channels only pierce Focus on direct @mentions.
    if (options.mutedIds.has(channel.id) && mentions === 0) continue;

    const senderRole = resolveSenderRole({
      channel,
      currentUserId: options.currentUserId,
      teamMemberIds: options.teamMemberIds,
    });

    const cached = options.triageByChannelId.get(channel.id);
    const triage =
      cached &&
      cached.messageId === (channel.latestMessage?.messageId ?? 'empty')
        ? cached
        : heuristicChannelTriage({
            channel,
            isSupport: supportIds.has(channel.id),
            senderRole,
            mentionedCurrentUser: mentions > 0,
            nowMs: options.nowMs,
          });

    const lastAtMs = channel.latestMessage?.createdAtMs ?? channel.updatedAtMs;
    const ageLabel = formatCompactAge(Math.max(0, options.nowMs - lastAtMs));
    const previewText = (channel.latestMessage?.content ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    const displayName = supportIds.has(channel.id)
      ? stripSupportDisplayName(channel.name)
      : channel.name;

    const isFyiNoise =
      mentions === 0 &&
      triage.scores.fyiNoise >= 0.68 &&
      triage.scores.urgent < 0.5 &&
      triage.scores.needsReply < 0.5;

    let bucket: FocusBucket;
    let reason: FocusReason | undefined;

    if (mentions > 0) {
      bucket = 'direct';
      reason =
        triage.scores.urgent >= 0.7
          ? { kind: 'urgent', tone: 'warning' }
          : { kind: 'mentioned', tone: 'accent' };
    } else if (
      channel.channelType === 'direct_message' &&
      !channel.isAgentDm &&
      senderRole !== 'you' &&
      !isFyiNoise
    ) {
      bucket = 'direct';
      reason =
        triage.scores.urgent >= 0.7
          ? { kind: 'urgent', tone: 'warning' }
          : { kind: 'needs_reply', tone: 'warning' };
    } else if (isFyiNoise) {
      bucket = 'fyi';
      reason =
        senderRole === 'agent'
          ? { kind: 'agent', tone: 'neutral' }
          : { kind: 'fyi', tone: 'muted' };
    } else {
      bucket = 'unread';
      if (triage.scores.urgent >= 0.7) {
        reason = { kind: 'urgent', tone: 'warning' };
      } else if (triage.scores.needsReply >= 0.7) {
        reason = { kind: 'needs_reply', tone: 'warning' };
      } else if (senderRole === 'agent') {
        reason = { kind: 'agent', tone: 'neutral' };
      }
    }

    const focusItem: FocusItem = {
      channel,
      displayName,
      bucket,
      reason,
      triageSource: triage.source,
      mentions,
      unread: isUnread,
      previewText,
      ageLabel,
    };

    if (bucket === 'direct') direct.push(focusItem);
    else if (bucket === 'fyi') fyi.push(focusItem);
    else unread.push(focusItem);
  }

  const sortFocus = (left: FocusItem, right: FocusItem) =>
    Number(right.reason?.kind === 'urgent') -
      Number(left.reason?.kind === 'urgent') ||
    right.mentions - left.mentions ||
    right.channel.updatedAtMs - left.channel.updatedAtMs ||
    left.displayName.localeCompare(right.displayName);

  direct.sort(sortFocus);
  unread.sort(sortFocus);
  fyi.sort(sortFocus);

  const actionableCount = direct.length + support.length + unread.length;

  return {
    direct,
    support,
    unread,
    fyi,
    actionableCount,
    totalCount: actionableCount + fyi.length,
  };
}
