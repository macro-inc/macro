import { useSplitBackInterceptor } from '@components/app/split-layout/back-interceptor';
import {
  SplitPanelContext,
  type SplitPanelContextType,
} from '@components/app/split-layout/context';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import {
  type ComponentProps,
  createResource,
  createRoot,
  createSignal,
  For,
  onMount,
  type ParentProps,
  Suspense,
} from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { type AgentsRoute, agentsRouteId } from '../core/route';
import { AgentsView as Workspace } from './AgentsView';

function AgentsView(props: ComponentProps<typeof Workspace>) {
  const panel = {
    panelSize: {
      get width() {
        return state.width();
      },
    },
  } as SplitPanelContextType;
  return (
    <SplitPanelContext.Provider value={panel}>
      <Workspace {...props} />
    </SplitPanelContext.Provider>
  );
}

/** A split history entry: what it shows and the view state captured into it. */
type FakeEntry = {
  content: { type: 'component'; id: string; params?: Record<string, unknown> };
  state?: Record<string, unknown>;
};

const state = vi.hoisted(() => ({
  touch: false,
  width: (): number => 1000,
  contentId: { current: 'agents' },
  entry: { current: undefined as (() => FakeEntry) | undefined },
  captors: new Map<string, () => unknown>(),
  /** Captures the view's entry state into `entry`, as the split does before leaving it. */
  capture(entry: FakeEntry | undefined) {
    if (!entry) return;
    const captured = Object.fromEntries(
      Array.from(this.captors, ([key, read]) => [key, read()])
    );
    entry.state = { ...entry.state, ...captured };
  },
  draft: { read: (): string => '', write: (_draft: string) => {} },
  navigate: { current: (_id: string) => {} },
  replace: { current: (_next: FakeEntry['content']) => {} },
  back: { current: () => {} },
  canGoBack: { current: (): boolean => false },
  open: {
    current: (_next: { id: string; params?: Record<string, unknown> }) => {},
  },
  loads: new Map<string, (name: string) => void>(),
  mounts: [] as string[],
  pass: (props: ParentProps) => props.children,
}));

