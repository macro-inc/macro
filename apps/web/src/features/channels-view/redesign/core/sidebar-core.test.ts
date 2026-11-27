import { describe, expect, it } from 'vitest';
import { buildBrowsePlacement } from './deduplicate-placement';
import { buildDmWindow } from './dm-window';
import { buildFocusModel } from './focus-triage';
import {
  buildChannelTriageRequest,
  buildOrganizeSuggestionRequest,
  estimateJevUsage,
  heuristicChannelTriage,
  heuristicOrganizeSuggestion,
  interpretChannelTriageResponse,
  selectChannelsForJevTriage,
  triageCacheKey,
} from './jev-triage';
import { buildQuickSwitchResults, fuzzyMatchScore } from './quick-switch';
import type {
  ChannelTriageResult,
  SidebarChannel,
  SidebarSection,
} from './sidebar-model';
import {
  buildSupportDeskModel,
  detectCommonSectionPrefix,
  stripCommonPrefix,
  stripSupportDisplayName,
} from './support-triage';

const NOW = Date.parse('2026-11-25T16:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function makeChannel(
  overrides: Partial<SidebarChannel> & { id: string; name: string }
): SidebarChannel {
  return {
    channelType: 'team',
    teamId: 'team-1',
    isParticipant: true,
    updatedAtMs: NOW - 10 * MIN,
    viewedAtMs: NOW - 20 * MIN,
    createdAtMs: NOW - 30 * DAY,
    frecencyScore: 1,
    participantIds: ['viewer', 'teammate-1'],
    botParticipantIds: [],
    isAgentDm: false,
    ...overrides,
  };
}

