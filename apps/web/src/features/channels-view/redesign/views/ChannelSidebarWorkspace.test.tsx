import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createMemo, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type SidebarWorkspaceContextValue,
  SidebarWorkspaceProvider,
} from '../context/sidebar-workspace-context';
import { buildBrowsePlacement } from '../core/deduplicate-placement';
import { buildDmWindow } from '../core/dm-window';
import { buildFocusModel } from '../core/focus-triage';
import type { SidebarChannel, SidebarSection } from '../core/sidebar-model';
import { buildSupportDeskModel } from '../core/support-triage';
import { createJevTriageController } from '../primitives/create-jev-triage';
import { createSidebarPreferences } from '../primitives/create-sidebar-preferences';
import { ChannelSidebarWorkspace } from './ChannelSidebarWorkspace';

const NOW = Date.parse('2026-11-25T16:00:00Z');
const MIN = 60_000;

function makeChannel(
  overrides: Partial<SidebarChannel> & Pick<SidebarChannel, 'id' | 'name'>
): SidebarChannel {
  return {
    channelType: 'team',
    teamId: 'team-1',
    isParticipant: true,
    updatedAtMs: NOW - 10 * MIN,
    viewedAtMs: NOW - 30 * MIN,
    createdAtMs: NOW - 1000 * MIN,
    frecencyScore: 1,
    participantIds: ['alice', 'bob'],
    botParticipantIds: [],
    isAgentDm: false,
    ...overrides,
  };
}