vi.mock('@app/components/view-shell', () => ({
  useViewShell: () => ({
    breakpoints: { narrow: () => false },
    aside: { isOverlay: () => false },
  }),
  ViewShell: { Root: state.pass, Aside: state.pass, Main: state.pass },
}));
vi.mock('@app/features/block-agent/context/pending-session', () => ({
  startPendingSession: () => 'pending',
}));
vi.mock('@app/features/settings/AgentSettings', () => ({
  AgentSettings: (props: { createKind?: string }) => (
    <p>Agent creation: {props.createKind ?? 'none'}</p>
  ),
}));
vi.mock('@app/features/settings/IntegrationsPage', () => ({
  IntegrationsPage: () => null,
}));
vi.mock('@app/features/soup/entity-notifications', () => ({
  withEntityNotifications: (entity: unknown) => entity,
}));
vi.mock('@app/features/tours/ViewTour', () => ({ ViewTour: () => null }));
vi.mock('@app/features/video-tutorials', () => ({ TutorialPill: () => null }));
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
    openWithSplit: (next: { id: string; params?: Record<string, unknown> }) => {
      state.open.current(next);
      state.navigate.current(next.id);
      return { status: 'replaced' };
    },
  }),
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    handle: {
      id: 'split',
      content: () =>
        state.entry.current?.().content ?? {
          type: 'component',
          id: state.contentId.current,
        },
      currentEntryState: () => state.entry.current?.().state,
      captureEntryState: () => state.capture(state.entry.current?.()),
      registerEntryStateCaptor: (key: string, read: () => unknown) => {
        state.captors.set(key, read);
        return () => state.captors.delete(key);
      },
      setDisplayName: () => {},
      replace: ({ next }: { next: FakeEntry['content'] }) =>
        state.replace.current(next),
      goBack: () => state.back.current(),
      canGoBack: () => state.canGoBack.current(),
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
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => state.touch,
}));
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
vi.mock('./agents-sidebar/agents-sidebar', async () => ({
  DesktopAgentsSidebar: (await import('../components/AgentsSidebar'))
    .AgentsSidebar,
}));
vi.mock('../phone-list', () => ({
  PhoneAgentsList: (props: {
    archived: boolean;
    onCreateAgent: () => void;
    onOpenPage: (page: 'archived' | 'agents' | 'routines') => void;
    onBack: () => void;
    onOpenConversation: (conversation: {
      id: string;
      type: 'agent_session';
    }) => void;
  }) => (
    <div>
      <span>{props.archived ? 'Archived page' : 'Agents list'}</span>
      <button onClick={() => props.onOpenPage('archived')}>Archived</button>
      <button onClick={() => props.onOpenPage('agents')}>Roster</button>
      <button onClick={() => props.onOpenPage('routines')}>Routines</button>
      <button
        onClick={() =>
          props.onOpenConversation({ id: 'session', type: 'agent_session' })
        }
      >
        Session
      </button>
      <button onClick={props.onBack}>List back</button>
      <button onClick={props.onCreateAgent}>New agent</button>
    </div>
  ),
}));
vi.mock('./archived-conversations/archived-conversations', () => ({
  ArchivedConversations: () => null,
}));
vi.mock(
  '@app/features/block-agent/queries/change-session-archive-state',
  () => ({
    changeSessionArchiveState: vi.fn(),
  })
);
vi.mock('../components/Topbar', () => ({
  Topbar: (props: { onBack?: () => void }) =>
    props.onBack ? <button onClick={props.onBack}>Page back</button> : null,
}));
vi.mock('../context/data-mode', () => ({
  DataModeProvider: state.pass,
  dataModeFor: () => 'chat',
}));
vi.mock('../primitives/composer-draft', () => ({
  createPersistedComposerDraft: () => ({
    draft: () => state.draft.read(),
    setDraft: (draft: string) => state.draft.write(draft),
  }),
}));
vi.mock('../primitives/conversation-list-view', () => ({
  createConversationListView: () => ({
    filters: () => [],
    grouping: () => 'none',
    sort: () => 'updated',
    setSort: () => {},
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
vi.mock('./NewChatPage', () => ({
  NewChatPage: (props: {
    draft?: string;
    onDraftChange?: (draft: string) => void;
    requestedAgent?: { agentId: string; request: string };
  }) => (
    <textarea
      aria-label="Message"
      data-requested-agent={
        props.requestedAgent
          ? `${props.requestedAgent.agentId}@${props.requestedAgent.request}`
          : undefined
      }
      value={props.draft ?? ''}
      onInput={(event) => props.onDraftChange?.(event.currentTarget.value)}
    />
  ),
}));

// The persisted draft outlives the view, as localStorage does.
const [composerDraft, setComposerDraft] = createSignal('');
state.draft.read = composerDraft;
state.draft.write = setComposerDraft;

/** The Agents entry an Ask Macro action opens, seeding the composer with `draft`. */
function composerEntry(request: string, draft: string): FakeEntry {
  return {
    content: {
      type: 'component',
      id: 'agents',
      params: { focusComposer: request, draft },
    },
  };
}

function composer() {
  return screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Message' });
}

/** Sending clears the composer's draft. */
function send() {
  fireEvent.input(composer(), { target: { value: '' } });
}

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
  state.touch = false;
  state.width = () => 1000;
  state.contentId.current = 'agents';
  state.entry.current = undefined;
  state.captors.clear();
  state.replace.current = () => {};
  state.back.current = () => {};
  state.canGoBack.current = () => false;
  state.open.current = () => {};
  setComposerDraft('');
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

it.each(['restored', 'selected'])(
  'retains the %s touch conversation when its pane folds',
  async (selection) => {
    state.touch = true;
    const [width, setWidth] = createSignal(1000);
    state.width = width;
    await openLoadedConversation();
    if (selection === 'selected') {
      fireEvent.click(row('b'));
      state.loads.get('b')?.('Session b');
      await screen.findByText('Session b');
    }
    const pane = screen.getByTestId('pane');
    const mounted = [...state.mounts];
    setWidth(600);
    expect(pane.closest('main')?.classList.contains('hidden')).toBe(false);
    expect(screen.getByTestId('pane')).toBe(pane);
    expect(state.mounts).toEqual(mounted);
  }
);

it('does not restore a sent Ask Macro draft when Back mounts the composer again', () => {
  const asked = composerEntry('request-1', '@message ');
  state.entry.current = () => asked;
  render(() => <AgentsView />);
  expect(composer().value).toBe('@message ');

  send();
  state.capture(asked);
  cleanup();
  // Back delivers the entry again with its params, as resuming the view does.
  render(() => <AgentsView />);

  expect(composer().value).toBe('');
});

it('does not restore a sent Ask Macro draft when Back returns to the mounted composer', () => {
  const asked = composerEntry('request-1', '@message ');
  const session: FakeEntry = {
    content: {
      type: 'component',
      id: agentsRouteId({
        mode: 'chat',
        conversation: { type: 'agent_session', id: 'pending' },
      }),
    },
  };
  const [current, setCurrent] = createSignal(asked);
  state.entry.current = current;
  render(() => <AgentsView />);

  send();
  state.capture(asked);
  setCurrent(session);
  state.capture(session);
  setCurrent(asked);

  expect(composer().value).toBe('');
});

it('seeds a new Ask Macro draft but not an earlier one reached by Back', () => {
  const first = composerEntry('request-1', '@first ');
  const [current, setCurrent] = createSignal(first);
  state.entry.current = current;
  render(() => <AgentsView />);
  send();
  state.capture(first);

  const second = composerEntry('request-2', '@second ');
  setCurrent(second);
  expect(composer().value).toBe('@second ');

  send();
  state.capture(second);
  setCurrent(first);
  expect(composer().value).toBe('');

  // Forward and Back again: leaving the first entry keeps its own request.
  state.capture(first);
  setCurrent(second);
  state.capture(second);
  setCurrent(first);

  expect(composer().value).toBe('');
});

it('does not restore a sent Ask Macro draft when a stacked pane remounts without leaving its entry', () => {
  const asked = composerEntry('request-1', '@message ');
  state.entry.current = () => asked;
  render(() => <AgentsView />);

  send();
  cleanup();
  render(() => <AgentsView />);

  expect(composer().value).toBe('');
});

it('asks the composer for the agent a Try it opened it with, once per request', () => {
  const tryIt = (request: string): FakeEntry => ({
    content: {
      type: 'component',
      id: 'agents',
      params: {
        agentPage: 'new',
        agentPageRequest: request,
        composerAgentId: 'computer-agent',
      },
    },
  });
  const [current, setCurrent] = createSignal(tryIt('request-1'));
  state.entry.current = current;
  render(() => <AgentsView />);

  expect(composer().dataset.requestedAgent).toBe('computer-agent@request-1');

  setCurrent(tryIt('request-2'));
  expect(composer().dataset.requestedAgent).toBe('computer-agent@request-2');
});

it.each([
  ['Archived', 'Archived page'],
  ['Roster', 'Agents'],
  ['Routines', 'Routines'],
] as const)(
  'returns from %s to the previous Agents list entry',
  (label, page) => {
    state.touch = true;
    state.width = () => 390;
    const first: FakeEntry = { content: { type: 'component', id: 'agents' } };
    const [entry, setEntry] = createSignal(first);
    state.entry.current = entry;
    const history = [first];
    state.replace.current = (next) => {
      const item = { content: next };
      history.push(item);
      setEntry(item);
    };
    state.open.current = (next) => {
      const item = { content: { type: 'component' as const, ...next } };
      history.push(item);
      setEntry(item);
    };
    state.canGoBack.current = () => history.length > 1;
    state.back.current = () => {
      history.pop();
      setEntry(history.at(-1)!);
    };
    render(() => <AgentsView />);
    fireEvent.click(screen.getByRole('button', { name: label }));
    if (label === 'Archived') expect(screen.getByText(page)).toBeTruthy();
    else
      expect(entry().content.id).toBe(
        label === 'Routines' ? 'routines' : 'agents'
      );
    expect(history).toHaveLength(2);
    if (label === 'Archived')
      fireEvent.click(screen.getByRole('button', { name: 'List back' }));
    else state.back.current();
    expect(screen.getByText('Agents list')).toBeTruthy();
    expect(history).toHaveLength(1);
  }
);

it('returns from an agent page to Archived without pushing a restoration entry', () => {
  state.touch = true;
  state.width = () => 390;
  const [entry, setEntry] = createSignal<FakeEntry>({
    content: { type: 'component', id: 'agents' },
  });
  state.entry.current = entry;
  const history: FakeEntry[] = [entry()];
  state.replace.current = (next) => {
    const item = { content: next };
    history.push(item);
    setEntry(item);
  };
  state.back.current = () => {
    history.pop();
    setEntry(history.at(-1)!);
  };
  state.canGoBack.current = () => history.length > 1;
  render(() => <AgentsView />);
  fireEvent.click(screen.getByRole('button', { name: 'Archived' }));
  fireEvent.click(screen.getByRole('button', { name: 'Roster' }));
  state.back.current();
  expect(screen.getByText('Archived page')).toBeTruthy();
  expect(history).toHaveLength(2);
});

it('opens a session from Archived with its previous page still in the stack', () => {
  state.touch = true;
  state.width = () => 390;
  const [entry, setEntry] = createSignal<FakeEntry>({
    content: { type: 'component', id: 'agents' },
  });
  state.entry.current = entry;
  const history: FakeEntry[] = [entry()];
  state.replace.current = (next) => {
    const item = { content: next };
    history.push(item);
    setEntry(item);
  };
  state.open.current = (next) => {
    const item = { content: { type: 'component' as const, ...next } };
    history.push(item);
  };
  render(() => <AgentsView />);
  fireEvent.click(screen.getByRole('button', { name: 'Archived' }));
  fireEvent.click(screen.getByRole('button', { name: 'Session' }));
  expect(history.map((item) => item.content.id)).toEqual([
    'agents',
    'agents',
    'session',
  ]);
  // The phone stack returns to the still-mounted Archived pane.
  expect(screen.getByText('Archived page')).toBeTruthy();
});

it('restores a phone composer request without replacing its history entry', () => {
  state.touch = true;
  state.width = () => 390;
  const asked = composerEntry('phone-request', '@message ');
  state.entry.current = () => asked;
  const replace = vi.fn();
  state.replace.current = replace;
  render(() => <AgentsView />);
  expect(composer().value).toBe('@message ');
  expect(screen.queryByText('Agents list')).toBeNull();
  expect(replace).not.toHaveBeenCalled();
});

it('replaces a direct Archived entry with the list when no earlier page exists', () => {
  state.touch = true;
  state.width = () => 390;
  const [entry, setEntry] = createSignal<FakeEntry>({
    content: {
      type: 'component',
      id: 'agents',
      params: { agentPage: 'archived' },
    },
  });
  state.entry.current = entry;
  const replace = vi.fn((next: FakeEntry['content']) =>
    setEntry({ content: next })
  );
  state.replace.current = replace;
  render(() => <AgentsView />);
  expect(screen.getByText('Archived page')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'List back' }));
  expect(screen.getByText('Agents list')).toBeTruthy();
  expect(replace).toHaveBeenCalledWith({ type: 'component', id: 'agents' });
});

it('retains the phone New agent creation intent through the history entry', () => {
  state.touch = true;
  state.width = () => 390;
  const [entry, setEntry] = createSignal<FakeEntry>({
    content: { type: 'component', id: 'agents' },
  });
  state.entry.current = entry;
  state.replace.current = (next) => setEntry({ content: next });
  render(() => <AgentsView />);
  fireEvent.click(screen.getByRole('button', { name: 'New agent' }));
  expect(entry().content.params?.createAgentKind).toBe('agent');
  expect(screen.getByText('Agent creation: agent')).toBeTruthy();
});

it('lets an active editor intercept the phone page Back action', () => {
  state.touch = true;
  state.width = () => 390;
  const [entry] = createSignal<FakeEntry>({
    content: {
      type: 'component',
      id: 'agents',
      params: { agentPage: 'agents' },
    },
  });
  state.entry.current = entry;
  state.canGoBack.current = () => true;
  const goBack = vi.fn();
  state.back.current = goBack;
  let dispose = () => {};
  const intercept = vi.fn(() => true);
  createRoot((cleanup) => {
    dispose = cleanup;
    useSplitBackInterceptor(intercept);
  });
  try {
    render(() => <AgentsView />);
    fireEvent.click(screen.getByRole('button', { name: 'Page back' }));
    expect(intercept).toHaveBeenCalledOnce();
    expect(goBack).not.toHaveBeenCalled();
  } finally {
    dispose();
  }
});