describe('deduplicate-placement (one home per channel)', () => {
  it('places each channel in at most one section and removes grouped channels from ungrouped', () => {
    const chSupport1 = makeChannel({ id: 'c1', name: 'Macro Support x Acme' });
    const chSupport2 = makeChannel({ id: 'c2', name: 'Macro Support x Beta' });
    const chEng = makeChannel({ id: 'c3', name: 'eng-core' });
    const chUngrouped = makeChannel({ id: 'c4', name: 'random' });
    const chDm = makeChannel({
      id: 'dm1',
      name: 'Alice',
      channelType: 'direct_message',
    });

    const sections: SidebarSection[] = [
      {
        id: 'sec-vip',
        name: 'My VIPs',
        scope: 'personal',
        channelIds: ['c1'],
        sortOrder: 0,
      },
      {
        id: 'sec-support',
        name: 'Support',
        scope: 'team',
        teamId: 'team-1',
        ruleContains: 'Macro Support x',
        channelIds: ['c1', 'c2'],
        sortOrder: 0,
      },
      {
        id: 'sec-eng',
        name: 'Engineering',
        scope: 'team',
        teamId: 'team-1',
        channelIds: ['c3'],
        sortOrder: 1,
      },
    ];

    const result = buildBrowsePlacement({
      channels: [chSupport1, chSupport2, chEng, chUngrouped, chDm],
      sections,
      sectionOrder: [],
      hiddenTeamSectionIds: new Set(),
      expandedLargeSectionIds: new Set(),
      unreadIds: new Set(['c2']),
      unreadOrMentionedIds: new Set(['c2']),
      mentionCounts: new Map(),
      mutedIds: new Set(),
      unreadOnly: false,
      hideMuted: false,
    });

    // Personal section wins placement of c1; team Support gets c2 without duplicating c1.
    expect(
      result.personalSections[0].allChannels.map((c) => c.channel.id)
    ).toEqual(['c1']);
    expect(result.teamSections[0].allChannels.map((c) => c.channel.id)).toEqual(
      ['c2']
    );
    expect(result.teamSections[1].allChannels.map((c) => c.channel.id)).toEqual(
      ['c3']
    );
    // Only truly ungrouped non-DM channel remains in ungroupedChannels.
    expect(result.ungroupedChannels.map((c) => c.id)).toEqual(['c4']);
  });

  it('hides hidden team sections from Browse without dumping their channels into ungrouped', () => {
    const chSales = makeChannel({ id: 'c-sales', name: 'sales-deals' });
    const chGeneral = makeChannel({ id: 'c-gen', name: 'general' });

    const result = buildBrowsePlacement({
      channels: [chSales, chGeneral],
      sections: [
        {
          id: 'sec-sales',
          name: 'Sales',
          scope: 'team',
          teamId: 'team-1',
          channelIds: ['c-sales'],
          sortOrder: 0,
        },
      ],
      sectionOrder: [],
      hiddenTeamSectionIds: new Set(['sec-sales']),
      expandedLargeSectionIds: new Set(),
      unreadIds: new Set(),
      unreadOrMentionedIds: new Set(),
      mentionCounts: new Map(),
      mutedIds: new Set(),
      unreadOnly: false,
      hideMuted: false,
    });

    expect(result.teamSections).toHaveLength(0);
    expect(result.hiddenTeamSections.map((s) => s.id)).toEqual(['sec-sales']);
    expect(result.ungroupedChannels.map((c) => c.id)).toEqual(['c-gen']);
  });

  it('applies smart density capping and prefix stripping on large sections (>8 channels)', () => {
    const channels = Array.from({ length: 40 }, (_, index) =>
      makeChannel({
        id: `sup-${index}`,
        name: `Macro Support x Customer ${String(index).padStart(2, '0')}`,
        updatedAtMs: NOW - index * HOUR,
      })
    );
    const result = buildBrowsePlacement({
      channels,
      sections: [
        {
          id: 'sec-sup',
          name: 'Support',
          scope: 'team',
          teamId: 'team-1',
          ruleContains: 'Macro Support x',
          channelIds: channels.map((c) => c.id),
          sortOrder: 0,
        },
      ],
      sectionOrder: [],
      hiddenTeamSectionIds: new Set(),
      expandedLargeSectionIds: new Set(),
      unreadIds: new Set(['sup-35', 'sup-38']),
      unreadOrMentionedIds: new Set(['sup-35', 'sup-38']),
      mentionCounts: new Map([['sup-38', 2]]),
      mutedIds: new Set(),
      unreadOnly: false,
      hideMuted: false,
    });

    const support = result.teamSections[0];
    expect(support.visibleChannels).toHaveLength(8);
    expect(support.overflowCount).toBe(32);
    // Mentioned and unread items surface at the top despite older timestamps.
    expect(support.visibleChannels[0].channel.id).toBe('sup-38');
    expect(support.visibleChannels[1].channel.id).toBe('sup-35');
    // Common prefix stripped cleanly for readability.
    expect(support.visibleChannels[0].displayName).toBe('Customer 38');
  });
});

describe('dm-window (smart DM cap + People/Agents split)', () => {
  it('caps expanded DMs to top N while keeping every unread, active call, and selected DM visible', () => {
    const dms: SidebarChannel[] = [
      ...Array.from({ length: 25 }, (_, i) =>
        makeChannel({
          id: `dm-${i}`,
          name: `Person ${i}`,
          channelType: 'direct_message',
          updatedAtMs: NOW - i * HOUR,
        })
      ),
      makeChannel({
        id: 'agent-1',
        name: 'Triage Bot',
        channelType: 'direct_message',
        isAgentDm: true,
        botParticipantIds: ['bot-1'],
        updatedAtMs: NOW - 5 * MIN,
      }),
    ];

    const window = buildDmWindow({
      directMessages: dms,
      filter: 'all',
      limit: 7,
      expandedAll: false,
      unreadOrMentionedIds: new Set(['dm-22']),
      activeCallChannelIds: new Set(['dm-24']),
      mutedIds: new Set(),
      selectedChannelId: 'dm-19',
      unreadOnly: false,
      hideMuted: false,
    });

    expect(window.visible).toHaveLength(7);
    expect(window.overflowCount).toBe(19);
    expect(window.peopleCount).toBe(25);
    expect(window.agentCount).toBe(1);
    const ids = window.visible.map((c) => c.id);
    // Active call, unread, and selected older DMs are never dropped.
    expect(ids[0]).toBe('dm-24');
    expect(ids[1]).toBe('dm-22');
    expect(ids).toContain('dm-19');

    // Agents filter isolates agent DMs cleanly.
    const agentsOnly = buildDmWindow({
      directMessages: dms,
      filter: 'agents',
      limit: 7,
      expandedAll: false,
      unreadOrMentionedIds: new Set(),
      activeCallChannelIds: new Set(),
      mutedIds: new Set(),
      unreadOnly: false,
      hideMuted: false,
    });
    expect(agentsOnly.visible.map((c) => c.id)).toEqual(['agent-1']);
  });
});

