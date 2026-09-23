import { HomeListEntity } from '@app/features/inbox-view/components/HomeListEntity';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type AgentConversationEntity,
  groupConversations,
} from '../core/recent-conversations';
import { AgentsSidebar } from './AgentsSidebar';

const openWithSplit = vi.fn();
const unreadFilter = vi.hoisted(() => vi.fn(() => false));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit }),
}));
vi.mock('@core/util/openInNewSplit', () => ({
  openInNewSplitForMention: () => true,
}));

vi.mock('@app/components/view-shell', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@app/components/view-shell')>()),
  useViewControlHotkeys: vi.fn(),
}));
vi.mock('@entity', () => ({
  Entity: { Title: () => 'Recent chat', Timestamp: () => 'now' },
  MaybeEntityRow: (props: { children: JSX.Element }) => props.children,
}));
vi.mock('@entity/utils/filter', () => ({ unreadFilterFn: unreadFilter }));
vi.mock('@app/features/inbox-view/components/HomeEntityIcon', () => ({
  HomeEntityIcon: () => null,
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'me' }));
vi.mock('@core/user', () => ({
  getDisplayName: () => '',
  tryMacroId: (id: string) => id,
}));

afterEach(() => {
  cleanup();
  unreadFilter.mockReturnValue(false);
});

vi.mock('@solid-primitives/resize-observer', () => ({
  createResizeObserver: () => {},
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    splitHotkeyScope: 'test',
    isPanelActive: () => true,
  }),
}));
vi.mock('@app/features/next-soup/actions', () => ({
  toEntityActionListState: () => ({
    focus: { set: vi.fn() },
  }),
}));
vi.mock('@app/features/soup', () => ({
  MaybeSoupEntityActionDrawerManager: (props: { children: JSX.Element }) =>
    props.children,
  SoupEntityContextMenu: (props: {
    children: JSX.Element;
    entity: { id: string };
  }) => {
    const [open, setOpen] = createSignal(false);
    return (
      <div
        data-entity-context-menu={props.entity.id}
        onContextMenu={(event) => {
          event.preventDefault();
          setOpen(true);
        }}
      >
        {props.children}
        {open() && (
          <div role="menu">
            <div role="menuitem">Rename</div>
            <div role="menuitem">Favorite</div>
            <div role="menuitem">Copy Link</div>
            <div role="menuitem">Delete</div>
          </div>
        )}
      </div>
    );
  },
}));
vi.mock('@components/app/split-panel', () => ({
  SplitPanel: { CloseButton: () => null },
}));
vi.mock('@app/components/view-shell/SidebarCreateButton', () => ({
  SidebarCreateButton: (props: { label: string; onCreate: () => void }) => (
    <button onClick={props.onCreate}>{props.label}</button>
  ),
}));

describe('mixed Agents sidebar', () => {
  it('keeps Chat and Code together, marks each kind, and preserves split navigation', () => {
    const conversations: AgentConversationEntity[] = [
      {
        type: 'agent_session',
        id: 'code',
        name: 'Fix build',
        ownerId: 'me',
        botId: 'cursor',
        status: 'acp_ready',
      },
      { type: 'chat', id: 'chat', name: 'Plan launch', ownerId: 'me' },
    ];
    const open = vi.fn();
    const create = vi.fn();
    const openPage = vi.fn();
    render(() => (
      <AgentsSidebar
        activePage="new"
        onOpenPage={openPage}
        groups={groupConversations(conversations)}
        modeForConversation={(conversation) =>
          conversation.id === 'code' ? 'code' : 'chat'
        }
        activeConversationId="chat"
        search=""
        loading={false}
        error={false}
        hasNextPage={false}
        loadingNextPage={false}
        onNewConversation={create}
        onSearchChange={vi.fn()}
        onOpenConversation={open}
        onRetry={vi.fn()}
        onLoadMore={vi.fn()}
      />
    ));
    for (const label of ['Agents', 'Connections']) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(openPage).toHaveBeenLastCalledWith(label.toLowerCase());
    }
    expect(screen.queryByRole('button', { name: 'Routines' })).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
    const code = screen.getByRole('button', { name: /Fix build/ });
    const chat = screen.getByRole('button', { name: /Plan launch/ });
    expect(code.closest('[data-kind]')?.getAttribute('data-kind')).toBe('code');
    expect(chat.getAttribute('data-kind')).toBe('chat');
    expect(chat.getAttribute('aria-current')).toBe('page');
    fireEvent.click(code, { shiftKey: true });
    expect(open).toHaveBeenCalledWith(
      conversations[0],
      expect.objectContaining({ shiftKey: true })
    );
    fireEvent.click(chat);
    expect(open).toHaveBeenLastCalledWith(conversations[1], expect.anything());
    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
    expect(create).toHaveBeenCalledOnce();
  });

  it('opens rename and delete on a session or chat right-click', async () => {
    render(() => (
      <AgentsSidebar
        activePage="new"
        onOpenPage={vi.fn()}
        groups={groupConversations([
          {
            type: 'agent_session',
            id: 'code',
            name: 'Fix build',
            ownerId: 'me',
            botId: 'cursor',
            status: 'acp_ready',
          },
          { type: 'chat', id: 'chat', name: 'Plan launch', ownerId: 'me' },
        ])}
        modeForConversation={(conversation) =>
          conversation.id === 'code' ? 'code' : 'chat'
        }
        activeConversationId={undefined}
        search=""
        loading={false}
        error={false}
        hasNextPage={false}
        loadingNextPage={false}
        onNewConversation={vi.fn()}
        onSearchChange={vi.fn()}
        onOpenConversation={vi.fn()}
        onRetry={vi.fn()}
        onLoadMore={vi.fn()}
      />
    ));

    const session = screen.getByRole('button', { name: /Fix build/ });
    fireEvent.contextMenu(session);
    const sessionMenu = within(
      session.closest('[data-entity-context-menu]') as HTMLElement
    );
    expect(sessionMenu.getByRole('menuitem', { name: 'Rename' })).toBeTruthy();
    expect(sessionMenu.getByRole('menuitem', { name: 'Delete' })).toBeTruthy();
    expect(
      sessionMenu.getByRole('menuitem', { name: 'Favorite' })
    ).toBeTruthy();
    expect(
      sessionMenu.getByRole('menuitem', { name: 'Copy Link' })
    ).toBeTruthy();

    const chat = screen.getByRole('button', { name: /Plan launch/ });
    fireEvent.contextMenu(chat);
    const chatMenu = within(
      chat.closest('[data-entity-context-menu]') as HTMLElement
    );
    expect(chatMenu.getByRole('menuitem', { name: 'Rename' })).toBeTruthy();
    expect(chatMenu.getByRole('menuitem', { name: 'Delete' })).toBeTruthy();
  });
});

