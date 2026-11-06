import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import {
  createResource,
  createSignal,
  For,
  onMount,
  type ParentProps,
  Suspense,
} from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AgentsRoute } from '../core/route';
import { AgentsView } from './AgentsView';

const state = vi.hoisted(() => ({
  contentId: { current: 'agents' },
  navigate: { current: (_id: string) => {} },
  loads: new Map<string, (name: string) => void>(),
  mounts: [] as string[],
  pass: (props: ParentProps) => props.children,
}));

vi.mock('@app/components/view-shell', () => ({
  ViewShell: { Root: state.pass, Aside: state.pass, Main: state.pass },
}));
vi.mock('@app/features/block-agent/context/pending-session', () => ({
  startPendingSession: () => 'pending',
}));
vi.mock('@app/features/settings/AgentSettings', () => ({
  AgentSettings: () => null,
}));
vi.mock('@app/features/settings/IntegrationsPage', () => ({
  IntegrationsPage: () => null,
}));
vi.mock('@app/features/soup/entity-notifications', () => ({
  withEntityNotifications: (entity: unknown) => entity,
}));
vi.mock('@app/features/tours/ViewTour', () => ({ ViewTour: () => null }));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: false, loading: false }),
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalBlockOrchestrator: () => ({}),
  useGlobalNotificationSource: () => ({}),
}));
vi.mock('@components/app/mobile/float-regions/float-region-state', () => ({
  FloatRegions: { hostHeight: () => 0 },
}));
vi.mock('@components/app/PreviewPanel', () => ({ PreviewPanel: () => null }));
vi.mock('@components/app/previewTarget', () => ({
  previewBlockTarget: () => ({}),
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({
    openWithSplit: (next: { id: string }) => {
      state.navigate.current(next.id);
      return { status: 'replaced' };
    },
  }),
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    handle: {
      id: 'split',
      content: () => ({ type: 'component', id: state.contentId.current }),
      setDisplayName: () => {},
    },
  }),
}));
vi.mock('@components/app/split-panel', () => ({
  SplitPanel: { Root: state.pass, Body: state.pass },
}));
vi.mock('@core/component/AI/component/message/EmptyChatState', () => ({
  ChatEmptyStateContext: { Provider: state.pass },
}));
vi.mock('@core/component/ComposerGreeting', () => ({
  ComposerGreeting: state.pass,
}));
vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  () => ({
    StaticMarkdownContext: state.pass,
  })
);
vi.mock('@core/component/Toast/Toast', () => ({ toast: { alert: vi.fn() } }));
vi.mock('@core/constant/featureFlags', () => ({ enableAgentUpdates: {} }));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'user' }));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('@entity', () => ({ ListEntityMetadataQueryProvider: state.pass }));
vi.mock('@notifications/mark-row-seen', () => ({
  markRowNotificationsSeenOnOpen: () => {},
}));
vi.mock('@queries/agent-session/warm', () => ({
  useWarmAgentSessionQuery: () => {},
}));
vi.mock('@queries/soup/items', () => ({
  useSoupAstItemsQuery: () => ({ isPending: true }),
}));
vi.mock('../../routines/routine-navigation', () => ({
  routineContent: () => ({}),
}));
vi.mock('../../routines/routines-page', () => ({ RoutinesPage: () => null }));
vi.mock('../agents-view.css', () => ({}));
vi.mock('../components/AgentSessionPane', () => ({
  // Suspends like the real pane, whose session read waits for the first load.
  AgentSessionPane: (props: { id: string }) => {
    const [title] = createResource(
      () =>
        new Promise<string>((resolve) => {
          state.loads.set(props.id, resolve);
        })
    );
    onMount(() => state.mounts.push(props.id));
    return <div data-testid="pane">{title()}</div>;
  },
}));
vi.mock('../components/AgentsSidebar', () => ({
  AgentsSidebar: (props: {
    activeConversationId?: string;
    onOpenConversation: (conversation: {
      id: string;
      type: 'agent_session';
    }) => void;
  }) => (
    <For each={['a', 'b', 'c']}>
      {(id) => (
        <button
          type="button"
          aria-current={props.activeConversationId === id ? 'true' : undefined}
          onClick={() =>
            props.onOpenConversation({ id, type: 'agent_session' })
          }
        >
          {id}
        </button>
      )}
    </For>
  ),
}));
vi.mock('../components/Topbar', () => ({ Topbar: () => null }));
vi.mock('../context/data-mode', () => ({
  DataModeProvider: state.pass,
  dataModeFor: () => 'chat',
}));
vi.mock('../primitives/composer-draft', () => ({
  createPersistedComposerDraft: () => ({ draft: () => '', setDraft: () => {} }),
}));
vi.mock('../primitives/conversation-list-view', () => ({
  createConversationListView: () => ({
    filters: () => [],
    grouping: () => 'none',
    setSelected: () => {},
    clear: () => {},
    setGrouping: () => {},
  }),
}));
vi.mock('../primitives/workspace-mode', () => ({
  createWorkspaceMode: () => ({ mode: () => 'auto', setMode: () => {} }),
}));
vi.mock('../queries/agent-conversations-query', () => ({
  agentConversationsQuery: () => ({}),
}));
vi.mock('../queries/agent-roster-source', () => ({
  createAgentRosterSource: () => ({
    roster: () => [],
    loading: () => false,
    availabilityLoading: () => false,
  }),
}));
vi.mock('../tour', () => ({ agentsTour: {} }));
vi.mock('./NewChatPage', () => ({ NewChatPage: () => null }));

function agentRoute(id: string): AgentsRoute {
  return { mode: 'chat', conversation: { type: 'agent_session', id } };
}

/** Opens conversation `a`, loaded, with clicks routed the way the split does. */
async function openLoadedConversation() {
  const [route, setRoute] = createSignal(agentRoute('a'));
  state.navigate.current = (id) => {
    state.contentId.current = id;
    setRoute(agentRoute(id.split('~').at(-1) ?? ''));
  };
  render(() => (
    <Suspense>
      <AgentsView route={route()} />
    </Suspense>
  ));
  state.loads.get('a')?.('Session a');
  expect((await screen.findByTestId('pane')).textContent).toBe('Session a');
}

function row(name: string) {
  return screen.getByRole('button', { name });
}

beforeEach(() => {
  state.contentId.current = 'agents';
  state.loads.clear();
  state.mounts.length = 0;
});

afterEach(cleanup);

it('selects the conversation and shows a skeleton before its load resolves', async () => {
  await openLoadedConversation();

  fireEvent.click(row('b'));

  expect(row('b').getAttribute('aria-current')).toBe('true');
  expect(row('a').getAttribute('aria-current')).toBeNull();
  expect(screen.queryByText('Session a')).toBeNull();
  expect(screen.getByRole('status')).toBeTruthy();

  state.loads.get('b')?.('Session b');

  expect((await screen.findByTestId('pane')).textContent).toBe('Session b');
  expect(screen.queryByRole('status')).toBeNull();
});

it('does not wait on a conversation already switched away from', async () => {
  await openLoadedConversation();

  fireEvent.click(row('b'));
  fireEvent.click(row('c'));
  state.loads.get('c')?.('Session c');

  expect((await screen.findByTestId('pane')).textContent).toBe('Session c');
});

it('keeps the open conversation mounted when it is selected again', async () => {
  await openLoadedConversation();

  fireEvent.click(row('a'));

  expect(screen.getByTestId('pane').textContent).toBe('Session a');
  expect(state.mounts).toEqual(['a']);
});