describe('support-triage & Jev overrides', () => {
  it('strips support prefixes and buckets channels accurately by operational state', () => {
    expect(stripSupportDisplayName('Macro Support x Acme Corp')).toBe(
      'Acme Corp'
    );
    expect(stripSupportDisplayName('Support - Stripe')).toBe('Stripe');
    expect(
      stripCommonPrefix(
        'Macro Support x Linear',
        detectCommonSectionPrefix([
          'Macro Support x Linear',
          'Macro Support x Vercel',
          'Macro Support x Figma',
        ])
      )
    ).toBe('Linear');

    const channels: SidebarChannel[] = [
      makeChannel({
        id: 'sup-urgent',
        name: 'Macro Support x Acme Corp',
        latestMessage: {
          messageId: 'm1',
          senderId: 'ext-acme',
          content:
            'Production webhook is returning 500 errors and blocking launch',
          createdAtMs: NOW - 25 * MIN,
          mentions: [],
        },
      }),
      makeChannel({
        id: 'sup-question',
        name: 'Macro Support x Beta Labs',
        latestMessage: {
          messageId: 'm2',
          senderId: 'ext-beta',
          content: 'Could you help us enable SSO for our workspace?',
          createdAtMs: NOW - 2 * HOUR,
          mentions: [],
        },
      }),
      makeChannel({
        id: 'sup-thanks',
        name: 'Macro Support x Gamma Inc',
        latestMessage: {
          messageId: 'm3',
          senderId: 'ext-gamma',
          content: 'Thanks, that fixed it!',
          createdAtMs: NOW - 15 * MIN,
          mentions: [],
        },
      }),
      makeChannel({
        id: 'sup-agent',
        name: 'Macro Support x Delta Co',
        botParticipantIds: ['support-agent'],
        latestMessage: {
          messageId: 'm4',
          senderId: 'bot|support-agent',
          content: 'I checked your logs and suggested updating your API key.',
          createdAtMs: NOW - 30 * MIN,
          mentions: [],
        },
      }),
      makeChannel({
        id: 'sup-waiting',
        name: 'Macro Support x Epsilon LLC',
        latestMessage: {
          messageId: 'm5',
          senderId: 'teammate-1',
          content:
            'We shipped the fix — let us know if it looks good on your end.',
          createdAtMs: NOW - 3 * HOUR,
          mentions: [],
        },
      }),
    ];

    const desk = buildSupportDeskModel({
      channels,
      sections: [],
      currentUserId: 'viewer',
      teamMemberIds: new Set(['viewer', 'teammate-1']),
      unreadIds: new Set(['sup-urgent', 'sup-question', 'sup-thanks']),
      mentionCounts: new Map(),
      triageByChannelId: new Map(),
      nowMs: NOW,
    });

    expect(desk.totalCount).toBe(5);
    expect(desk.urgentCount).toBe(1);
    expect(desk.needsReplyCount).toBe(2);
    expect(desk.needsReplyGroup.map((i) => i.displayName)).toEqual([
      'Acme Corp',
      'Beta Labs',
    ]);
    // Closing "Thanks, that fixed it!" does not false-alarm as needs_reply!
    expect(desk.byState.resolved.map((i) => i.displayName)).toEqual([
      'Gamma Inc',
    ]);
    expect(desk.byState.agent_handling.map((i) => i.displayName)).toEqual([
      'Delta Co',
    ]);
    expect(desk.byState.waiting_on_customer.map((i) => i.displayName)).toEqual([
      'Epsilon LLC',
    ]);
  });

  it('honors cached Jev probabilities when they match the current messageId', () => {
    const channel = makeChannel({
      id: 'sup-subtle',
      name: 'Macro Support x Subtle Co',
      latestMessage: {
        messageId: 'm-subtle',
        senderId: 'ext-subtle',
        content: 'We are seeing weird latency right before our board demo',
        createdAtMs: NOW - 10 * MIN,
        mentions: [],
      },
    });

    const jevResult: ChannelTriageResult = interpretChannelTriageResponse({
      channelId: 'sup-subtle',
      messageId: 'm-subtle',
      probabilities: {
        needs_reply: 0.94,
        urgent: 0.88,
        resolved: 0.03,
        fyi_noise: 0.02,
      },
      nowMs: NOW,
    });

    const desk = buildSupportDeskModel({
      channels: [channel],
      sections: [],
      currentUserId: 'viewer',
      teamMemberIds: new Set(['viewer']),
      unreadIds: new Set(['sup-subtle']),
      mentionCounts: new Map(),
      triageByChannelId: new Map([['sup-subtle', jevResult]]),
      nowMs: NOW,
    });

    expect(desk.byState.urgent).toHaveLength(1);
    expect(desk.byState.urgent[0].triageSource).toBe('jev');
  });
});

