import type {
  ChannelTriageResult,
  ChannelTriageScores,
  SidebarChannel,
  SidebarSection,
  SupportSenderRole,
} from './sidebar-model';

/**
 * Pure Jev classification contract, deterministic heuristic fallback, caching
 * keys, burst selection, Smart Organize suggestions, and cost estimation.
 *
 * Pricing reference (`crates/macro_db_client/migrations/20261006034942_seed_jev_pricing.sql`):
 * TypeSafe `jev-latest` = $0.042 per 1M input tokens, $0 output tokens.
 */

export const JEV_PRICE_PER_MILLION_INPUT_TOKENS_USD = 0.042;
export const JEV_ESTIMATED_TOKENS_PER_CHANNEL_CALL = 450;
export const JEV_MAX_CONCURRENCY = 3;
export const JEV_MAX_BURST_CHANNELS = 25;
export const JEV_MAX_CACHE_ENTRIES = 400;
export const JEV_TAIL_TRUNCATE_CHARS = 400;

export const JEV_TRIAGE_QUESTIONS = {
  needs_reply:
    'Does this latest chat message expect a response, answer, decision, or action from the reader or their team?',
  urgent:
    'Is this message urgent, time-sensitive, reporting a blocker, outage, critical bug, or frustrated customer?',
  resolved:
    'Is this message wrapping up, thanking someone, confirming a fix, or needing no further reply?',
  fyi_noise:
    'Is this message purely an automated notification, bot log, deploy update, or passive FYI with no action needed?',
} as const;

export type JevTriageQuestionKey = keyof typeof JEV_TRIAGE_QUESTIONS;

export type JevDecisionPayload = {
  input: Record<string, unknown>;
  questions: Record<string, string>;
};

export function triageCacheKey(channelId: string, messageId: string): string {
  return `${channelId}:${messageId}`;
}

function sanitizeSnippet(content: string): string {
  const collapsed = content
    .replace(/```[\s\S]*?```/g, '[code]')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '[image]')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (collapsed.length <= JEV_TAIL_TRUNCATE_CHARS) return collapsed;
  return `${collapsed.slice(0, JEV_TAIL_TRUNCATE_CHARS - 1)}…`;
}

export function buildChannelTriageRequest(options: {
  channel: SidebarChannel;
  isSupport: boolean;
  senderRole: SupportSenderRole;
  mentionedCurrentUser: boolean;
  nowMs: number;
}): JevDecisionPayload {
  const message = options.channel.latestMessage;
  const ageMinutes = message
    ? Math.max(0, Math.round((options.nowMs - message.createdAtMs) / 60_000))
    : 0;

  return {
    input: {
      channel_name: options.channel.name.slice(0, 120),
      channel_type: options.channel.channelType,
      is_support_channel: options.isSupport,
      is_agent_dm: options.channel.isAgentDm,
      sender_role: options.senderRole,
      mentioned_reader: options.mentionedCurrentUser,
      age_minutes: ageMinutes,
      latest_message: message ? sanitizeSnippet(message.content) : '',
    },
    questions: { ...JEV_TRIAGE_QUESTIONS },
  };
}

