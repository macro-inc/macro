import { HomeListEntity } from '@app/features/home/components/HomeListEntity';
import {
  attachGlobalDOMScope,
  useHotKeyRoot,
  useHotkeyDOMScope,
} from '@core/hotkey/hotkeys';
import { setActiveScope } from '@core/hotkey/state';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ConversationFilters,
  EMPTY_CONVERSATION_FILTERS,
} from '../core/conversation-filters';
import {
  type AgentConversationEntity,
  conversationMode,
  partitionArchived,
} from '../core/recent-conversations';
import { AgentsSidebar } from './AgentsSidebar';

const openWithSplit = vi.fn();
const openExternalUrl = vi.hoisted(() => vi.fn());
const unreadFilter = vi.hoisted(() => vi.fn(() => false));
const sidebarState = vi.hoisted(() => ({ agentUpdates: false, touch: false }));
vi.mock('@app/lib/analytics/posthog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@app/lib/analytics/posthog')>()),
  useFeatureFlag: () => () => ({ enabled: sidebarState.agentUpdates }),
}));
vi.mock('@app/features/routine-suggestions/routine-suggestions', () => ({
  SidebarRoutineSuggestions: () => null,
}));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => sidebarState.touch,
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit }),
}));
vi.mock('@core/util/url', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/util/url')>()),
  openExternalUrl,
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
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => ({ mutedEntities: () => [] }),
}));
vi.mock('@core/component/ContextMenu', () => ({
  MenuItem: (props: { text: string; onClick?: () => void }) => (
    <button role="menuitem" onClick={props.onClick}>
      {props.text}
    </button>
  ),
}));
vi.mock('@app/features/home/components/HomeEntityIcon', () => ({
  HomeEntityIcon: () => null,
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'me' }));
vi.mock('@core/user', () => ({
  getDisplayName: () => '',
  tryMacroId: (id: string) => id,
}));

let motionStyles: HTMLStyleElement;
beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  // Menu actions run once the menu has closed, after its exit animation.
  motionStyles = document.createElement('style');
  motionStyles.textContent =
    '[role="menu"] { animation-name: none; transition-duration: 0s; }';
  document.head.append(motionStyles);
});

afterEach(() => {
  cleanup();
  motionStyles.remove();
  localStorage.clear();
  unreadFilter.mockReturnValue(false);
  sidebarState.agentUpdates = false;
  sidebarState.touch = false;
});

vi.mock('@solid-primitives/resize-observer', () => ({
  createResizeObserver: () => {},
}));
const splitPanel = vi.hoisted(() => ({
  splitHotkeyScope: 'test',
  isPanelActive: () => true,
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => splitPanel,
  useSplitPanel: () => splitPanel,
}));
vi.mock('@app/features/next-soup/actions', () => ({
  toEntityActionListState: (options: {
    controller: {
      items: { all: () => unknown[]; keyOf: (item: unknown) => string };
    };
  }) => ({
    focus: {
      set: (key: string) => {
        const { items } = options.controller;
        if (!items.all().some((item) => items.keyOf(item) === key)) {
          throw new Error(`Missing action row: ${key}`);
        }
      },
    },
  }),
}));
vi.mock('@app/features/soup', () => ({
  MaybeSoupEntityActionDrawerManager: (props: { children: JSX.Element }) =>
    props.children,
  SoupEntityContextMenu: (props: {
    children: JSX.Element;
    entity: { id: string };
    extraItems?: JSX.Element;
    onOpenChange?: (open: boolean) => void;
  }) => {
    const [open, setOpen] = createSignal(false);
    return (
      <div
        data-entity-context-menu={props.entity.id}
        onContextMenu={(event) => {
          event.preventDefault();
          setOpen(true);
          props.onOpenChange?.(true);
        }}
      >
        {props.children}
        {open() && (
          <div role="menu">
            <div role="menuitem">Rename</div>
            <div role="menuitem">Favorite</div>
            <div role="menuitem">Copy Link</div>
            <div role="menuitem">Delete</div>
            {props.extraItems}
          </div>
        )}
      </div>
    );
  },
}));
vi.mock('@components/app/split-panel', () => ({
  SplitPanel: { CloseButton: () => null },
}));

