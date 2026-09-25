import { AgentSessionPane } from '@app/features/agents-view/components/AgentSessionPane';
import {
  SplitPanelContext,
  type SplitPanelContextType,
} from '@components/app/split-layout/context';
import type { NotificationSource } from '@notifications/notification-source';
import { cleanup, render } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BlockAgent from './Block';

const mocks = vi.hoisted(() => ({
  markRead: vi.fn(async () => {}),
  loaded: (): boolean => false,
  failed: (): boolean => false,
  active: (): boolean => false,
  source: undefined as NotificationSource | undefined,
}));

// Keep both real session hosts and the real read marker. Replace unrelated
// editor/chrome surfaces and provide the session/notification boundary data.
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
  useSplitPanelOrThrow: () => ({ isPanelActive: () => mocks.active() }),
}));
vi.mock('@core/block', () => ({ useBlockId: () => 'placeholder-session' }));
vi.mock('@core/orchestrator', () => ({ createMethodRegistration: vi.fn() }));
vi.mock('@core/signal/load', () => ({ blockHandleSignal: { get: vi.fn() } }));
vi.mock('@solidjs/router', () => ({ useSearchParams: () => [{}] }));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'owner' }));
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
vi.mock('@core/component/AI/component/ProviderIcon', () => ({
  modelProvider: () => undefined,
  ProviderIcon: () => null,
}));
vi.mock('@core/component/SharePermissions', () => ({ Permissions: {} }));
vi.mock('@core/component/TopBar/ShareButton', () => ({
  ShareDialogContext: {
    Provider: (props: { children: JSX.Element }) => props.children,
  },
  ShareModal: () => null,
  ShareTrigger: () => null,
}));
vi.mock('@components/app/mobile/float-regions/FloatRegion', () => ({
  FloatRegionOrInline: (props: { children: JSX.Element }) => props.children,
}));
vi.mock('@app/features/agent-changes/agent-changes', () => ({
  AgentChangesProvider: (props: { children: JSX.Element }) => props.children,
  AgentChangesSplit: (props: { children: JSX.Element }) => props.children,
  ChangesHandoff: () => null,
  ChangesToggle: () => null,
  ReviewNotesDock: () => null,
}));
vi.mock('@components/app/side-panel', () => ({
  SidePanel: {
    Layout: (props: { children: JSX.Element }) => props.children,
    Root: (props: { children: JSX.Element }) => props.children,
    Toggle: () => null,
  },
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
vi.mock('./AgentSplitHeader', () => ({
  AgentSplitHeader: () => null,
  agentSessionTitle: () => 'Agent session',
  sessionRepositoryUrl: () => undefined,
}));
vi.mock('./sidepanel/AgentSidePanelSections', () => ({
  AgentSidePanelSections: () => null,
}));
vi.mock('./Transcript', () => ({ Transcript: () => <div>Conversation</div> }));
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
  mocks.source = {
    notificationsByEntity: () => ({}),
    isLoading: () => false,
  } as NotificationSource;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe.each(['Home', 'Agents'] as const)('%s session host', (host) => {
  function mountHost() {
    const panel = {
      isPanelActive: () => mocks.active(),
    } as SplitPanelContextType;
    render(() => (
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
});