function clampProb(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

export function interpretChannelTriageResponse(options: {
  channelId: string;
  messageId: string;
  probabilities: Readonly<Record<string, number>>;
  nowMs: number;
}): ChannelTriageResult {
  return {
    channelId: options.channelId,
    messageId: options.messageId,
    source: 'jev',
    scores: {
      needsReply: clampProb(options.probabilities.needs_reply, 0.5),
      urgent: clampProb(options.probabilities.urgent, 0),
      resolved: clampProb(options.probabilities.resolved, 0),
      fyiNoise: clampProb(options.probabilities.fyi_noise, 0),
    },
    classifiedAtMs: options.nowMs,
  };
}

const URGENT_RE =
  /\b(urgent|asap|p0|p1|sev[01]|outage|down|broken|crash(?:ed|ing)?|blocker|blocked|500|502|503|production|prod is|failing|critical|emergency|can'?t log ?in|cannot log ?in|data loss|escalat(?:e|ion))\b/i;

const QUESTION_OR_ASK_RE =
  /(\?|^(?:hey|hi|hello)\b|\b(?:can you|could you|would you|please|pls|help|thoughts|confirm|approve|sign[- ]?off|review|eta|update on|any update|status|wondering|issue with|problem with|not working|doesn'?t work)\b)/i;

const RESOLVED_RE =
  /^\s*(?:thanks|thank you|thx|ty|awesome|perfect|great|got it|sounds good|all good|fixed|working now|that worked|resolved|appreciate it|cheers|lgtm|👍|🙏|✅)[\s!.,🙏👍✅]*$/iu;

const RESOLVED_PHRASE_RE =
  /\b(that fixed it|all set now|working now|issue is resolved|problem solved|thanks so much|thank you so much|no further action|good to close)\b/i;

const FYI_AUTOMATED_RE =
  /\b(deployed|deployment|build passed|build succeeded|ci passed|merged pr|release v?\d|automated|digest|summary report|scheduled run|cron|nightly|webhook received|metric alert cleared|fyi:?)\b/i;

/**
 * Deterministic zero-latency fallback classifier used before Jev replies,
 * when Jev is paused, or when `/decisions` is unavailable (e.g., local stack
 * without a TypeSafe API key).
 */
export function heuristicChannelTriage(options: {
  channel: SidebarChannel;
  isSupport: boolean;
  senderRole: SupportSenderRole;
  mentionedCurrentUser: boolean;
  nowMs: number;
}): ChannelTriageResult {
  const message = options.channel.latestMessage;
  const text = message ? sanitizeSnippet(message.content) : '';
  const messageId = message?.messageId ?? 'empty';

  const scores: ChannelTriageScores = {
    needsReply: 0.2,
    urgent: 0.05,
    resolved: 0.1,
    fyiNoise: 0.1,
  };

  if (!message || text.length === 0) {
    return {
      channelId: options.channel.id,
      messageId,
      source: 'heuristic',
      scores,
      classifiedAtMs: options.nowMs,
    };
  }

  if (RESOLVED_RE.test(text) || RESOLVED_PHRASE_RE.test(text)) {
    scores.resolved = 0.88;
    scores.needsReply = 0.1;
    scores.urgent = 0.02;
    return {
      channelId: options.channel.id,
      messageId,
      source: 'heuristic',
      scores,
      classifiedAtMs: options.nowMs,
    };
  }

  const isUrgent = URGENT_RE.test(text);
  const isAsk = QUESTION_OR_ASK_RE.test(text);
  const isFyi =
    FYI_AUTOMATED_RE.test(text) ||
    (options.senderRole === 'agent' && !isAsk && !isUrgent);

  if (isUrgent) {
    scores.urgent = 0.85;
    scores.needsReply = options.senderRole === 'you' ? 0.25 : 0.9;
  }

  if (isFyi && !options.mentionedCurrentUser && !isUrgent) {
    scores.fyiNoise = 0.85;
    scores.needsReply = 0.15;
  } else if (options.senderRole === 'you') {
    scores.needsReply = 0.05;
  } else if (options.mentionedCurrentUser) {
    scores.needsReply = Math.max(scores.needsReply, 0.88);
  } else if (options.isSupport && options.senderRole === 'customer') {
    scores.needsReply = Math.max(scores.needsReply, isAsk ? 0.92 : 0.78);
  } else if (
    options.channel.channelType === 'direct_message' &&
    options.senderRole !== 'agent'
  ) {
    scores.needsReply = Math.max(scores.needsReply, isAsk ? 0.9 : 0.72);
  } else if (isAsk) {
    scores.needsReply = Math.max(scores.needsReply, 0.7);
  }

  return {
    channelId: options.channel.id,
    messageId,
    source: 'heuristic',
    scores,
    classifiedAtMs: options.nowMs,
  };
}

/**
 * Select up to `maxBurst` channels that genuinely benefit from Jev evaluation,
 * skipping channels already cached for their current `latestMessageId` and
 * channels where the viewer sent the latest message.
 *
 * Priority order:
 * 1. Support channels with external/agent tail messages
 * 2. Unread/mentioned DMs
 * 3. Other unread channels
 */
export function selectChannelsForJevTriage(options: {
  channels: readonly SidebarChannel[];
  supportChannelIds: ReadonlySet<string>;
  unreadOrMentionedIds: ReadonlySet<string>;
  currentUserId: string | undefined;
  cachedKeys: ReadonlySet<string>;
  maxBurst?: number;
}): SidebarChannel[] {
  const maxBurst = options.maxBurst ?? JEV_MAX_BURST_CHANNELS;
  const viewerLower = options.currentUserId?.toLowerCase();

  type Candidate = { channel: SidebarChannel; priority: number };
  const candidates: Candidate[] = [];

  for (const channel of options.channels) {
    const msg = channel.latestMessage;
    if (!msg || !msg.content.trim()) continue;
    if (viewerLower && msg.senderId.toLowerCase() === viewerLower) continue;

    const key = triageCacheKey(channel.id, msg.messageId);
    if (options.cachedKeys.has(key)) continue;

    const isSupport = options.supportChannelIds.has(channel.id);
    const isUnread = options.unreadOrMentionedIds.has(channel.id);

    if (isSupport) {
      candidates.push({ channel, priority: isUnread ? 0 : 1 });
    } else if (isUnread && channel.channelType === 'direct_message') {
      candidates.push({ channel, priority: 2 });
    } else if (isUnread) {
      candidates.push({ channel, priority: 3 });
    }
  }

  candidates.sort(
    (left, right) =>
      left.priority - right.priority ||
      right.channel.updatedAtMs - left.channel.updatedAtMs ||
      left.channel.id.localeCompare(right.channel.id)
  );

  return candidates.slice(0, maxBurst).map((entry) => entry.channel);
}

/** Estimate input tokens and USD cost for a number of Jev triage calls. */
export function estimateJevUsage(callCount: number): {
  tokens: number;
  usd: number;
  formattedUsd: string;
} {
  const safeCount = Math.max(0, callCount);
  const tokens = safeCount * JEV_ESTIMATED_TOKENS_PER_CHANNEL_CALL;
  const usd = (tokens / 1_000_000) * JEV_PRICE_PER_MILLION_INPUT_TOKENS_USD;
  const formattedUsd =
    usd < 0.0001 ? '$0.00' : usd < 0.01 ? `<$0.01` : `$${usd.toFixed(3)}`;
  return { tokens, usd, formattedUsd };
}

/** Suggested move produced by "Smart organize with Jev". */
export type OrganizeSuggestion = {
  channelId: string;
  channelName: string;
  target:
    | { kind: 'existing'; sectionId: string; sectionName: string }
    | { kind: 'proposed'; sectionName: string; scope: 'team' | 'personal' };
  confidence: number;
  source: 'jev' | 'heuristic';
};

const DEFAULT_THEMES: readonly {
  name: string;
  pattern: RegExp;
  description: string;
}[] = [
  {
    name: 'Support',
    pattern: /\b(support|helpdesk|customer|client|triage|tickets?|x\s+\w)/i,
    description: 'Customer support, client channels, or helpdesk triage',
  },
  {
    name: 'Engineering',
    pattern:
      /\b(eng|engineering|infra|backend|frontend|mobile|ios|android|web|api|db|cache|rust|dev|platform|ops|sre|security|deploy|ci|build)\b/i,
    description: 'Software engineering, infrastructure, or technical teams',
  },
  {
    name: 'Product & Design',
    pattern:
      /\b(product|design|ux|ui|roadmap|launch|spec|research|feedback|beta|growth|onboarding)\b/i,
    description: 'Product strategy, design, launches, or user research',
  },
  {
    name: 'Incidents & Alerts',
    pattern:
      /\b(inc|incident|alert|alerts|pager|oncall|outage|monitoring|sentry|datadog|bugs?|errors?)\b/i,
    description: 'Incidents, alerts, on-call, or automated monitoring feeds',
  },
  {
    name: 'Company & Ops',
    pattern:
      /\b(general|announce|announcements|random|watercooler|team|all-hands|hiring|recruiting|people|finance|legal|sales|gtm|marketing)\b/i,
    description: 'Company-wide updates, operations, hiring, sales, or GTM',
  },
];

/**
 * Build a single Jev `/decisions` request asking which existing section or
 * theme fits a single ungrouped channel. Uses at most 32 questions (Jev's cap).
 */
export function buildOrganizeSuggestionRequest(
  channel: SidebarChannel,
  existingManualSections: readonly SidebarSection[]
): {
  payload: JevDecisionPayload;
  keyToTarget: Map<string, OrganizeSuggestion['target']>;
} {
  const questions: Record<string, string> = {};
  const keyToTarget = new Map<string, OrganizeSuggestion['target']>();
  let index = 0;

  for (const section of existingManualSections) {
    if (index >= 24) break;
    if (section.ruleContains) continue;
    if (section.scope === 'team' && channel.channelType !== 'team') continue;
    const key = `s_${index++}`;
    questions[key] =
      `Does this channel belong in the existing sidebar section "${section.name}"?`;
    keyToTarget.set(key, {
      kind: 'existing',
      sectionId: section.id,
      sectionName: section.name,
    });
  }

  const existingNamesLower = new Set(
    existingManualSections.map((section) => section.name.toLowerCase())
  );

  for (const theme of DEFAULT_THEMES) {
    if (index >= 32) break;
    if (existingNamesLower.has(theme.name.toLowerCase())) continue;
    const key = `p_${index++}`;
    questions[key] = `Is this channel about ${theme.description}?`;
    keyToTarget.set(key, {
      kind: 'proposed',
      sectionName: theme.name,
      scope: channel.channelType === 'team' ? 'team' : 'personal',
    });
  }

  return {
    payload: {
      input: {
        channel_name: channel.name.slice(0, 120),
        channel_type: channel.channelType,
        latest_message: channel.latestMessage
          ? sanitizeSnippet(channel.latestMessage.content)
          : '',
      },
      questions,
    },
    keyToTarget,
  };
}

/** Deterministic keyword fallback for Smart Organize when Jev is unavailable. */
export function heuristicOrganizeSuggestion(
  channel: SidebarChannel,
  existingManualSections: readonly SidebarSection[]
): OrganizeSuggestion | undefined {
  const nameLower = channel.name.toLowerCase();

  for (const section of existingManualSections) {
    if (section.ruleContains) continue;
    if (section.scope === 'team' && channel.channelType !== 'team') continue;
    const tokens = section.name
      .toLowerCase()
      .split(/[\s\-_/&]+/)
      .filter((token) => token.length >= 3);
    if (tokens.some((token) => nameLower.includes(token))) {
      return {
        channelId: channel.id,
        channelName: channel.name,
        target: {
          kind: 'existing',
          sectionId: section.id,
          sectionName: section.name,
        },
        confidence: 0.78,
        source: 'heuristic',
      };
    }
  }

  for (const theme of DEFAULT_THEMES) {
    if (theme.pattern.test(channel.name)) {
      const existing = existingManualSections.find(
        (section) =>
          !section.ruleContains &&
          section.name.toLowerCase() === theme.name.toLowerCase() &&
          (section.scope === 'personal' || channel.channelType === 'team')
      );
      return {
        channelId: channel.id,
        channelName: channel.name,
        target: existing
          ? {
              kind: 'existing',
              sectionId: existing.id,
              sectionName: existing.name,
            }
          : {
              kind: 'proposed',
              sectionName: theme.name,
              scope: channel.channelType === 'team' ? 'team' : 'personal',
            },
        confidence: 0.74,
        source: 'heuristic',
      };
    }
  }

  return undefined;
}
