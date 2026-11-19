import { AgentSessionPane } from '@app/features/agents-view/components/AgentSessionPane';
import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import { FloatRegions } from '@components/app/mobile/float-regions/float-region-state';
import {
  SplitPanelContext,
  type SplitPanelContextType,
} from '@components/app/split-layout/context';
import type { NotificationSource } from '@notifications/notification-source';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX, useContext } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentMessageTarget } from '../core/search-location';
import BlockAgent from './Block';

const mocks = vi.hoisted(() => ({
  markRead: vi.fn(async () => {}),
  loaded: (): boolean => false,
  failed: (): boolean => false,
  active: (): boolean => false,
  touch: false,
  source: undefined as NotificationSource | undefined,
  target: (): AgentMessageTarget | undefined => undefined,
  navigate: (_params: Record<string, unknown>) => {},
}));

// Keep both real session hosts and the real read marker. Replace unrelated
// editor/chrome surfaces and provide the session/notification boundary data.
vi.mock('@app/features/runtime-sharing/views/SessionAgentRuntime', () => ({
  SessionAgentRuntime: () => null,
}));

vi.mock('@notifications/notification-helpers', () => ({
  markNotificationsForEntityAsRead: mocks.markRead,
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => mocks.source,
}));
vi.mock('../context/AgentSessionContext', () => ({
  useAgentSession: () => ({
    sessionId: () => 'resolved-session',
    session: () =>
      mocks.loaded()
        ? {
            id: 'resolved-session',
            ownerId: 'owner',
            botId: 'bot',
            status: { kind: 'event', event: 'acp_ready' },
          }
        : undefined,
    metadata: () => undefined,
    loadFailed: () => mocks.failed(),
    accessDenied: () => false,
    loadRetryable: () => true,
    retryLoad: vi.fn(),
    pending: () => false,
    startupError: () => undefined,
  }),
}));
vi.mock('../agent-session-provider', () => ({
  AgentSessionProvider: (props: { children: JSX.Element }) => props.children,
}));
vi.mock('../context/pending-session', () => ({
  forgetPendingSession: vi.fn(),
  pendingSession: () => undefined,
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useCanAutofocusSplitContent: () => false,
  useSplitPanel: () => useContext(SplitPanelContext),
  useSplitPanelOrThrow: () => ({ isPanelActive: () => mocks.active() }),
}));
vi.mock('@core/block', () => ({ useBlockId: () => 'placeholder-session' }));
vi.mock('@core/internal/open-tracker', () => ({ createOpenTracker: vi.fn() }));
vi.mock('@core/orchestrator', () => ({
  createMethodRegistration: (
    _handle: unknown,
    methods: { goToLocationFromParams: typeof mocks.navigate }
  ) => {
    mocks.navigate = methods.goToLocationFromParams;
  },
}));
vi.mock('@core/signal/load', () => ({ blockHandleSignal: { get: vi.fn() } }));
vi.mock('../primitives/create-agent-route-target', () => ({
  createAgentRouteTarget: () => () => mocks.target(),
}));
vi.mock('@solidjs/router', () => ({ useSearchParams: () => [{}] }));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'owner' }));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => mocks.touch,
}));
vi.mock('@core/util/url', () => ({ openExternalUrl: vi.fn() }));
vi.mock('@app/features/next-soup/actions', () => ({
  useBlockEntityCommands: vi.fn(),
}));
vi.mock('@components/app/useNavigatedFromJK', () => ({
  useNavigatedFromJK: () => ({ navigatedFromJK: () => false }),
}));
vi.mock('@core/mobile/native-network-status', () => ({
  nativeNetworkStatus: () => 'online',
}));
vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  () => ({
    StaticMarkdownContext: (props: { children: JSX.Element }) => props.children,
  })
);
vi.mock('@core/component/EntityLoadGate', () => ({
  LoadErrorPanel: () => <div>Unable to load</div>,
}));
vi.mock('@core/component/EntityIcon', () => ({ EntityIcon: () => null }));
// Chrome, and query-backed: both hosts render it, and this file mounts them
// without a QueryClientProvider.
vi.mock('./AgentPreviewBanner', () => ({ AgentPreviewBanner: () => null }));
vi.mock('./auto-archive-file-operations', () => ({
  useAutoArchiveFileOperations: () => () => [],
}));
vi.mock('@core/component/AI/component/ProviderIcon', () => ({
  modelProvider: () => undefined,
  ProviderIcon: () => null,
}));
vi.mock('@core/component/SharePermissions', () => ({ Permissions: {} }));
vi.mock('@core/component/TopBar/ShareButton', () => ({
  ShareTrigger: () => null,
}));
vi.mock('@core/component/TopBar/shareModal', () => ({
  useShareModal: () => () => {},
}));
vi.mock(
  '@components/app/mobile/float-regions/FloatRegion',
  async (original) => ({
    ...(await original<
      typeof import('@components/app/mobile/float-regions/FloatRegion')
    >()),
    FloatRegionOrInline: (props: { children: JSX.Element }) => props.children,
  })
);
vi.mock('@components/app/SplitHeaderScope', () => ({
  SplitHeaderScope: {
    Root: (props: { children: JSX.Element }) => props.children,
    TopBar: () => null,
  },
}));
vi.mock('@app/features/changes/agent-session-changes', () => ({
  AgentChangesProvider: (props: { children: JSX.Element }) => props.children,
}));
vi.mock('@app/features/changes/changes', () => ({
  ChangesSplit: (props: { children: JSX.Element }) => props.children,
  ChangesHandoff: () => null,
  ChangesToggle: () => null,
  ReviewNotesDock: () => null,
}));
vi.mock('@components/app/side-panel', () => ({
  SidePanel: {
    FLOATING_CLEARANCE_PX: 344,
    Layout: (props: { children: JSX.Element }) => props.children,
    Root: (props: { children: JSX.Element }) => props.children,
    Toggle: () => null,
  },
  useSidePanel: () => null,
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: false }),
}));
vi.mock('@components/app/split-layout/components/SplitFileMenu', () => ({
  SplitFileMenu: () => null,
}));
vi.mock('@components/app/split-layout/components/SplitLabel', () => ({
  SplitTitleFileMenu: () => null,
  StaticSplitLabel: () => null,
}));
vi.mock('./AgentComposer', () => ({ AgentComposer: () => null }));
vi.mock('./AgentPullRequestChip', () => ({ AgentPullRequestChip: () => null }));
vi.mock('./AgentTaskChip', () => ({ AgentTaskChip: () => null }));
vi.mock('./agent-session-header', () => ({
  useAgentSessionHeader: () => ({}),
  agentSessionTitle: () => 'Agent session',
}));
vi.mock('../views/agent-session-header', () => ({
  AgentSessionHeader: () => null,
}));
vi.mock(
  '../views/mobile/redesigned-session-header/redesigned-session-header',
  () => ({
    MobileAgentSessionHeader: () => null,
  })
);
vi.mock('./sidepanel/AgentSidePanelSections', () => ({
  AgentSidePanelSections: () => null,
}));
vi.mock('./Transcript', () => ({
  Transcript: (props: { searchTarget?: AgentMessageTarget }) => (
    <output>{JSON.stringify(props.searchTarget)}</output>
  ),
}));
vi.mock('@app/features/agents-view/components/ChatComposer', () => ({
  ChatSessionInput: () => null,
}));
vi.mock('@app/features/agents-view/components/ModelSelector', () => ({
  SessionModelSelector: () => null,
}));
vi.mock('@app/features/agents-view/components/Topbar', () => ({
  Topbar: () => null,
}));
vi.mock('@ui', () => ({ EmptyStatePanel: () => null }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.loaded = () => false;
  mocks.failed = () => false;
  mocks.active = () => false;
  mocks.touch = false;
  mocks.target = () => undefined;
  mocks.source = {
    notificationsByEntity: () => ({}),
    isLoading: () => false,
  } as NotificationSource;
});