describe('mixed Agents sidebar', () => {
  it('lists chat and code conversations together until a filter narrows them', async () => {
    const conversations: AgentConversationEntity[] = [
      {
        type: 'agent_session',
        id: 'code',
        name: 'Fix build',
        ownerId: 'me',
        archivedBy: null,
        botId: 'cursor',
        status: 'acp_ready',
        turnState: 'blocked',
      },
      { type: 'chat', id: 'chat', name: 'Plan launch', ownerId: 'me' },
      {
        type: 'agent_session',
        id: 'archived-code',
        name: 'Old spike',
        ownerId: 'me',
        archivedBy: 'user',
        botId: 'cursor',
        status: 'disconnected',
      },
    ];
    const [filters, setFilters] = createSignal<ConversationFilters>(
      EMPTY_CONVERSATION_FILTERS
    );
    const open = vi.fn();
    const openPage = vi.fn();
    render(() => (
      <AgentsSidebar
        onCreateAgent={vi.fn()}
        onCreateRoutine={vi.fn()}
        filters={filters()}
        grouping="status"
        onFilterChange={vi.fn()}
        onClearFilters={vi.fn()}
        onGroupingChange={vi.fn()}
        activePage="new"
        onOpenPage={openPage}
        {...partitionArchived(conversations)}
        modeForConversation={(conversation) =>
          conversation.type === 'chat' ? 'chat' : 'code'
        }
        activeConversationId="chat"
        search=""
        loading={false}
        error={false}
        hasNextPage={false}
        loadingNextPage={false}
        onSearchChange={vi.fn()}
        showUnlistedRuns={false}
        onShowUnlistedRunsChange={vi.fn()}
        onOpenConversation={open}
        onRetry={vi.fn()}
        onLoadMore={vi.fn()}
      />
    ));
    for (const label of ['Agents', 'Routines', 'Connections']) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(openPage).toHaveBeenLastCalledWith(label.toLowerCase());
    }

    expect(screen.queryByRole('radio', { name: 'Work' })).toBeNull();
    expect(
      screen
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent)
    ).toEqual(['Needs you1', 'Recent']);
    // Archived starts collapsed; its header expands it. It carries no count:
    // it holds only the archived sessions among the pages loaded so far.
    const archivedToggle = screen.getByRole('button', { name: /Archived/ });
    expect(archivedToggle.textContent).toBe('Archived');
    expect(archivedToggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: /Old spike/ })).toBeNull();
    fireEvent.click(archivedToggle);
    expect(archivedToggle.getAttribute('aria-expanded')).toBe('true');
    expect(
      await screen.findByRole('button', { name: /Old spike/ })
    ).toBeTruthy();
    const chat = screen.getByRole('button', { name: /Plan launch/ });
    expect(chat.getAttribute('data-kind')).toBe('chat');
    expect(chat.getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: /Fix build/ })).toBeTruthy();
    fireEvent.click(chat);
    expect(open).toHaveBeenLastCalledWith(conversations[1], expect.anything());

    setFilters({ ...EMPTY_CONVERSATION_FILTERS, type: ['code'] });
    const code = await screen.findByRole('button', { name: /Fix build/ });
    expect(code.closest('[data-kind]')?.getAttribute('data-kind')).toBe('code');
    expect(screen.queryByRole('button', { name: /Plan launch/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Old spike/ })).toBeTruthy();
    fireEvent.click(code, { shiftKey: true });
    expect(open).toHaveBeenLastCalledWith(conversations[0], true);

    setFilters({ ...EMPTY_CONVERSATION_FILTERS, status: ['waiting'] });
    expect(screen.getByRole('button', { name: /Fix build/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Plan launch/ })).toBeNull();
    expect(screen.queryByText('Archived')).toBeNull();

    fireEvent.keyDown(
      screen.getByRole('button', { name: 'New conversation or agent' }),
      { key: 'ArrowDown' }
    );
    fireEvent.keyDown(
      await screen.findByRole('menuitem', { name: 'Conversation' }),
      { key: 'Enter' }
    );
    await Promise.resolve();
    await waitFor(() => expect(openPage).toHaveBeenCalledWith('new'));
  });

  it('keeps paging while filters leave too few conversations to scroll', () => {
    const loadMore = vi.fn();
    const clear = vi.fn();
    render(() => (
      <AgentsSidebar
        onCreateAgent={vi.fn()}
        onCreateRoutine={vi.fn()}
        filters={{ ...EMPTY_CONVERSATION_FILTERS, type: ['code'] }}
        grouping="none"
        onFilterChange={vi.fn()}
        onClearFilters={clear}
        onGroupingChange={vi.fn()}
        activePage="new"
        onOpenPage={vi.fn()}
        conversations={[
          { type: 'chat', id: 'chat', name: 'Plan launch', ownerId: 'me' },
        ]}
        archived={[]}
        modeForConversation={() => 'chat'}
        activeConversationId={undefined}
        search=""
        loading={false}
        error={false}
        hasNextPage
        loadingNextPage={false}
        onSearchChange={vi.fn()}
        showUnlistedRuns={false}
        onShowUnlistedRunsChange={vi.fn()}
        onOpenConversation={vi.fn()}
        onRetry={vi.fn()}
        onLoadMore={loadMore}
      />
    ));
    expect(loadMore).toHaveBeenCalledOnce();
    expect(
      screen.getByText('No conversations match these filters.')
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(clear).toHaveBeenCalledOnce();
  });

  it('toggles hidden routine runs from the filter menu and marks the runs it lists', async () => {
    const [show, setShow] = createSignal(false);
    const change = vi.fn(setShow);
    const clear = vi.fn();
    render(() => (
      <AgentsSidebar
        onCreateAgent={vi.fn()}
        onCreateRoutine={vi.fn()}
        filters={EMPTY_CONVERSATION_FILTERS}
        grouping="none"
        onFilterChange={vi.fn()}
        onClearFilters={clear}
        onGroupingChange={vi.fn()}
        activePage="new"
        onOpenPage={vi.fn()}
        conversations={[
          {
            type: 'agent_session',
            id: 'run',
            name: 'Morning digest',
            ownerId: 'me',
            archivedBy: null,
            botId: 'macro',
            status: 'acp_ready',
            source: 'routine',
          },
          {
            type: 'agent_session',
            id: 'mine',
            name: 'Plan launch',
            ownerId: 'me',
            archivedBy: null,
            botId: 'macro',
            status: 'acp_ready',
          },
        ]}
        archived={[]}
        modeForConversation={() => 'chat'}
        activeConversationId={undefined}
        search=""
        loading={false}
        error={false}
        hasNextPage={false}
        loadingNextPage={false}
        onSearchChange={vi.fn()}
        showUnlistedRuns={show()}
        onShowUnlistedRunsChange={change}
        onOpenConversation={vi.fn()}
        onRetry={vi.fn()}
        onLoadMore={vi.fn()}
      />
    ));

    const run = screen
      .getByRole('button', { name: 'Morning digest' })
      .closest('[data-agent-session-row]');
    expect(run?.querySelector('[aria-label="Routine run"]')).toBeTruthy();
    const mine = screen
      .getByRole('button', { name: 'Plan launch' })
      .closest('[data-agent-session-row]');
    expect(mine?.querySelector('[aria-label="Routine run"]')).toBeNull();

    const filterMenu = screen.getByRole('button', {
      name: 'Filter conversations',
    });
    // Tooltip portals also leave an empty hidden span beside the trigger.
    const badge = () =>
      filterMenu.parentElement &&
      within(filterMenu.parentElement).queryByText(/^\d+$/);
    const openOption = async (name: string, role = 'menuitem') => {
      fireEvent.keyDown(filterMenu, { key: 'ArrowDown' });
      return screen.findByRole(role, { name });
    };

    expect(badge()).toBeNull();
    fireEvent.keyDown(
      await openOption('Show hidden routine runs', 'menuitemcheckbox'),
      { key: 'Enter' }
    );
    await waitFor(() => expect(change).toHaveBeenLastCalledWith(true));
    expect(badge()?.textContent).toBe('1');

    await waitFor(() =>
      expect(filterMenu.getAttribute('aria-expanded')).toBe('false')
    );
    fireEvent.keyDown(await openOption('Clear filters'), { key: 'Enter' });
    await waitFor(() => expect(clear).toHaveBeenCalledOnce());
    expect(change).toHaveBeenLastCalledWith(false);
    expect(badge()).toBeNull();
  });

  it('opens rename and delete on a session or chat right-click', async () => {
    render(() => (
      <AgentsSidebar
        onCreateAgent={vi.fn()}
        onCreateRoutine={vi.fn()}
        filters={EMPTY_CONVERSATION_FILTERS}
        grouping="none"
        onFilterChange={vi.fn()}
        onClearFilters={vi.fn()}
        onGroupingChange={vi.fn()}
        activePage="new"
        onOpenPage={vi.fn()}
        {...partitionArchived([
          {
            type: 'agent_session',
            id: 'code',
            name: 'Fix build',
            ownerId: 'me',
            archivedBy: null,
            botId: 'cursor',
            status: 'acp_ready',
          },
          {
            type: 'agent_session',
            id: 'archived',
            name: 'Old session',
            ownerId: 'me',
            archivedBy: 'user',
            botId: 'cursor',
            status: 'disconnected',
          },
          { type: 'chat', id: 'chat', name: 'Plan launch', ownerId: 'me' },
        ])}
        modeForConversation={() => 'chat'}
        activeConversationId={undefined}
        search=""
        loading={false}
        error={false}
        hasNextPage={false}
        loadingNextPage={false}
        onSearchChange={vi.fn()}
        showUnlistedRuns={false}
        onShowUnlistedRunsChange={vi.fn()}
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
    // Archive and Unarchive come from the shared entity menu, like Search's.
    expect(screen.getByText('Archived')).toBeTruthy();

    const chat = screen.getByRole('button', { name: /Plan launch/ });
    fireEvent.contextMenu(chat);
    const chatMenu = within(
      chat.closest('[data-entity-context-menu]') as HTMLElement
    );
    expect(chatMenu.getByRole('menuitem', { name: 'Rename' })).toBeTruthy();
    expect(chatMenu.getByRole('menuitem', { name: 'Delete' })).toBeTruthy();
  });
});

describe('Open PRs sidebar section', () => {
  const open: AgentConversationEntity = {
    type: 'agent_session',
    id: 'open-pr',
    name: 'Fix build',
    ownerId: 'me',
    botId: 'cursor',
    harness: 'cursor',
    status: 'acp_ready',
    turnState: 'running',
    updatedAt: '2026-10-29T10:00:00Z',
    pullRequestState: 'open',
    pullRequestUrl: 'https://github.com/macro-inc/macro/pull/42',
    repoUrl: 'https://github.com/macro-inc/macro.git',
    workingBranch: 'fix/build',
  };
  const draft: AgentConversationEntity = {
    ...open,
    id: 'draft-pr',
    name: 'Add tests',
    updatedAt: '2026-10-30T10:00:00Z',
    pullRequestState: 'draft',
    pullRequestUrl: 'https://github.com/macro-inc/macro/pull/43',
  };
  const conversations: AgentConversationEntity[] = [
    open,
    { ...open, id: 'merged-pr', name: 'Merged PR', pullRequestState: 'merged' },
    { ...open, id: 'closed-pr', name: 'Closed PR', pullRequestState: 'closed' },
    { ...open, id: 'archived-pr', name: 'Archived PR', archivedBy: 'user' },
    {
      ...open,
      id: 'chat-mode-pr',
      name: 'Chat mode PR',
      harness: 'in-memory',
    },
    { type: 'chat', id: 'chat', name: 'Plain chat', ownerId: 'me' },
    draft,
  ];

  function renderSidebar(
    items: AgentConversationEntity[],
    filters: ConversationFilters = EMPTY_CONVERSATION_FILTERS
  ) {
    const onOpenConversation = vi.fn();
    render(() => (
      <AgentsSidebar
        filters={filters}
        grouping="none"
        onFilterChange={vi.fn()}
        onClearFilters={vi.fn()}
        onGroupingChange={vi.fn()}
        activePage="new"
        onOpenPage={vi.fn()}
        conversations={items}
        archived={[]}
        modeForConversation={(conversation) =>
          conversationMode(conversation, () => 'agent')
        }
        activeConversationId="open-pr"
        search=""
        loading={false}
        error={false}
        hasNextPage={false}
        loadingNextPage={false}
        onSearchChange={vi.fn()}
        onOpenConversation={onOpenConversation}
        onRetry={vi.fn()}
        onLoadMore={vi.fn()}
        onCreateAgent={vi.fn()}
        onCreateRoutine={vi.fn()}
        showUnlistedRuns={false}
        onShowUnlistedRunsChange={vi.fn()}
      />
    ));
    return onOpenConversation;
  }

  it('shows open and draft coding PRs in update order with the existing rows and navigation', () => {
    sidebarState.agentUpdates = true;
    const onOpenConversation = renderSidebar(conversations);
    const section = screen.getByRole('navigation', {
      name: 'Open pull requests',
    });
    expect(screen.getByRole('button', { name: 'Open PRs 2' })).toBeTruthy();
    expect(
      within(section)
        .getAllByRole('button')
        .map((row) => row.getAttribute('aria-label'))
    ).toEqual(['Add tests', 'Fix build']);
    expect(within(section).getByText('#42')).toBeTruthy();
    expect(
      within(section).getAllByText('macro-inc/macro · fix/build')
    ).toHaveLength(2);
    expect(
      section.querySelectorAll('[data-agent-status-indicator]')
    ).toHaveLength(2);
    expect(
      within(section)
        .getByRole('button', { name: 'Fix build' })
        .getAttribute('aria-current')
    ).toBe('page');
    for (const name of [
      'Merged PR',
      'Closed PR',
      'Archived PR',
      'Chat mode PR',
      'Plain chat',
    ]) {
      expect(within(section).queryByRole('button', { name })).toBeNull();
    }
    expect(
      within(
        screen.getByRole('navigation', { name: 'Recent conversations' })
      ).getByRole('button', { name: 'Fix build' })
    ).toBeTruthy();

    const draftRow = within(section).getByRole('button', { name: 'Add tests' });
    expect(draftRow.closest('[data-entity-context-menu]')).not.toBeNull();
    fireEvent.click(draftRow);
    expect(onOpenConversation).toHaveBeenCalledWith(draft, expect.anything());
  });

  it('hides the section when the flag is off or there are no matching sessions', () => {
    renderSidebar(conversations);
    expect(screen.queryByText('Open PRs')).toBeNull();
    cleanup();

    sidebarState.agentUpdates = true;
    renderSidebar(
      conversations.filter(
        (conversation) =>
          conversation.id !== 'open-pr' && conversation.id !== 'draft-pr'
      )
    );
    expect(screen.queryByText('Open PRs')).toBeNull();
  });

  it('keeps PR context actions available when conversation filters exclude the row', () => {
    sidebarState.agentUpdates = true;
    renderSidebar([open], { ...EMPTY_CONVERSATION_FILTERS, type: ['chat'] });
    const section = screen.getByRole('navigation', {
      name: 'Open pull requests',
    });
    const row = within(section).getByRole('button', { name: 'Fix build' });
    expect(row.closest('[data-entity-context-menu]')).not.toBeNull();
  });

  it('uses the same PR rows in the touch list view', () => {
    sidebarState.agentUpdates = true;
    sidebarState.touch = true;
    const onOpenConversation = renderSidebar([open]);
    const section = screen.getByRole('navigation', {
      name: 'Open pull requests',
    });
    fireEvent.click(within(section).getByRole('button', { name: 'Fix build' }));
    expect(onOpenConversation).toHaveBeenCalledWith(open, expect.anything());
  });
});

describe.each(['home', 'sidebar'] as const)('%s agent rows', (surface) => {
  const conversation: AgentConversationEntity = {
    type: 'agent_session',
    id: 'coding-session',
    name: 'Fix build',
    ownerId: 'me',
    archivedBy: null,
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
          onCreateAgent={vi.fn()}
          onCreateRoutine={vi.fn()}
          filters={EMPTY_CONVERSATION_FILTERS}
          grouping="none"
          onFilterChange={vi.fn()}
          onClearFilters={vi.fn()}
          onGroupingChange={vi.fn()}
          activePage="new"
          onOpenPage={vi.fn()}
          conversations={[entity()]}
          archived={[]}
          modeForConversation={() => 'code'}
          activeConversationId={undefined}
          search=""
          loading={false}
          error={false}
          hasNextPage={false}
          loadingNextPage={false}
          onSearchChange={vi.fn()}
          showUnlistedRuns={false}
          onShowUnlistedRunsChange={vi.fn()}
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
    const newSplit =
      surface === 'home'
        ? open.mock.calls[0][0].shiftKey
        : open.mock.calls[0][1];
    expect(newSplit).toBe(true);
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
    if (surface === 'home') {
      expect(icon()?.querySelector('svg') !== null).toBe(true);
    } else {
      expect(icon()).toBeNull();
    }
    expect(
      view.container.querySelector('[data-agent-status-indicator]')
    ).toBeNull();
    setEntity({ ...conversation, turnState: 'running' });
    expect(
      screen
        .getByRole('button', { name: 'Fix build' })
        .getAttribute('aria-description')
    ).toBe('Working');
    if (surface === 'home') {
      expect(icon()?.querySelector('svg') !== null).toBe(true);
    }
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

  it('hides the leading icon slot in the sidebar for a tighter row', () => {
    if (surface !== 'sidebar') return;
    const { view } = setup();
    const row = view.container.querySelector('[data-agent-session-row]');
    expect(row?.querySelector('[data-view-sidebar-icon]')).toBeNull();
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

  it('combines unread and activity in the Agents dot while Home keeps its trailing unread dot', () => {
    unreadFilter.mockReturnValue(true);
    const { view, setEntity } = setup();
    const dot = () => screen.getByLabelText('Unread');
    const isInCodeDetails = () => !!dot().closest('[data-agent-code-details]');
    const isTrailing = () =>
      !dot().closest('[data-view-sidebar-icon]') &&
      !dot().closest('[data-agent-code-details]');
    expect(dot().classList.contains('motion-safe:animate-pulse')).toBe(false);

    for (const turnState of ['running', 'blocked', 'idle']) {
      setEntity({ ...conversation, turnState });
      expect(screen.getAllByLabelText('Unread')).toHaveLength(1);
      expect(
        view.container.querySelectorAll('[data-agent-status-indicator]')
      ).toHaveLength(surface === 'sidebar' ? 1 : 0);
      if (surface === 'sidebar') {
        expect(isInCodeDetails()).toBe(true);
      } else {
        expect(isTrailing()).toBe(true);
      }
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

  it('opens a synced PR on GitHub without activating its session', () => {
    const { setEntity, open } = setup();
    setEntity({
      ...conversation,
      pullRequestUrl: 'https://github.com/macro-inc/macro/pull/42',
      pullRequestId: 'pr-entity',
      pullRequestState: 'merged',
    });
    openWithSplit.mockClear();
    fireEvent.click(
      screen.getByRole('link', {
        name: 'Open pull request #42, Merged on GitHub',
      })
    );
    expect(open).not.toHaveBeenCalled();
    expect(openExternalUrl).toHaveBeenLastCalledWith(
      'https://github.com/macro-inc/macro/pull/42'
    );
    expect(openWithSplit).not.toHaveBeenCalled();
  });
});

describe('Agents sidebar keyboard list', () => {
  const conversations: AgentConversationEntity[] = [
    {
      type: 'agent_session',
      id: 'build',
      name: 'Fix build',
      ownerId: 'me',
      archivedBy: null,
      botId: 'macro',
      status: 'acp_ready',
    },
    { type: 'chat', id: 'launch', name: 'Plan launch', ownerId: 'me' },
    {
      type: 'agent_session',
      id: 'notes',
      name: 'Summarize notes',
      ownerId: 'me',
      archivedBy: null,
      botId: 'macro',
      status: 'acp_ready',
    },
  ];

  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    setActiveScope('global');
    splitPanel.splitHotkeyScope = 'test';
  });

  // The hotkey engine tracks held keys, so every press is released, where
  // focus went: an emptied field closes as the keyboard leaves it.
  function press(target: Element, key: string, init: KeyboardEventInit = {}) {
    fireEvent.keyDown(target, { key, ...init });
    fireEvent.keyUp(document.activeElement ?? document, { key, ...init });
  }

  function setup(
    options: {
      conversations?: AgentConversationEntity[];
      archived?: AgentConversationEntity[];
      grouping?: 'none' | 'status';
      hasNextPage?: boolean;
    } = {}
  ) {
    const [search, setSearch] = createSignal('');
    const open = vi.fn();
    const loadMore = vi.fn();
    let detail!: HTMLDivElement;

    // The split holds the sidebar and, beside it, the conversation it opened.
    function Harness() {
      useHotKeyRoot();
      const [attachSplit, scopeId] = useHotkeyDOMScope('agents-split');
      splitPanel.splitHotkeyScope = scopeId;
      return (
        <div ref={(element) => attachGlobalDOMScope(element)}>
          <div ref={attachSplit}>
            <div data-view-shell-aside="">
              <AgentsSidebar
                onCreateAgent={vi.fn()}
                onCreateRoutine={vi.fn()}
                filters={EMPTY_CONVERSATION_FILTERS}
                grouping={options.grouping ?? 'none'}
                onFilterChange={vi.fn()}
                onClearFilters={vi.fn()}
                onGroupingChange={vi.fn()}
                activePage="new"
                onOpenPage={vi.fn()}
                conversations={options.conversations ?? conversations}
                archived={options.archived ?? []}
                modeForConversation={(conversation) =>
                  conversation.type === 'agent_session' &&
                  conversation.pullRequestUrl
                    ? 'code'
                    : 'chat'
                }
                activeConversationId={undefined}
                search={search()}
                loading={false}
                error={false}
                hasNextPage={options.hasNextPage ?? false}
                loadingNextPage={false}
                onSearchChange={setSearch}
                showUnlistedRuns={false}
                onShowUnlistedRunsChange={vi.fn()}
                onOpenConversation={open}
                onRetry={vi.fn()}
                onLoadMore={loadMore}
              />
            </div>
            <div ref={detail} tabIndex={0} />
          </div>
        </div>
      );
    }

    render(() => <Harness />);
    const list = () => screen.getByRole('group', { name: 'Conversations' });
    // The name a screen reader reads for the row the list points at.
    const focusedRow = () => {
      const row = document.getElementById(
        list().getAttribute('aria-activedescendant') ?? ''
      );
      return row?.getAttribute('aria-label') ?? row?.textContent;
    };
    const enterList = async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Search conversations' })
      );
      const field = await screen.findByRole('searchbox', {
        name: 'Search conversations',
      });
      field.focus();
      press(field, 'ArrowDown');
      return field;
    };
    return {
      search,
      setSearch,
      open,
      loadMore,
      list,
      focusedRow,
      enterList,
      detail: () => detail,
    };
  }

  it('moves from the search field into the results and keeps the search on Escape', async () => {
    const { search, setSearch, list, focusedRow } = setup();
    fireEvent.click(
      screen.getByRole('button', { name: 'Search conversations' })
    );
    const field = await screen.findByRole('searchbox', {
      name: 'Search conversations',
    });
    setSearch('fix');
    field.focus();

    press(field, 'ArrowDown');
    expect(document.activeElement).toBe(list());
    expect(focusedRow()).toContain('Fix build');

    field.focus();
    press(field, 'Escape');
    expect(document.activeElement).toBe(list());
    expect(search()).toBe('fix');

    press(list(), 'Escape');
    expect(search()).toBe('');
  });

  it('walks the rows with j, k and the arrows, and opens the focused one with Enter', async () => {
    const { open, list, focusedRow, enterList } = setup();
    await enterList();
    expect(focusedRow()).toBe('Fix build');

    press(list(), 'j');
    expect(focusedRow()).toContain('Plan launch');
    press(list(), 'ArrowDown');
    expect(focusedRow()).toBe('Summarize notes');
    press(list(), 'k');
    expect(focusedRow()).toContain('Plan launch');

    press(list(), 'Enter');
    expect(open).toHaveBeenLastCalledWith(conversations[1], false);
    press(list(), 'Enter', { shiftKey: true });
    expect(open).toHaveBeenLastCalledWith(conversations[1], true);

    press(list(), 'ArrowUp');
    expect(focusedRow()).toBe('Fix build');
  });

  it('follows the rows on screen across open PRs, status groups and archived, and skips a collapsed section', async () => {
    sidebarState.agentUpdates = true;
    const pullRequest: AgentConversationEntity = {
      type: 'agent_session',
      id: 'pr',
      name: 'Ship parser',
      ownerId: 'me',
      archivedBy: null,
      botId: 'cursor',
      status: 'acp_ready',
      turnState: 'idle',
      pullRequestState: 'open',
      pullRequestUrl: 'https://github.com/example/repo/pull/7',
    };
    const waiting: AgentConversationEntity = {
      type: 'agent_session',
      id: 'waiting',
      name: 'Answer question',
      ownerId: 'me',
      archivedBy: null,
      botId: 'macro',
      status: 'acp_ready',
      turnState: 'blocked',
    };
    const { list, focusedRow, enterList } = setup({
      grouping: 'status',
      conversations: [pullRequest, waiting],
      archived: [
        {
          type: 'agent_session',
          id: 'old',
          name: 'Old spike',
          ownerId: 'me',
          archivedBy: 'user',
          botId: 'macro',
          status: 'disconnected',
        },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: /Archived/ }));
    await screen.findByRole('button', { name: 'Old spike' });

    await enterList();
    const visited = [focusedRow()];
    for (let step = 0; step < 3; step++) {
      press(list(), 'j');
      visited.push(focusedRow());
    }
    // The open PR lists twice: in Open PRs, then in its status group.
    expect(visited).toEqual([
      'Ship parser',
      'Answer question',
      'Ship parser',
      'Old spike',
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Conversations' }));
    press(list(), 'Home');
    press(list(), 'j');
    expect(focusedRow()).toBe('Old spike');
  });

  it('lists a conversation that arrives twice once, in the state it last arrived in', async () => {
    const { list, focusedRow, enterList } = setup({
      grouping: 'status',
      conversations: [
        {
          type: 'agent_session',
          id: 'twice',
          name: 'Review draft',
          ownerId: 'me',
          archivedBy: null,
          botId: 'macro',
          status: 'acp_ready',
          turnState: 'blocked',
        },
        conversations[1],
        {
          type: 'agent_session',
          id: 'twice',
          name: 'Review draft',
          ownerId: 'me',
          archivedBy: null,
          botId: 'macro',
          status: 'acp_ready',
          turnState: 'idle',
        },
      ],
    });
    expect(
      screen.getAllByRole('button', { name: 'Review draft' })
    ).toHaveLength(1);
    expect(
      screen
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent)
    ).toEqual(['Recent2']);

    await enterList();
    expect(focusedRow()).toBe('Review draft');
    press(list(), 'j');
    expect(focusedRow()).toContain('Plan launch');
  });

  it('loads the next page as the keyboard nears the last rows', async () => {
    const many: AgentConversationEntity[] = Array.from(
      { length: 24 },
      (_, index) => ({
        type: 'chat',
        id: `chat-${index}`,
        name: `Chat ${index}`,
        ownerId: 'me',
      })
    );
    const { list, loadMore, enterList, focusedRow } = setup({
      conversations: many,
      hasNextPage: true,
    });
    await enterList();
    for (let step = 0; step < 19; step++) press(list(), 'j');
    expect(focusedRow()).toContain('Chat 19');
    expect(loadMore).not.toHaveBeenCalled();

    press(list(), 'j');
    expect(focusedRow()).toContain('Chat 20');
    expect(loadMore).toHaveBeenCalledOnce();
  });

  it('moves on from a row reached with Tab', async () => {
    const { list, focusedRow, enterList } = setup();
    await enterList();
    expect(focusedRow()).toBe('Fix build');

    screen.getByRole('button', { name: 'Summarize notes' }).focus();
    press(document.activeElement ?? list(), 'k');
    expect(document.activeElement).toBe(list());
    expect(focusedRow()).toContain('Plan launch');
  });

  it('leaves keys pressed in the conversation beside it alone', async () => {
    const { open, focusedRow, detail, enterList } = setup();
    await enterList();
    expect(focusedRow()).toBe('Fix build');

    detail().focus();
    press(detail(), 'j');
    press(detail(), 'Enter');
    expect(focusedRow()).toBe('Fix build');
    expect(open).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(detail());
  });
});