describe('focus-triage & jev-triage', () => {
  it('routes mentions & DMs to direct, support waiting to support, and bot deploys to FYI', () => {
    const dm = makeChannel({
      id: 'dm-bob',
      name: 'Bob',
      channelType: 'direct_message',
      latestMessage: {
        messageId: 'm-dm',
        senderId: 'bob',
        content: 'Can you review the Q4 spec before 3pm?',
        createdAtMs: NOW - 5 * MIN,
        mentions: [],
      },
    });
    const deploys = makeChannel({
      id: 'ch-deploys',
      name: 'deploys',
      latestMessage: {
        messageId: 'm-dep',
        senderId: 'bot|ci',
        content: 'Deployment succeeded for release v2.14.0',
        createdAtMs: NOW - 3 * MIN,
        mentions: [],
      },
    });
    const muted = makeChannel({
      id: 'ch-muted',
      name: 'watercooler',
      latestMessage: {
        messageId: 'm-mut',
        senderId: 'teammate-1',
        content: 'Anyone want coffee?',
        createdAtMs: NOW - 2 * MIN,
        mentions: [],
      },
    });
    const support = makeChannel({
      id: 'sup-1',
      name: 'Macro Support x Orbit',
      latestMessage: {
        messageId: 'm-sup',
        senderId: 'ext-orbit',
        content: 'How do we invite external guests?',
        createdAtMs: NOW - 40 * MIN,
        mentions: [],
      },
    });

    const channels = [dm, deploys, muted, support];
    const teamMemberIds = new Set(['viewer', 'bob', 'teammate-1']);
    const unreadIds = new Set(['dm-bob', 'ch-deploys', 'ch-muted', 'sup-1']);

    const supportDesk = buildSupportDeskModel({
      channels,
      sections: [],
      currentUserId: 'viewer',
      teamMemberIds,
      unreadIds,
      mentionCounts: new Map(),
      triageByChannelId: new Map(),
      nowMs: NOW,
    });

    const focus = buildFocusModel({
      channels,
      supportDesk,
      currentUserId: 'viewer',
      teamMemberIds,
      unreadIds,
      unreadOrMentionedIds: unreadIds,
      mentionCounts: new Map(),
      mutedIds: new Set(['ch-muted']),
      triageByChannelId: new Map(),
      nowMs: NOW,
    });

    expect(focus.direct.map((i) => i.channel.id)).toEqual(['dm-bob']);
    expect(focus.support.map((i) => i.channel.id)).toEqual(['sup-1']);
    expect(focus.fyi.map((i) => i.channel.id)).toEqual(['ch-deploys']);
    // Muted channels stay out of Focus unless directly mentioned.
    expect(focus.unread).toHaveLength(0);
    expect(focus.actionableCount).toBe(2);
  });

  it('bounds Jev burst selection, skips viewer-sent messages and cached entries, and estimates cost accurately', () => {
    const channels = Array.from({ length: 60 }, (_, index) =>
      makeChannel({
        id: `ch-${index}`,
        name: index < 10 ? `Macro Support x Co ${index}` : `channel-${index}`,
        latestMessage: {
          messageId: `msg-${index}`,
          senderId: index === 0 ? 'viewer' : 'other',
          content: 'Hello there, checking status',
          createdAtMs: NOW - index * MIN,
          mentions: [],
        },
      })
    );

    const selected = selectChannelsForJevTriage({
      channels,
      supportChannelIds: new Set(channels.slice(0, 10).map((c) => c.id)),
      unreadOrMentionedIds: new Set(channels.map((c) => c.id)),
      currentUserId: 'viewer',
      cachedKeys: new Set([triageCacheKey('ch-1', 'msg-1')]),
      maxBurst: 25,
    });

    expect(selected).toHaveLength(25);
    expect(selected.some((c) => c.id === 'ch-0')).toBe(false);
    expect(selected.some((c) => c.id === 'ch-1')).toBe(false);
    // Support channels come first in priority order.
    expect(selected[0].id).toBe('ch-2');

    const payload = buildChannelTriageRequest({
      channel: channels[2],
      isSupport: true,
      senderRole: 'customer',
      mentionedCurrentUser: false,
      nowMs: NOW,
    });
    expect(Object.keys(payload.questions)).toHaveLength(4);

    const heuristic = heuristicChannelTriage({
      channel: channels[2],
      isSupport: true,
      senderRole: 'customer',
      mentionedCurrentUser: false,
      nowMs: NOW,
    });
    expect(heuristic.source).toBe('heuristic');
    expect(heuristic.scores.needsReply).toBeGreaterThan(0.7);

    const organizeReq = buildOrganizeSuggestionRequest(
      makeChannel({ id: 'ch-x', name: 'backend-api' }),
      []
    );
    expect(Object.keys(organizeReq.payload.questions).length).toBeGreaterThan(
      0
    );

    const fallbackOrg = heuristicOrganizeSuggestion(
      makeChannel({ id: 'ch-x', name: 'backend-api' }),
      []
    );
    expect(fallbackOrg?.target.sectionName).toBe('Engineering');

    const usage = estimateJevUsage(100);
    expect(usage.tokens).toBe(45_000);
    expect(usage.usd).toBeCloseTo(0.00189, 5);
  });
});

describe('quick-switch (joined & unread before unjoined)', () => {
  it('ranks unread and joined matches ahead of unjoined discoverable team channels', () => {
    const channels = [
      makeChannel({
        id: 'unjoined',
        name: 'design-archive',
        isParticipant: false,
      }),
      makeChannel({
        id: 'joined-read',
        name: 'design-systems',
        isParticipant: true,
      }),
      makeChannel({
        id: 'joined-unread',
        name: 'design-reviews',
        isParticipant: true,
      }),
    ];

    const results = buildQuickSwitchResults({
      query: 'design',
      channels,
      sections: [],
      unreadIds: new Set(['joined-unread']),
      unreadOrMentionedIds: new Set(['joined-unread']),
      mentionCounts: new Map(),
    });

    expect(
      results.map((item) =>
        item.kind === 'channel'
          ? `${item.group}:${item.channel.id}`
          : item.group
      )
    ).toEqual([
      'unread:joined-unread',
      'joined:joined-read',
      'discover:unjoined',
    ]);

    expect(fuzzyMatchScore('Macro Support x Acme', 'acme')).toBeGreaterThan(
      fuzzyMatchScore('Macro Support x Beta', 'acme')
    );
  });
});