it('preserves an imperative agent target across Home route cleanup', () => {
  const [target, setTarget] = createSignal<AgentMessageTarget | undefined>({
    messageTurn: 0,
    author: 'agent',
  });
  mocks.target = target;
  const view = render(() => <BlockAgent />);
  const output = () => view.container.querySelector('output')!.textContent;
  mocks.navigate({ agent_message_turn: '2', agent_message_author: 'user' });
  setTarget(undefined);
  expect(JSON.parse(output()!)).toEqual({ messageTurn: 2, author: 'user' });
  setTarget({ messageTurn: 3, author: 'agent' });
  expect(JSON.parse(output()!)).toEqual({ messageTurn: 3, author: 'agent' });
  setTarget(undefined);
  expect(output()).toBe('');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe.each(['Home', 'Agents'] as const)('%s session host', (host) => {
  function mountHost() {
    const panel = {
      isPanelActive: () => mocks.active(),
      handle: { id: 'session-pane' },
    } as SplitPanelContextType;
    return render(() => (
      <SplitPanelContext.Provider value={panel}>
        {host === 'Home' ? (
          <BlockAgent />
        ) : (
          <AgentSessionPane
            id="placeholder-session"
            notificationSource={mocks.source!}
            onSessionId={vi.fn()}
            onDeleted={vi.fn()}
          />
        )}
      </SplitPanelContext.Provider>
    ));
  }

  it('hides the dock only while the phone session owns the active pane', () => {
    mocks.touch = true;
    const [active, setActive] = createSignal(true);
    mocks.active = active;
    const dock = render(() => (
      <>
        <div ref={(element) => FloatRegions.setMount('dock', element)} />
        <FloatRegion region="dock">
          <button type="button">App navigation</button>
        </FloatRegion>
      </>
    ));
    expect(screen.getByRole('button', { name: 'App navigation' })).toBeTruthy();

    const session = mountHost();
    expect(screen.queryByRole('button', { name: 'App navigation' })).toBeNull();
    expect(dock.container.firstElementChild?.childElementCount).toBe(0);

    // Back or swipe-back changes the active pane before the session unmounts.
    setActive(false);
    expect(screen.getByRole('button', { name: 'App navigation' })).toBeTruthy();
    setActive(true);
    expect(screen.queryByRole('button', { name: 'App navigation' })).toBeNull();

    session.unmount();
    expect(screen.getByRole('button', { name: 'App navigation' })).toBeTruthy();
  });

  it('does not suppress the dock for a desktop session', () => {
    mocks.active = () => true;
    const dock = FloatRegions.register({
      region: 'dock',
      priority: 0,
      isActive: () => true,
    });
    try {
      mountHost();
      expect(dock.isWinner()).toBe(true);
    } finally {
      dock.unregister();
    }
  });
  it('marks the resolved session only after it loads in the focused split', async () => {
    const [loaded, setLoaded] = createSignal(false);
    const [active, setActive] = createSignal(false);
    mocks.loaded = loaded;
    mocks.active = active;
    mountHost();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(mocks.markRead).not.toHaveBeenCalled();

    setLoaded(true);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(mocks.markRead).not.toHaveBeenCalled();

    setActive(true);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(mocks.markRead).toHaveBeenCalledExactlyOnceWith(mocks.source, {
      type: 'agent_session',
      id: 'resolved-session',
    });
  });

  it('never marks an inaccessible session', async () => {
    mocks.loaded = () => true;
    mocks.failed = () => true;
    mocks.active = () => true;
    mountHost();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(mocks.markRead).not.toHaveBeenCalled();
  });

  it('clears a route target before the same session is reopened', () => {
    const [target, setTarget] = createSignal<AgentMessageTarget>();
    mocks.target = target;
    mountHost();
    const output = () => document.querySelector('output')!.textContent;
    expect(output()).toBe('');
    setTarget({ messageTurn: 0, author: 'agent' });
    expect(JSON.parse(output()!)).toEqual({
      messageTurn: 0,
      author: 'agent',
    });
    setTarget(undefined);
    expect(output()).toBe('');
    setTarget({ messageTurn: 0, author: 'agent' });
    expect(JSON.parse(output()!)).toEqual({
      messageTurn: 0,
      author: 'agent',
    });
  });
});