describe.each(['home', 'sidebar'] as const)('%s agent rows', (surface) => {
  const conversation: AgentConversationEntity = {
    type: 'agent_session',
    id: 'coding-session',
    name: 'Fix build',
    ownerId: 'me',
    botId: 'cursor',
    harness: 'cursor',
    status: 'acp_ready',
    turnState: 'idle',
    repoUrl: 'https://github.com/macro-inc/macro.git',
    repoBranch: 'main',
    workingBranch: 'fix/build',
  };
  function setup() {
    const open = vi.fn();
    const [entity, setEntity] = createSignal(conversation);
    const view = render(() =>
      surface === 'home' ? (
        <HomeListEntity
          entity={entity()}
          occurrenceKey="coding-session"
          onClick={open}
        />
      ) : (
        <AgentsSidebar
          activePage="new"
          onOpenPage={vi.fn()}
          groups={groupConversations([entity()])}
          modeForConversation={() => 'code'}
          activeConversationId={undefined}
          search=""
          loading={false}
          error={false}
          hasNextPage={false}
          loadingNextPage={false}
          onNewConversation={vi.fn()}
          onSearchChange={vi.fn()}
          onOpenConversation={open}
          onRetry={vi.fn()}
          onLoadMore={vi.fn()}
        />
      )
    );
    return { open, view, setEntity };
  }

  it('shows saved working branch and reactive PR state without taking over session navigation', () => {
    const { open, view, setEntity } = setup();
    const session = screen.getByRole('button', { name: 'Fix build' });
    expect(screen.getByText('macro-inc/macro · fix/build')).toBeTruthy();
    expect(screen.queryByText('main')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    setEntity({
      ...conversation,
      pullRequestUrl: 'https://github.com/macro-inc/macro/pull/42',
      pullRequestState: 'open',
    });
    const pr = screen.getByRole('link', {
      name: 'Open pull request #42, Open on GitHub',
    });
    expect(pr.getAttribute('href')).toBe(
      'https://github.com/macro-inc/macro/pull/42'
    );
    expect(pr.closest('button')).toBeNull();
    expect(view.container.querySelector('[data-kind="code"]')).toBeTruthy();
    expect(screen.getByText('#42')).toBeTruthy();
    expect(screen.queryByText('Open')).toBeNull();
    fireEvent.mouseDown(pr, { button: 0, detail: 1 });
    fireEvent.click(pr);
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(session, { shiftKey: true });
    expect(open).toHaveBeenCalledOnce();
    const event = open.mock.calls[0][surface === 'home' ? 0 : 1];
    expect(event.shiftKey).toBe(true);
    setEntity({
      ...conversation,
      pullRequestUrl: 'https://github.com/macro-inc/macro/pull/42',
      pullRequestState: 'merged',
    });
    expect(
      screen.getByRole('link', {
        name: 'Open pull request #42, Merged on GitHub',
      })
    ).toBeTruthy();
    expect(screen.getByText('#42')).toBeTruthy();
    expect(screen.queryByText('Merged')).toBeNull();
    expect(screen.queryByText('Open')).toBeNull();
  });

  it('keeps non-coding agents to one line even if unrelated coding metadata exists', () => {
    const { open, view, setEntity } = setup();
    setEntity({
      ...conversation,
      harness: 'in-memory',
      pullRequestUrl: 'https://github.com/macro-inc/macro/pull/42',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Fix build' }));
    expect(open).toHaveBeenCalledOnce();
    expect(view.container.querySelector('[data-kind="chat"]')).toBeTruthy();
    expect(
      view.container.querySelector('[data-agent-code-details]')
    ).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('keeps Home sparkles stable while Agents reflects persisted activity', () => {
    const { view, setEntity } = setup();
    const icon = () =>
      view.container.querySelector(
        '[data-agent-session-row] [data-view-sidebar-icon]'
      );
    expect(icon()?.querySelector('svg') !== null).toBe(surface === 'home');
    expect(
      view.container.querySelector('[data-agent-status-indicator]')
    ).toBeNull();
    setEntity({ ...conversation, turnState: 'running' });
    expect(
      screen
        .getByRole('button', { name: 'Fix build' })
        .getAttribute('aria-description')
    ).toBe('Working');
    expect(icon()?.querySelector('svg') !== null).toBe(surface === 'home');
    expect(
      view.container.querySelector('[data-agent-status-indicator]') !== null
    ).toBe(surface === 'sidebar');
    setEntity({ ...conversation, turnState: 'blocked' });
    expect(
      screen
        .getByRole('button', { name: 'Fix build' })
        .getAttribute('aria-description')
    ).toBe('Waiting for input');
    setEntity({ ...conversation, turnState: 'idle' });
    expect(
      view.container.querySelector('[data-agent-status-indicator]')
    ).toBeNull();
  });

  it('does not claim an unsynced PR is open', () => {
    const { setEntity } = setup();
    setEntity({
      ...conversation,
      pullRequestUrl: 'https://github.com/macro-inc/macro/pull/42',
    });
    expect(
      screen.getByRole('link', { name: 'Open pull request #42 on GitHub' })
    ).toBeTruthy();
    expect(screen.queryByText('Open')).toBeNull();
  });

  it('does not substitute a label or starting branch for missing repository metadata', () => {
    const { view, setEntity } = setup();
    setEntity({
      ...conversation,
      repoUrl: undefined,
      workingBranch: undefined,
    });
    expect(screen.queryByText('Coding agent')).toBeNull();
    expect(screen.queryByText('main')).toBeNull();
    expect(
      view.container.querySelector('[data-agent-code-details]')
    ).toBeNull();
    expect(view.container.querySelector('[data-kind="code"]')).toBeTruthy();
  });

  it('combines unread and activity in the Agents left dot while Home keeps its trailing unread dot', () => {
    unreadFilter.mockReturnValue(true);
    const { view, setEntity } = setup();
    const dot = () => screen.getByLabelText('Unread');
    const isLeading = () => !!dot().closest('[data-view-sidebar-icon]');
    expect(isLeading()).toBe(surface === 'sidebar');
    expect(dot().classList.contains('motion-safe:animate-pulse')).toBe(false);

    for (const turnState of ['running', 'blocked', 'idle']) {
      setEntity({ ...conversation, turnState });
      expect(screen.getAllByLabelText('Unread')).toHaveLength(1);
      expect(isLeading()).toBe(surface === 'sidebar');
      expect(
        view.container.querySelectorAll('[data-agent-status-indicator]')
      ).toHaveLength(surface === 'sidebar' ? 1 : 0);
      expect(dot().classList.contains('motion-safe:animate-pulse')).toBe(
        surface === 'sidebar' && turnState === 'running'
      );
      expect(dot().classList.contains('bg-warning')).toBe(
        surface === 'sidebar' && turnState === 'blocked'
      );
    }

    unreadFilter.mockReturnValue(false);
    setEntity({ ...conversation, turnState: 'running' });
    expect(screen.queryByLabelText('Unread')).toBeNull();
    expect(
      view.container.querySelectorAll('[data-agent-status-indicator]')
    ).toHaveLength(surface === 'sidebar' ? 1 : 0);
    setEntity({ ...conversation, turnState: 'idle' });
    expect(
      view.container.querySelector('[data-agent-status-indicator]')
    ).toBeNull();
  });

  it('opens a synced PR in Macro without activating its session', () => {
    const { setEntity, open } = setup();
    setEntity({
      ...conversation,
      pullRequestUrl: 'https://github.com/macro-inc/macro/pull/42',
      pullRequestId: 'pr-entity',
      pullRequestState: 'merged',
    });
    fireEvent.click(
      screen.getByRole('link', { name: 'Open pull request #42, Merged' })
    );
    expect(open).not.toHaveBeenCalled();
    expect(openWithSplit).toHaveBeenLastCalledWith(
      { type: 'pr', id: 'pr-entity' },
      { preferNewSplit: true }
    );
  });
});
