import type { ChannelEntity } from '@entity';
import type { DirectoryChannel } from '@queries/channel/directory-core';
import { createComputed, createRoot, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { describe, expect, it, vi } from 'vitest';
import {
  createJevTriageController,
  type JevDecidePort,
} from '../primitives/create-jev-triage';
import { toSidebarChannel } from '../queries/adapt-channel';
import { buildBrowsePlacement } from './deduplicate-placement';
import {
  JEV_MAX_BURST_CHANNELS,
  JEV_MAX_SESSION_CALLS,
  selectChannelsForJevTriage,
} from './jev-triage';
import type { SidebarChannel, SidebarSection } from './sidebar-model';
import {
  collectWindowedReferencedChannelIds,
  DEFAULT_CHANNEL_RESOLUTION_WINDOW,
  searchDirectoryTopK,
} from './windowed-resolution';

const NOW = Date.parse('2026-11-26T16:00:00Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function buildSyntheticWorkspace(totalChannels: number) {
  const supportCount = Math.floor(totalChannels * 0.4);
  const dmCount = Math.floor(totalChannels * 0.15);

  const channels: SidebarChannel[] = [];
  const supportIds: string[] = [];
  const engIds: string[] = [];
  const salesIds: string[] = [];

  for (let i = 0; i < totalChannels; i += 1) {
    const id = `ch-${i}`;
    const isSupport = i < supportCount;
    const isDm = !isSupport && i < supportCount + dmCount;
    const isStale = i % 2 === 1;
    const updatedAtMs = isStale
      ? NOW - (14 + (i % 30)) * DAY
      : NOW - (i % 48) * HOUR;

    channels.push({
      id,
      name: isSupport
        ? `Macro Support x Customer ${i}`
        : isDm
          ? `Teammate ${i}`
          : `team-channel-${i}`,
      channelType: isDm ? 'direct_message' : 'team',
      teamId: isDm ? undefined : 'team-1',
      isParticipant: true,
      updatedAtMs,
      viewedAtMs: updatedAtMs - HOUR,
      createdAtMs: NOW - 180 * DAY,
      frecencyScore: i < 50 ? 100 - i : 0,
      participantIds: ['viewer', `user-${i % 200}`, `ext-${i}`],
      botParticipantIds: [],
      isAgentDm: false,
      latestMessage: {
        messageId: `msg-${i}`,
        senderId: isSupport ? `ext-${i}` : `user-${i % 200}`,
        content: isSupport
          ? 'Checking on our SSO configuration status'
          : 'Routine team update',
        createdAtMs: updatedAtMs,
        mentions: [],
      },
    });

    if (isSupport) supportIds.push(id);
    else if (!isDm && i % 2 === 0) engIds.push(id);
    else if (!isDm) salesIds.push(id);
  }

  const sections: SidebarSection[] = [
    {
      id: 'sec-support',
      name: 'Customer Support',
      scope: 'personal',
      ruleContains: 'Macro Support x',
      channelIds: supportIds,
      sortOrder: 0,
    },
    {
      id: 'sec-eng',
      name: 'Engineering',
      scope: 'team',
      teamId: 'team-1',
      channelIds: engIds,
      sortOrder: 0,
    },
    {
      id: 'sec-sales',
      name: 'Sales & GTM',
      scope: 'team',
      teamId: 'team-1',
      channelIds: salesIds,
      sortOrder: 1,
    },
  ];

  const unreadIds = new Set<string>(
    channels.slice(0, 60).map((channel) => channel.id)
  );
  const favoriteIds = ['ch-0', 'ch-1', 'ch-2', 'ch-3'];

  return { channels, sections, supportIds, unreadIds, favoriteIds };
}

describe('sidebar scaling & bounded resolution (N=3,500 vs 2N=7,000)', () => {
  it('resolves 0 collapsed section IDs and stays strictly O(1) as workspace doubles from 3,500 to 7,000 channels', () => {
    const small = buildSyntheticWorkspace(3_500);
    const large = buildSyntheticWorkspace(7_000);

    // 1. All sections collapsed, Pinned collapsed: 0 IDs resolved at both N and 2N.
    const collapsedSmall = collectWindowedReferencedChannelIds({
      sections: small.sections,
      favoriteChannelIds: small.favoriteIds,
      loadedIds: new Set(),
      unreadIds: small.unreadIds,
      activeLens: 'browse',
      favoritesOpen: false,
      openSectionIds: new Set(),
      hiddenTeamSectionIds: new Set(),
      window: DEFAULT_CHANNEL_RESOLUTION_WINDOW,
    });
    const collapsedLarge = collectWindowedReferencedChannelIds({
      sections: large.sections,
      favoriteChannelIds: large.favoriteIds,
      loadedIds: new Set(),
      unreadIds: large.unreadIds,
      activeLens: 'browse',
      favoritesOpen: false,
      openSectionIds: new Set(),
      hiddenTeamSectionIds: new Set(),
      window: DEFAULT_CHANNEL_RESOLUTION_WINDOW,
    });

    expect(collapsedSmall).toHaveLength(0);
    expect(collapsedLarge).toHaveLength(0);

    // 2. Two massive sections expanded (thousands of members each): strictly capped to window!
    const openTwoSmall = collectWindowedReferencedChannelIds({
      sections: small.sections,
      favoriteChannelIds: small.favoriteIds,
      loadedIds: new Set(['ch-0', 'ch-1']),
      unreadIds: small.unreadIds,
      activeLens: 'browse',
      favoritesOpen: true,
      openSectionIds: new Set(['sec-support', 'sec-eng']),
      hiddenTeamSectionIds: new Set(['sec-sales']),
      window: DEFAULT_CHANNEL_RESOLUTION_WINDOW,
    });
    const openTwoLarge = collectWindowedReferencedChannelIds({
      sections: large.sections,
      favoriteChannelIds: large.favoriteIds,
      loadedIds: new Set(['ch-0', 'ch-1']),
      unreadIds: large.unreadIds,
      activeLens: 'browse',
      favoritesOpen: true,
      openSectionIds: new Set(['sec-support', 'sec-eng']),
      hiddenTeamSectionIds: new Set(['sec-sales']),
      window: DEFAULT_CHANNEL_RESOLUTION_WINDOW,
    });

    expect(openTwoSmall.length).toBeLessThanOrEqual(
      DEFAULT_CHANNEL_RESOLUTION_WINDOW.maxPerSection * 2 +
        small.favoriteIds.length
    );
    // Doubling from 3,500 to 7,000 must produce zero growth in resolved IDs.
    expect(openTwoLarge.length).toBe(openTwoSmall.length);

    // 3. Support lens open on 1,400 vs 2,800 support channels: bounded to maxSupportWindow (50).
    const supportSmall = collectWindowedReferencedChannelIds({
      sections: small.sections,
      favoriteChannelIds: small.favoriteIds,
      loadedIds: new Set(),
      unreadIds: small.unreadIds,
      activeLens: 'support',
      favoritesOpen: true,
      openSectionIds: new Set(),
      hiddenTeamSectionIds: new Set(),
      window: DEFAULT_CHANNEL_RESOLUTION_WINDOW,
    });
    const supportLarge = collectWindowedReferencedChannelIds({
      sections: large.sections,
      favoriteChannelIds: large.favoriteIds,
      loadedIds: new Set(),
      unreadIds: large.unreadIds,
      activeLens: 'support',
      favoritesOpen: true,
      openSectionIds: new Set(),
      hiddenTeamSectionIds: new Set(),
      window: DEFAULT_CHANNEL_RESOLUTION_WINDOW,
    });

    expect(supportSmall).toHaveLength(
      DEFAULT_CHANNEL_RESOLUTION_WINDOW.maxSupportWindow
    );
    expect(supportLarge).toHaveLength(
      DEFAULT_CHANNEL_RESOLUTION_WINDOW.maxSupportWindow
    );

    // 4. Focus lens resolves 0 section IDs via by-ID lookup.
    const focusLarge = collectWindowedReferencedChannelIds({
      sections: large.sections,
      favoriteChannelIds: large.favoriteIds,
      loadedIds: new Set(),
      unreadIds: large.unreadIds,
      activeLens: 'focus',
      favoritesOpen: true,
      openSectionIds: new Set(['sec-support', 'sec-eng']),
      hiddenTeamSectionIds: new Set(),
      window: DEFAULT_CHANNEL_RESOLUTION_WINDOW,
    });
    expect(focusLarge).toHaveLength(0);
  });

  it('computes accurate unread and overflow counts for collapsed/windowed sections without loading all members', () => {
    const large = buildSyntheticWorkspace(7_000);
    // Only 16 channels loaded out of 7,000!
    const loadedWindow = large.channels.slice(0, 16);

    const placement = buildBrowsePlacement({
      channels: loadedWindow,
      sections: large.sections,
      sectionOrder: [],
      hiddenTeamSectionIds: new Set(),
      expandedLargeSectionIds: new Set(),
      unreadIds: large.unreadIds,
      unreadOrMentionedIds: large.unreadIds,
      mentionCounts: new Map([['ch-55', 2]]),
      mutedIds: new Set(),
      unreadOnly: false,
      hideMuted: false,
    });

    const support = placement.personalSections[0];
    // Counts reflect all 60 unread IDs and all 2,800 member IDs even though only 16 rows loaded.
    expect(support.unreadCount).toBe(60);
    expect(support.mentionCount).toBe(2);
    expect(support.totalMemberCount).toBe(2_800);
    expect(support.unresolvedCount).toBe(2_800 - 16);
    expect(support.overflowCount).toBe(2_800 - support.visibleChannels.length);
  });

  it('unwraps Solid store proxies in toSidebarChannel so nested participant arrays do not attach reactive subscriptions', () => {
    let effectRuns = 0;

    createRoot((dispose) => {
      const [entityStore, setEntityStore] = createStore<ChannelEntity>({
        id: 'ch-proxy',
        type: 'channel',
        name: 'eng-cache',
        ownerId: 'viewer',
        channelType: 'team',
        teamId: 'team-1',
        isParticipant: true,
        participantIds: ['viewer', 'user-1', 'bot|helper'],
      });

      const [adapted, setAdapted] = createSignal<SidebarChannel>();
      createComputed(() => {
        effectRuns += 1;
        setAdapted(toSidebarChannel(entityStore));
      });

      expect(effectRuns).toBe(1);
      expect(adapted()?.participantIds).toEqual(['viewer', 'user-1']);
      expect(adapted()?.botParticipantIds).toEqual(['helper']);

      // Mutating a nested array element inside the store must NOT retrigger the
      // effect because `toSidebarChannel` unwrapped the proxy before walking it.
      setEntityStore('participantIds', 1, 'user-2');
      expect(effectRuns).toBe(1);

      dispose();
    });
  });

  it('gates Jev triage to active surfaces, skips stale >7d read support channels, and caps session calls', async () => {
    const large = buildSyntheticWorkspace(7_000);
    const supportIdSet = new Set(large.supportIds);

    // Stale (>7d) read support channels are never selected for Jev.
    const staleOnly = large.channels.filter(
      (ch) => supportIdSet.has(ch.id) && !large.unreadIds.has(ch.id)
    );
    const staleSelected = selectChannelsForJevTriage({
      channels: staleOnly,
      supportChannelIds: supportIdSet,
      unreadOrMentionedIds: new Set(),
      currentUserId: 'viewer',
      cachedKeys: new Set(),
      maxBurst: 50,
      nowMs: NOW,
    });
    for (const ch of staleSelected) {
      expect(NOW - ch.updatedAtMs).toBeLessThanOrEqual(7 * DAY);
    }

    // Active gate: 0 calls while Browse is active; <= JEV_MAX_BURST_CHANNELS when Support activates.
    const decide = vi.fn<JevDecidePort>(async () => ({
      ok: true,
      probabilities: {
        needs_reply: 0.9,
        urgent: 0.2,
        resolved: 0.05,
        fyi_noise: 0.01,
      },
    }));
    const storage = {
      map: new Map<string, string>(),
      read(u: string) {
        return this.map.get(u) ?? null;
      },
      write(u: string, v: string) {
        this.map.set(u, v);
      },
    };

    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        const [active, setActive] = createSignal(false);
        const [slice, setSlice] = createSignal(large.channels.slice(0, 100));
        const ctrl = createJevTriageController({
          accountKey: () => 'alice:scale',
          userId: () => 'viewer',
          enabled: () => true,
          active,
          channels: slice,
          supportChannelIds: () => supportIdSet,
          unreadOrMentionedIds: () => large.unreadIds,
          mentionCounts: () => new Map(),
          teamMemberIds: () => new Set(['viewer']),
          decide,
          storage,
          debounceMs: 0,
          maxSessionCalls: 20,
          now: () => NOW,
        });

        setTimeout(() => {
          try {
            // Browse mode: 0 Jev calls!
            expect(decide).toHaveBeenCalledTimes(0);

            // Switch to Support lens: first wave strictly bounded to JEV_MAX_BURST_CHANNELS (15).
            setActive(true);
            setTimeout(() => {
              try {
                expect(decide).toHaveBeenCalledTimes(JEV_MAX_BURST_CHANNELS);
                expect(ctrl.stats().jevCallsThisSession).toBe(
                  JEV_MAX_BURST_CHANNELS
                );

                // Even if another wave of live channels arrives, total calls stop at maxSessionCalls (20).
                setSlice(large.channels.slice(20, 120));
                setTimeout(() => {
                  try {
                    expect(decide.mock.calls.length).toBeLessThanOrEqual(20);
                    expect(JEV_MAX_SESSION_CALLS).toBe(50);
                    dispose();
                    resolve();
                  } catch (err) {
                    dispose();
                    reject(err);
                  }
                }, 30);
              } catch (err) {
                dispose();
                reject(err);
              }
            }, 30);
          } catch (err) {
            dispose();
            reject(err);
          }
        }, 20);
      });
    });
  });

  it('searches 7,000 plain DirectoryChannel records in top-K without full conversion', () => {
    const records: DirectoryChannel[] = Array.from(
      { length: 7_000 },
      (_, i) => ({
        id: `dir-${i}`,
        name: i === 6_543 ? 'Macro Support x Hyperion' : `channel-${i}`,
        channelType: 'team',
        ownerId: 'viewer',
        organizationId: null,
        teamId: 'team-1',
        autoJoinTeam: false,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-11-26T00:00:00Z',
        viewedAt: null,
        interactedAt: null,
        isParticipant: true,
        frecencyScore: i === 6_543 ? 10 : 0,
        participants: [],
        botParticipants: [],
        agentDm: null,
        latestMessage: null,
        latestNonThreadMessage: null,
      })
    );

    const hits = searchDirectoryTopK(records, 'hyperion', 50);
    expect(hits).toHaveLength(1);
    expect(hits[0].id).toBe('dir-6543');

    const emptyQueryHits = searchDirectoryTopK(records, '', 25);
    expect(emptyQueryHits).toHaveLength(25);
  });
});
