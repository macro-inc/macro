import '@fontsource-variable/inter';
import '../../../../index.css';
import HashIcon from '@icon/system/regular/hash.svg';
import LockIcon from '@icon/system/regular/lock-simple.svg';
import RobotIcon from '@icon/system/regular/robot.svg';
import UserIcon from '@icon/system/regular/user.svg';
import { DragDropProvider, DragDropSensors } from '@thisbeyond/solid-dnd';
import { createMemo, createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { macroDarkTheme } from '../../../theme/themes/macro-dark';
import { macroLightTheme } from '../../../theme/themes/macro-light';
import {
  type SidebarWorkspaceContextValue,
  SidebarWorkspaceProvider,
} from '../context/sidebar-workspace-context';
import { buildBrowsePlacement } from '../core/deduplicate-placement';
import { buildDmWindow } from '../core/dm-window';
import { buildFocusModel } from '../core/focus-triage';
import type { SidebarChannel, SidebarSection } from '../core/sidebar-model';
import { buildSupportDeskModel } from '../core/support-triage';
import {
  createJevTriageController,
  type JevDecidePort,
} from '../primitives/create-jev-triage';
import { createSidebarPreferences } from '../primitives/create-sidebar-preferences';
import { ChannelSidebarWorkspace } from '../views/ChannelSidebarWorkspace';
import { ChannelSidebarMobileView } from '../views/mobile/ChannelSidebarMobileView';

const params = new URLSearchParams(location.search);
const isDark = params.get('theme') === 'dark';
const surface = params.get('surface') ?? 'desktop';
const mode = params.get('mode') ?? 'large';
const jevLive = params.get('jev') === 'live';

const theme = isDark ? macroDarkTheme : macroLightTheme;
for (const [token, value] of Object.entries(theme.colorTokens)) {
  document.documentElement.style.setProperty(`--color-${token}`, value);
}
if (isDark) {
  document.documentElement.dataset.themeDark = 'true';
} else {
  document.documentElement.dataset.themeLight = 'true';
}

const NOW = Date.parse('2026-11-25T16:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;

function buildLargeFixtureData(): {
  channels: SidebarChannel[];
  sections: SidebarSection[];
  favorites: string[];
  unread: Set<string>;
  mentions: Map<string, number>;
  muted: Set<string>;
} {
  if (mode === 'empty' || mode === 'loading') {
    return {
      channels: [],
      sections: [],
      favorites: [],
      unread: new Set(),
      mentions: new Map(),
      muted: new Set(),
    };
  }

  const channels: SidebarChannel[] = [];
  const unread = new Set<string>();
  const mentions = new Map<string, number>();
  const muted = new Set<string>();

  // 1. 35 Direct Messages (29 people + 6 AI agent DMs)
  const agentNames = [
    'Release Bot',
    'Support Triage Agent',
    'CI Watcher Agent',
    'Linear Sync Bot',
    'Oncall Assistant',
    'Metrics Digest Agent',
  ];
  for (let i = 0; i < 35; i++) {
    const isAgent = i < 6;
    const id = `dm-${i}`;
    channels.push({
      id,
      name: isAgent ? (agentNames[i] ?? `Agent ${i}`) : `Teammate ${i - 5}`,
      channelType: 'direct_message',
      isParticipant: true,
      isAgentDm: isAgent,
      updatedAtMs: NOW - (i + 1) * 4 * MIN,
      viewedAtMs: NOW - 2 * HOUR,
      createdAtMs: NOW - 40 * HOUR,
      frecencyScore: Math.max(0.2, 5 - i * 0.1),
      participantIds: ['alice', `user-${i}`],
      botParticipantIds: isAgent ? [`bot|agent-${i}`] : [],
      latestMessage: {
        messageId: `m-dm-${i}`,
        senderId: isAgent ? `bot|agent-${i}` : `user-${i}`,
        content:
          i === 6
            ? 'Can you review the channel sidebar rollout plan before 4pm?'
            : isAgent
              ? 'Automated build completed with 0 regressions.'
              : `Catching up on thread #${i}`,
        createdAtMs: NOW - (i + 1) * 4 * MIN,
        mentions: i === 6 ? ['alice'] : [],
      },
    });
    if (i === 6 || i === 7) unread.add(id);
    if (i === 6) mentions.set(id, 1);
  }

  // 2. 35 Support Channels ("Macro Support x <Customer>") across all 5 states
  const customers = [
    'Orbit Cloud',
    'Northstar Bio',
    'Kestrel AI',
    'Beacon FinTech',
    'Quartz Robotics',
    'Stratos Data',
    'Harbor Health',
    'Summit Logistics',
    'Loomis Labs',
    'Vanguard Media',
    'Timber Retail',
    'Solstice Energy',
    'Redwood Capital',
    'Canopy Climate',
    'Cobalt Freight',
    'Aurora Payments',
    'Vertex Security',
    'Mosaic Analytics',
    'Pinnacle Health',
    'Atlas Robotics',
    'Nimbus Storage',
    'Keystone Legal',
    'Cascade Bio',
    'Meridian Grid',
    'Helios Solar',
    'Signal Transit',
    'Cobalt Studio',
    'Driftwood Labs',
    'Ember Commerce',
    'Foundry Systems',
    'Glacier Data',
    'Horizon Fleet',
    'Ion Medical',
    'Juniper Retail',
    'Kiteworks AI',
  ];

  const supportIds: string[] = [];
  customers.forEach((customer, idx) => {
    const id = `sup-${idx}`;
    supportIds.push(id);

    let senderId = `ext-${idx}`;
    let content = `Quick question on workspace permissions for ${customer}?`;
    let ageMs = (idx + 2) * 15 * MIN;
    if (idx < 4) {
      content = `URGENT: Production SSO is broken and blocking launch for ${customer}!`;
      ageMs = (idx + 1) * 12 * MIN;
      unread.add(id);
    } else if (idx < 14) {
      content = `Could you help us configure webhook retries for ${customer}?`;
      if (idx < 10) unread.add(id);
    } else if (idx < 20) {
      senderId = 'bot|support-agent';
      content =
        'Drafted a workaround for SSO redirect URLs; waiting on confirmation.';
    } else if (idx < 26) {
      senderId = 'bob';
      content =
        'Pushed the fix to your tenant — let us know if that looks good!';
    } else {
      senderId = `ext-${idx}`;
      content = 'Thanks, that fixed it! All set on our end.';
      ageMs = 4 * HOUR + idx * 10 * MIN;
    }

    channels.push({
      id,
      name: `Macro Support x ${customer}`,
      channelType: 'private',
      isParticipant: true,
      isAgentDm: false,
      updatedAtMs: NOW - ageMs,
      viewedAtMs: NOW - ageMs - 10 * MIN,
      createdAtMs: NOW - 100 * HOUR,
      frecencyScore: idx < 10 ? 3 : 1,
      participantIds: ['alice', 'bob', `ext-${idx}`],
      botParticipantIds: ['bot|support-agent'],
      latestMessage: {
        messageId: `m-sup-${idx}`,
        senderId,
        content,
        createdAtMs: NOW - ageMs,
        mentions: idx === 0 ? ['alice'] : [],
      },
    });
    if (idx === 0) mentions.set(id, 1);
  });

  // 3. 50 Team & Project Channels (including long names, muted, unjoined, ungrouped)
  const namedTeamChannels: Array<{
    id: string;
    name: string;
    section?: string;
    isParticipant?: boolean;
    unread?: boolean;
    mentions?: number;
    muted?: boolean;
    fyi?: boolean;
  }> = [
    {
      id: 'eng-incidents',
      name: 'eng-incidents',
      section: 'sec-eng',
      unread: true,
      mentions: 2,
    },
    {
      id: 'eng-frontend',
      name: 'eng-frontend',
      section: 'sec-eng',
      unread: true,
    },
    { id: 'eng-platform', name: 'eng-platform', section: 'sec-eng' },
    { id: 'eng-mobile', name: 'eng-mobile', section: 'sec-eng' },
    { id: 'eng-cache', name: 'eng-cache', section: 'sec-eng' },
    { id: 'launch-q4', name: 'launch-q4', section: 'sec-eng', unread: true },
    { id: 'product-roadmap', name: 'product-roadmap', section: 'sec-prod' },
    { id: 'design-crit', name: 'design-crit', section: 'sec-prod' },
    {
      id: 'long-channel',
      name: 'very-long-cross-functional-quarterly-planning-and-architecture-review',
      section: 'sec-prod',
    },
    {
      id: 'deploys',
      name: 'deploys',
      section: 'sec-ops',
      unread: true,
      muted: true,
      fyi: true,
    },
    {
      id: 'alerts-prod',
      name: 'alerts-prod',
      section: 'sec-ops',
      unread: true,
      muted: true,
      fyi: true,
    },
    { id: 'infra-cost', name: 'infra-cost', section: 'sec-ops', muted: true },
    { id: 'general', name: 'general' },
    { id: 'eng-perf-audit', name: 'eng-perf-audit' },
    { id: 'design-systems', name: 'design-systems', isParticipant: false },
    { id: 'sales-enterprise', name: 'sales-enterprise', isParticipant: false },
  ];

  const engIds: string[] = [];
  const prodIds: string[] = [];
  const opsIds: string[] = [];

  for (const spec of namedTeamChannels) {
    channels.push({
      id: spec.id,
      name: spec.name,
      channelType: 'team',
      teamId: 'team-acme',
      isParticipant: spec.isParticipant ?? true,
      isAgentDm: false,
      updatedAtMs: NOW - 8 * MIN,
      viewedAtMs: NOW - 2 * HOUR,
      createdAtMs: NOW - 200 * HOUR,
      frecencyScore: 2,
      participantIds: ['alice', 'bob'],
      botParticipantIds: spec.fyi ? ['bot|ci'] : [],
      latestMessage: {
        messageId: `m-${spec.id}`,
        senderId: spec.fyi ? 'bot|ci' : 'bob',
        content: spec.fyi
          ? 'Automated CI build passed: release v2.18.5 deployed cleanly.'
          : spec.id === 'eng-incidents'
            ? 'URGENT: webhook 500s spiking on eu-west!'
            : `Latest update in #${spec.name}`,
        createdAtMs: NOW - 8 * MIN,
        mentions: spec.mentions ? ['alice'] : [],
      },
    });
    if (spec.unread) unread.add(spec.id);
    if (spec.mentions) mentions.set(spec.id, spec.mentions);
    if (spec.muted) muted.add(spec.id);
    if (spec.section === 'sec-eng') engIds.push(spec.id);
    if (spec.section === 'sec-prod') prodIds.push(spec.id);
    if (spec.section === 'sec-ops') opsIds.push(spec.id);
  }

  for (let i = namedTeamChannels.length; i < 50; i++) {
    const id = `team-extra-${i}`;
    const inProd = i < 28;
    channels.push({
      id,
      name: inProd ? `project-track-${i}` : `workspace-topic-${i}`,
      channelType: 'team',
      teamId: 'team-acme',
      isParticipant: i < 45,
      isAgentDm: false,
      updatedAtMs: NOW - (i + 5) * 20 * MIN,
      viewedAtMs: NOW - 6 * HOUR,
      createdAtMs: NOW - 300 * HOUR,
      frecencyScore: 0.5,
      participantIds: ['alice', 'bob'],
      botParticipantIds: [],
    });
    if (inProd) prodIds.push(id);
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
      id: 'sec-my-focus',
      name: 'My Launch Focus',
      scope: 'personal',
      // Deliberately overlaps Team "Engineering" (`launch-q4`, `eng-frontend`) to prove zero duplication!
      channelIds: ['launch-q4', 'eng-frontend'],
      sortOrder: 1,
    },
    {
      id: 'sec-eng',
      name: 'Engineering',
      scope: 'team',
      teamId: 'team-acme',
      channelIds: engIds,
      sortOrder: 0,
    },
    {
      id: 'sec-prod',
      name: 'Product',
      scope: 'team',
      teamId: 'team-acme',
      channelIds: prodIds,
      sortOrder: 1,
    },
    {
      id: 'sec-ops',
      name: 'Alerts & Ops',
      scope: 'team',
      teamId: 'team-acme',
      channelIds: opsIds,
      sortOrder: 2,
    },
  ];

  return {
    channels,
    sections,
    favorites: ['general', 'eng-incidents', 'sup-0', 'launch-q4'],
    unread,
    mentions,
    muted,
  };
}

function HarnessApp() {
  const initial = buildLargeFixtureData();
  const [channels, setChannels] = createSignal<SidebarChannel[]>(
    initial.channels
  );
  const [sections, setSections] = createSignal<SidebarSection[]>(
    initial.sections
  );
  const [favorites, setFavorites] = createSignal<string[]>(initial.favorites);
  const [unreadIds, setUnreadIds] = createSignal<Set<string>>(initial.unread);
  const [mentionCounts, setMentionCounts] = createSignal<Map<string, number>>(
    initial.mentions
  );
  const [mutedIds, setMutedIds] = createSignal<Set<string>>(initial.muted);
  const [selectedChannelId, setSelectedChannelId] = createSignal<
    string | undefined
  >('eng-incidents');
  const [dmQuery, setDmQuery] = createSignal('');
  const [openGroups, setOpenGroups] = createSignal({
    favorites: true,
    direct_messages: true,
    channels: true,
  });
  const [collapsedSections, setCollapsedSections] = createSignal<string[]>([]);
  const [sectionOrder, setSectionOrder] = createSignal<string[]>([]);

  const memStore = new Map<string, string>();
  const storage = {
    read: (uid: string) => memStore.get(uid) ?? null,
    write: (uid: string, val: string) => {
      memStore.set(uid, val);
    },
  };
  const prefs = createSidebarPreferences({ userId: () => 'alice', storage });
  const teamMemberIds = new Set(['alice', 'bob']);

  const simulatedJev: JevDecidePort = async (payload) => {
    if (!jevLive) return { ok: false, unavailable: true };
    const text = String(payload.input.latest_message ?? '').toLowerCase();
    const isUrgent = /urgent|broken|blocking|500s/.test(text);
    const isResolved = /thanks|fixed it|all set/.test(text);
    const isFyi = /automated|ci build|deployed/.test(text);
    return {
      ok: true,
      probabilities: {
        needs_reply: isResolved || isFyi ? 0.08 : 0.91,
        urgent: isUrgent ? 0.94 : 0.1,
        resolved: isResolved ? 0.95 : 0.05,
        fyi_noise: isFyi ? 0.92 : 0.06,
      },
    };
  };

  const unreadOrMentionedIds = createMemo(() => {
    const out = new Set(unreadIds());
    for (const [id, count] of mentionCounts()) {
      if (count > 0) out.add(id);
    }
    return out;
  });

  const supportIds = createMemo(
    () =>
      new Set(
        channels()
          .filter((ch) => ch.name.startsWith('Macro Support x'))
          .map((ch) => ch.id)
      )
  );

  const triage = createJevTriageController({
    accountKey: () => 'alice:browser-test',
    userId: () => 'alice',
    enabled: () => jevLive && prefs.prefs.jevEnabled,
    channels,
    supportChannelIds: supportIds,
    unreadOrMentionedIds,
    mentionCounts,
    teamMemberIds: () => teamMemberIds,
    decide: simulatedJev,
    storage,
    debounceMs: 10,
    now: () => NOW,
  });

  const supportDesk = createMemo(() =>
    buildSupportDeskModel({
      channels: channels(),
      sections: sections(),
      currentUserId: 'alice',
      teamMemberIds,
      unreadIds: unreadIds(),
      mentionCounts: mentionCounts(),
      triageByChannelId: triage.triageByChannelId(),
      nowMs: NOW,
    })
  );

  const focusModel = createMemo(() =>
    buildFocusModel({
      channels: channels(),
      supportDesk: supportDesk(),
      currentUserId: 'alice',
      teamMemberIds,
      unreadIds: unreadIds(),
      unreadOrMentionedIds: unreadOrMentionedIds(),
      mentionCounts: mentionCounts(),
      mutedIds: mutedIds(),
      triageByChannelId: triage.triageByChannelId(),
      nowMs: NOW,
    })
  );

  const placement = createMemo(() =>
    buildBrowsePlacement({
      channels: channels(),
      sections: sections(),
      sectionOrder: sectionOrder(),
      hiddenTeamSectionIds: new Set(prefs.prefs.hiddenTeamSectionIds),
      expandedLargeSectionIds: new Set(prefs.prefs.expandedLargeSectionIds),
      unreadIds: unreadIds(),
      unreadOrMentionedIds: unreadOrMentionedIds(),
      mentionCounts: mentionCounts(),
      mutedIds: mutedIds(),
      selectedChannelId: selectedChannelId(),
      unreadOnly: prefs.prefs.unreadOnly,
      hideMuted: prefs.prefs.hideMuted,
    })
  );

  const dmWindow = createMemo(() =>
    buildDmWindow({
      directMessages: channels().filter(
        (ch) => ch.channelType === 'direct_message'
      ),
      filter: prefs.prefs.dmFilter,
      limit: prefs.prefs.dmWindowLimit,
      expandedAll: prefs.prefs.dmExpandedAll,
      unreadOrMentionedIds: unreadOrMentionedIds(),
      activeCallChannelIds: new Set(['eng-incidents']),
      mutedIds: mutedIds(),
      selectedChannelId: selectedChannelId(),
      unreadOnly: prefs.prefs.unreadOnly,
      hideMuted: prefs.prefs.hideMuted,
      query: dmQuery(),
    })
  );

  const channelMap = createMemo(
    () => new Map(channels().map((ch) => [ch.id, ch]))
  );

  const totalUnreadCount = createMemo(() => {
    let n = 0;
    for (const id of unreadOrMentionedIds()) {
      if (mutedIds().has(id) && (mentionCounts().get(id) ?? 0) === 0) continue;
      n += 1;
    }
    return n;
  });

  const workspace: SidebarWorkspaceContextValue = {
    railId: 'browser-test-rail',
    channels,
    channelById: (id) => channelMap().get(id),
    channelEntityById: () => undefined,
    sections,
    rawLabelById: () => undefined,
    favoriteChannelIds: favorites,
    selectedChannelId,
    teamName: () => 'Acme',
    teamId: () => 'team-acme',
    teamMemberIds: () => teamMemberIds,
    currentUserId: () => 'alice',
    unreadIds,
    unreadOrMentionedIds,
    mentionCounts,
    mutedIds,
    activeCallChannelIds: () => new Set(['eng-incidents']),
    incomingCallByChannelId: () => new Map(),
    isLoading: () => mode === 'loading',
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
    totalUnreadCount,
    isGroupOpen: (g) => openGroups()[g],
    setGroupOpen: (g, open) =>
      setOpenGroups((prev) => ({ ...prev, [g]: open })),
    isSectionOpen: (id) => !collapsedSections().includes(id),
    setSectionOpen: (id, open) =>
      setCollapsedSections((prev) =>
        open ? prev.filter((x) => x !== id) : [...prev, id]
      ),
    sectionSort: () => undefined,
    setSectionSort: () => {},
    sectionOrder,
    setSectionOrder,
    openChannel: (id) => {
      setSelectedChannelId(id);
    },
    prefetchChannel: () => {},
    joinChannel: async (id) => {
      setChannels((prev) =>
        prev.map((ch) => (ch.id === id ? { ...ch, isParticipant: true } : ch))
      );
    },
    markChannelsRead: async (ids) => {
      setUnreadIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      setMentionCounts((prev) => {
        const next = new Map(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
    },
    toggleMuteChannel: async (id) => {
      setMutedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    toggleFavoriteChannel: async (id) => {
      setFavorites((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      );
    },
    reorderFavorites: async (orderedIds) => {
      setFavorites([...orderedIds]);
    },
    assignChannelToSection: async (channelId, sectionId) => {
      setSections((prev) =>
        prev.map((sec) => {
          const without = sec.channelIds.filter((id) => id !== channelId);
          if (sec.id === sectionId) {
            return { ...sec, channelIds: [...without, channelId] };
          }
          return sec;
        })
      );
    },
    createSection: async (input) => {
      if (!input?.name || !input.scope) return undefined;
      const name = input.name;
      const scope = input.scope;
      const id = `sec-created-${Date.now()}`;
      setSections((prev) => [
        ...prev,
        {
          id,
          name,
          scope,
          ruleContains: input.ruleContains,
          channelIds: input.channelIds ?? [],
          sortOrder: prev.length,
        },
      ]);
      return id;
    },
    editSection: async () => {},
    addChannelsToSection: async () => {},
    deleteSection: async (id) => {
      setSections((prev) => prev.filter((s) => s.id !== id));
    },
    markSectionRead: async (id) => {
      const target = sections().find((s) => s.id === id);
      if (target) await workspace.markChannelsRead(target.channelIds);
    },
    muteSection: async () => {},
    openCreateChannel: () => {},
    openCreateDm: () => {},
    activeTab: () => 'browse',
    openThreads: () => {},
    exitThreads: () => {},
    threadsChannelId: () => undefined,
    setThreadsChannelId: () => {},
    renderChannelIcon: (ch) => {
      if (ch.isAgentDm) return <RobotIcon class="size-3.5 text-ink-muted" />;
      if (ch.channelType === 'direct_message')
        return <UserIcon class="size-3.5 text-ink-muted" />;
      if (ch.channelType === 'private')
        return <LockIcon class="size-3.5 text-ink-muted" />;
      return <HashIcon class="size-3.5 text-ink-muted" />;
    },
  };

  return (
    <div class="flex h-screen w-screen overflow-hidden bg-surface-0 text-ink">
      <Show
        when={surface === 'mobile'}
        fallback={
          <>
            <div class="h-full w-64 shrink-0 border-r border-edge">
              <DragDropProvider>
                <DragDropSensors />
                <SidebarWorkspaceProvider value={workspace}>
                  <ChannelSidebarWorkspace />
                </SidebarWorkspaceProvider>
              </DragDropProvider>
            </div>
            <main
              data-active-channel-pane=""
              class="flex min-w-0 flex-1 flex-col items-center justify-center bg-surface-1 p-6"
            >
              <div class="text-sm text-ink-muted">Active channel</div>
              <div
                data-selected-channel-name=""
                class="mt-1 text-lg font-semibold text-ink"
              >
                {selectedChannelId()
                  ? (channelMap().get(selectedChannelId()!)?.name ??
                    selectedChannelId())
                  : 'None'}
              </div>
            </main>
          </>
        }
      >
        <div class="size-full overflow-hidden">
          <SidebarWorkspaceProvider value={workspace}>
            <ChannelSidebarMobileView />
          </SidebarWorkspaceProvider>
        </div>
      </Show>
    </div>
  );
}

render(() => <HarnessApp />, document.getElementById('root')!);