function createFixtureWorkspace() {
  const openChannel = vi.fn();
  const markChannelsRead = vi.fn<(ids: readonly string[]) => Promise<void>>(
    async () => {}
  );
  const joinChannel = vi.fn<(id: string) => Promise<void>>(async () => {});

  const dms: SidebarChannel[] = Array.from({ length: 14 }, (_, i) =>
    makeChannel({
      id: `dm-${i}`,
      name: i === 0 ? 'Bob Rivera' : i === 1 ? 'Release Bot' : `Person ${i}`,
      channelType: 'direct_message',
      isAgentDm: i === 1,
      updatedAtMs: NOW - (i + 1) * MIN,
      latestMessage: {
        messageId: `m-dm-${i}`,
        senderId: i === 1 ? 'bot|rel' : `user-${i}`,
        content: i === 0 ? 'Can you review the PR?' : 'Hey there!',
        createdAtMs: NOW - (i + 1) * MIN,
        mentions: [],
      },
    })
  );

  const channels: SidebarChannel[] = [
    ...dms,
    makeChannel({
      id: 'eng-incidents',
      name: 'eng-incidents',
      latestMessage: {
        messageId: 'm-inc',
        senderId: 'bob',
        content: 'URGENT: webhook 500s spiking',
        createdAtMs: NOW - 5 * MIN,
        mentions: ['alice'],
      },
    }),
    makeChannel({
      id: 'eng-frontend',
      name: 'eng-frontend',
    }),
    makeChannel({
      id: 'launch-q4',
      name: 'launch-q4',
    }),
    makeChannel({
      id: 'deploys',
      name: 'deploys',
      latestMessage: {
        messageId: 'm-dep',
        senderId: 'bot|ci',
        content: 'Automated deployment succeeded for v2.18.5',
        createdAtMs: NOW - 2 * MIN,
        mentions: [],
      },
    }),
    makeChannel({
      id: 'general',
      name: 'general',
    }),
    makeChannel({
      id: 'unjoined-team',
      name: 'design-systems',
      isParticipant: false,
    }),
    makeChannel({
      id: 'sup-orbit',
      name: 'Macro Support x Orbit Cloud',
      channelType: 'private',
      teamId: undefined,
      latestMessage: {
        messageId: 'm-sup-1',
        senderId: 'ext-orbit',
        content: 'Production SSO is broken and blocking launch!',
        createdAtMs: NOW - 15 * MIN,
        mentions: [],
      },
    }),
    makeChannel({
      id: 'sup-canopy',
      name: 'Macro Support x Canopy Climate',
      channelType: 'private',
      teamId: undefined,
      latestMessage: {
        messageId: 'm-sup-2',
        senderId: 'ext-canopy',
        content: 'Thanks, that fixed it!',
        createdAtMs: NOW - 40 * MIN,
        mentions: [],
      },
    }),
  ];

  const sections: SidebarSection[] = [
    {
      id: 'sec-personal-focus',
      name: 'My Focus',
      scope: 'personal',
      channelIds: ['launch-q4'],
      sortOrder: 0,
    },
    {
      id: 'sec-support',
      name: 'Customer Support',
      scope: 'personal',
      ruleContains: 'Macro Support x',
      channelIds: ['sup-orbit', 'sup-canopy'],
      sortOrder: 1,
    },
    {
      id: 'sec-eng',
      name: 'Engineering',
      scope: 'team',
      teamId: 'team-1',
      channelIds: ['eng-incidents', 'eng-frontend', 'launch-q4'],
      sortOrder: 0,
    },
    {
      id: 'sec-ops',
      name: 'Alerts & Ops',
      scope: 'team',
      teamId: 'team-1',
      channelIds: ['deploys'],
      sortOrder: 1,
    },
  ];

  const storageMap = new Map<string, string>();
  const storage = {
    read: (uid: string) => storageMap.get(uid) ?? null,
    write: (uid: string, value: string) => {
      storageMap.set(uid, value);
    },
  };

  const prefs = createSidebarPreferences({ userId: () => 'alice', storage });
  const [dmQuery, setDmQuery] = createSignal('');
  const [openGroups, setOpenGroups] = createSignal({
    favorites: true,
    direct_messages: true,
    channels: true,
  });
  const [collapsedSections, setCollapsedSections] = createSignal<string[]>([]);
  const [unreadSet, setUnreadSet] = createSignal(
    new Set(['dm-0', 'eng-incidents', 'sup-orbit', 'deploys'])
  );
  const mentionMap = new Map([['eng-incidents', 2]]);
  const mutedSet = new Set<string>();
  const teamMemberIds = new Set(['alice', 'bob']);

  const triage = createJevTriageController({
    accountKey: () => 'alice:1',
    userId: () => 'alice',
    enabled: () => false,
    channels: () => channels,
    supportChannelIds: () => new Set(['sup-orbit', 'sup-canopy']),
    unreadOrMentionedIds: () => unreadSet(),
    mentionCounts: () => mentionMap,
    teamMemberIds: () => teamMemberIds,
    decide: async () => ({ ok: false, unavailable: true }),
    storage,
    debounceMs: 0,
    now: () => NOW,
  });

  const supportDesk = createMemo(() =>
    buildSupportDeskModel({
      channels,
      sections,
      currentUserId: 'alice',
      teamMemberIds,
      unreadIds: unreadSet(),
      mentionCounts: mentionMap,
      triageByChannelId: triage.triageByChannelId(),
      nowMs: NOW,
    })
  );

  const focusModel = createMemo(() =>
    buildFocusModel({
      channels,
      supportDesk: supportDesk(),
      currentUserId: 'alice',
      teamMemberIds,
      unreadIds: unreadSet(),
      unreadOrMentionedIds: unreadSet(),
      mentionCounts: mentionMap,
      mutedIds: mutedSet,
      triageByChannelId: triage.triageByChannelId(),
      nowMs: NOW,
    })
  );

  const placement = createMemo(() =>
    buildBrowsePlacement({
      channels,
      sections,
      sectionOrder: [],
      hiddenTeamSectionIds: new Set(prefs.prefs.hiddenTeamSectionIds),
      expandedLargeSectionIds: new Set(prefs.prefs.expandedLargeSectionIds),
      unreadIds: unreadSet(),
      unreadOrMentionedIds: unreadSet(),
      mentionCounts: mentionMap,
      mutedIds: mutedSet,
      unreadOnly: prefs.prefs.unreadOnly,
      hideMuted: prefs.prefs.hideMuted,
    })
  );

  const dmWindow = createMemo(() =>
    buildDmWindow({
      directMessages: dms,
      filter: prefs.prefs.dmFilter,
      limit: prefs.prefs.dmWindowLimit,
      expandedAll: prefs.prefs.dmExpandedAll,
      unreadOrMentionedIds: unreadSet(),
      activeCallChannelIds: new Set(),
      mutedIds: mutedSet,
      unreadOnly: prefs.prefs.unreadOnly,
      hideMuted: prefs.prefs.hideMuted,
      query: dmQuery(),
    })
  );

  const byId = new Map(channels.map((c) => [c.id, c]));

  const value: SidebarWorkspaceContextValue = {
    railId: 'test-rail',
    channels: () => channels,
    channelById: (id) => byId.get(id),
    channelEntityById: () => undefined,
    sections: () => sections,
    rawLabelById: () => undefined,
    favoriteChannelIds: () => ['general'],
    selectedChannelId: () => undefined,
    teamName: () => 'Acme',
    teamId: () => 'team-1',
    teamMemberIds: () => teamMemberIds,
    currentUserId: () => 'alice',
    unreadIds: unreadSet,
    unreadOrMentionedIds: unreadSet,
    mentionCounts: () => mentionMap,
    mutedIds: () => mutedSet,
    activeCallChannelIds: () => new Set(),
    incomingCallByChannelId: () => new Map(),
    isLoading: () => false,
    error: () => undefined,
    retry: () => {},
    threadsEnabled: () => true,
    canShareSections: () => true,
    labelsAvailable: () => true,
    labelsFailed: () => false,
    labelsUnavailableReason: () => '',
    retryLabels: () => {},
    prefs,
    triage,
    placement,
    dmWindow,
    dmQuery,
    setDmQuery,
    supportDesk,
    focusModel,
    totalUnreadCount: () => unreadSet().size,
    isGroupOpen: (group) => openGroups()[group],
    setGroupOpen: (group, open) =>
      setOpenGroups((prev) => ({ ...prev, [group]: open })),
    isSectionOpen: (id) => !collapsedSections().includes(id),
    setSectionOpen: (id, open) =>
      setCollapsedSections((prev) =>
        open ? prev.filter((item) => item !== id) : [...prev, id]
      ),
    sectionSort: () => undefined,
    setSectionSort: () => {},
    sectionOrder: () => [],
    setSectionOrder: () => {},
    openChannel,
    prefetchChannel: () => {},
    joinChannel,
    markChannelsRead: async (ids) => {
      await markChannelsRead(ids);
      setUnreadSet((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
    },
    toggleMuteChannel: async () => {},
    toggleFavoriteChannel: async () => {},
    reorderFavorites: async () => {},
    assignChannelToSection: async () => {},
    createSection: async () => undefined,
    editSection: async () => {},
    addChannelsToSection: async () => {},
    deleteSection: async () => {},
    markSectionRead: async () => {},
    muteSection: async () => {},
    openCreateChannel: () => {},
    openCreateDm: () => {},
    activeTab: () => 'browse',
    openThreads: () => {},
    exitThreads: () => {},
    threadsChannelId: () => undefined,
    setThreadsChannelId: () => {},
    renderChannelIcon: () => <span aria-hidden="true">#</span>,
  };

  return { value, openChannel, markChannelsRead, joinChannel };
}

describe('ChannelSidebarWorkspace', () => {
  afterEach(() => cleanup());

  it('eliminates section duplication and bounds the DM smart window with People/Agents filtering', () => {
    const { container } = render(() => {
      const { value } = createFixtureWorkspace();
      return (
        <SidebarWorkspaceProvider value={value}>
          <ChannelSidebarWorkspace />
        </SidebarWorkspaceProvider>
      );
    });

    // launch-q4 is in both Personal "My Focus" and Team "Engineering" -> must render ONCE!
    const launchRows = container.querySelectorAll(
      '[data-channel-id="launch-q4"]'
    );
    expect(launchRows.length).toBe(1);

    // DMs are bounded to 7 visible rows (out of 14 total) with a "Show 7 more DMs" toggle.
    const dmSection = container.querySelector('[data-dm-section]')!;
    expect(dmSection.querySelectorAll('[data-sidebar-row]').length).toBe(7);
    expect(screen.getByText('Show 7 more DMs')).toBeTruthy();

    // Switching DM filter to Agents shows only Release Bot.
    fireEvent.click(dmSection.querySelector('[data-dm-filter="agents"]')!);
    expect(dmSection.querySelectorAll('[data-sidebar-row]').length).toBe(1);
    expect(dmSection.textContent).toContain('Release Bot');

    // Expanding all DMs shows every DM when toggled back to All.
    fireEvent.click(dmSection.querySelector('[data-dm-filter="all"]')!);
    fireEvent.click(dmSection.querySelector('[data-dm-show-more]')!);
    expect(dmSection.querySelectorAll('[data-sidebar-row]').length).toBe(14);
  });

  it('switches to Support Desk and Focus lenses with operational buckets and Mark all read', async () => {
    let markReadMock!: ReturnType<typeof vi.fn>;
    const { container } = render(() => {
      const { value, markChannelsRead } = createFixtureWorkspace();
      markReadMock = markChannelsRead;
      return (
        <SidebarWorkspaceProvider value={value}>
          <ChannelSidebarWorkspace />
        </SidebarWorkspaceProvider>
      );
    });

    // Switch to Support Desk lens
    fireEvent.click(container.querySelector('[data-lens-tab="support"]')!);
    const supportPanel = container.querySelector(
      '[data-sidebar-lens-panel="support"]'
    )!;
    // Stripped customer name Orbit Cloud appears under Needs reply
    expect(supportPanel.textContent).toContain('Orbit Cloud');
    expect(supportPanel.textContent).toContain('Urgent');
    // Canopy Climate ("Thanks, that fixed it!") is in collapsed Resolved bucket (not alarming Needs reply)
    expect(
      supportPanel.querySelector('[data-support-bucket="needs_reply"]')
        ?.textContent
    ).not.toContain('Canopy Climate');

    // Switch to Focus lens and sweep read
    fireEvent.click(container.querySelector('[data-lens-tab="focus"]')!);
    const focusPanel = container.querySelector(
      '[data-sidebar-lens-panel="focus"]'
    )!;
    expect(focusPanel.textContent).toContain('Direct & @mentions');
    expect(focusPanel.textContent).toContain('eng-incidents');
    // Automated deploys message sits inside collapsed Automated & FYI bucket
    expect(focusPanel.textContent).toContain('Automated & FYI');

    fireEvent.click(screen.getByText('Mark all read'));
    expect(markReadMock).toHaveBeenCalledTimes(1);
  });

  it('supports personal hiding & restoring of team sections without deleting them', () => {
    let hideSection!: (id: string) => void;
    const { container } = render(() => {
      const { value } = createFixtureWorkspace();
      hideSection = value.prefs.hideTeamSection;
      return (
        <SidebarWorkspaceProvider value={value}>
          <ChannelSidebarWorkspace />
        </SidebarWorkspaceProvider>
      );
    });

    // Hide Alerts & Ops personally
    hideSection('sec-ops');
    expect(
      container.querySelector('[data-placed-section="sec-ops"]')
    ).toBeNull();
    const hiddenBar = container.querySelector('[data-hidden-sections-bar]')!;
    expect(hiddenBar.textContent).toContain('1 hidden team section');

    // Restore all brings it back immediately
    fireEvent.click(screen.getByText('Restore all'));
    expect(
      container.querySelector('[data-placed-section="sec-ops"]')
    ).not.toBeNull();
  });
});
