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
import type { AgentConversationEntity } from '../core/recent-conversations';
import { DesktopAgentsSidebar } from './agents-sidebar/agents-sidebar';

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
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    splitHotkeyScope: 'test',
    isPanelActive: () => true,
  }),
}));
vi.mock('@app/features/next-soup/actions', () => ({
  toEntityActionListState: (options: {
    controller: { items: { all: () => { id: string }[] } };
  }) => ({
    focus: {
      set: (id: string) => {
        if (!options.controller.items.all().some((item) => item.id === id)) {
          throw new Error(`Missing action row: ${id}`);
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

vi.mock('./shared/conversation-code-link/conversation-code-link', () => ({
  ConversationCodeLink: () => null,
}));

describe('desktop conversation navigation', () => {
  const rows: AgentConversationEntity[] = [
    {
      type: 'agent_session',
      id: 'waiting',
      name: 'Needs an answer',
      ownerId: 'me',
      botId: 'agent',
      status: 'ready',
      turnState: 'blocked',
    },
    {
      type: 'agent_session',
      id: 'working',
      name: 'Active work',
      ownerId: 'me',
      botId: 'agent',
      status: 'ready',
      turnState: 'running',
    },
    { type: 'chat', id: 'chat', name: 'Saved chat', ownerId: 'me' },
  ];
  const setup = (
    filters: ConversationFilters = EMPTY_CONVERSATION_FILTERS,
    showPrs = false
  ) => {
    const open = vi.fn();
    const openPage = vi.fn();
    const sort = vi.fn();
    const [data, setData] = createSignal(rows);
    const [showOpenPullRequests, setShowOpenPullRequests] =
      createSignal(showPrs);
    render(() => (
      <DesktopAgentsSidebar
        ownerId="me"
        sort="updated"
        onSortChange={sort}
        filters={filters}
        onFilterChange={vi.fn()}
        onClearFilters={vi.fn()}
        activePage="new"
        onOpenPage={openPage}
        onCreateAgent={vi.fn()}
        onCreateRoutine={vi.fn()}
        modeForConversation={(row) => (row.type === 'chat' ? 'chat' : 'code')}
        search=""
        conversations={data()}
        archived={[]}
        loading={false}
        error={false}
        hasNextPage={false}
        loadingNextPage={false}
        showOpenPullRequests={showOpenPullRequests()}
        onSearchChange={vi.fn()}
        showUnlistedRuns={false}
        onShowUnlistedRunsChange={vi.fn()}
        onOpenConversation={open}
        onRetry={vi.fn()}
        onLoadMore={vi.fn()}
        actions={{
          openPullRequest: vi.fn(),
          openBranch: vi.fn(),
          copyBranch: async () => true,
          unarchive: async () => true,
        }}
      />
    ));
    return { open, openPage, sort, setData, setShowOpenPullRequests };
  };

  it('partitions waiting rows once and moves them when the turn resumes', () => {
    const { setData } = setup();
    const waiting = screen.getByRole('region', { name: 'Waiting on you' });
    expect(
      within(waiting).getByRole('button', { name: 'Needs an answer' })
    ).toBeTruthy();
    const conversations = screen.getByRole('navigation', {
      name: 'Conversations',
    });
    expect(
      within(conversations).queryByRole('button', { name: 'Needs an answer' })
    ).toBeNull();
    setData([
      {
        ...rows[0],
        type: 'agent_session',
        botId: 'agent',
        status: 'ready',
        turnState: 'running',
      },
      rows[1],
      rows[2],
    ]);
    expect(screen.queryByRole('region', { name: 'Waiting on you' })).toBeNull();
    expect(
      within(conversations).getByRole('button', { name: 'Needs an answer' })
    ).toBeTruthy();
  });

  it('keeps open-PR sessions in one section across turn and flag changes', () => {
    const { setData, setShowOpenPullRequests } = setup(
      EMPTY_CONVERSATION_FILTERS,
      true
    );
    const waitingPr: AgentConversationEntity = {
      type: 'agent_session',
      id: 'waiting-pr',
      name: 'Waiting PR',
      ownerId: 'me',
      botId: 'agent',
      status: 'ready',
      turnState: 'blocked',
      pullRequestState: 'open',
    };
    const workingPr: AgentConversationEntity = {
      ...waitingPr,
      id: 'working-pr',
      name: 'Working PR',
      turnState: 'running',
    };
    setData([waitingPr, workingPr, rows[2]]);

    const waiting = screen.getByRole('region', { name: 'Waiting on you' });
    const openPrs = screen.getByRole('navigation', {
      name: 'Open pull requests',
    });
    const conversations = screen.getByRole('navigation', {
      name: 'Conversations',
    });
    expect(screen.getAllByRole('button', { name: 'Waiting PR' })).toHaveLength(
      1
    );
    expect(screen.getAllByRole('button', { name: 'Working PR' })).toHaveLength(
      1
    );
    expect(
      within(waiting).getByRole('button', { name: 'Waiting PR' })
    ).toBeTruthy();
    expect(
      within(openPrs).getByRole('button', { name: 'Working PR' })
    ).toBeTruthy();
    expect(
      within(openPrs).queryByRole('button', { name: 'Waiting PR' })
    ).toBeNull();
    expect(
      within(conversations).queryByRole('button', { name: 'Working PR' })
    ).toBeNull();

    setData([{ ...waitingPr, turnState: 'running' }, workingPr, rows[2]]);
    expect(screen.queryByRole('region', { name: 'Waiting on you' })).toBeNull();
    expect(
      within(openPrs).getByRole('button', { name: 'Waiting PR' })
    ).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Waiting PR' })).toHaveLength(
      1
    );

    setShowOpenPullRequests(false);
    expect(
      screen.queryByRole('navigation', { name: 'Open pull requests' })
    ).toBeNull();
    expect(
      within(conversations).getByRole('button', { name: 'Waiting PR' })
    ).toBeTruthy();
    expect(
      within(conversations).getByRole('button', { name: 'Working PR' })
    ).toBeTruthy();
  });

  it('does not bypass conversation filters through the open-PR section', () => {
    const { setData } = setup(
      { type: ['chat'], status: [], pullRequest: [] },
      true
    );
    setData([
      {
        type: 'agent_session',
        id: 'open-pr',
        name: 'Filtered PR',
        ownerId: 'me',
        botId: 'agent',
        status: 'ready',
        pullRequestState: 'open',
      },
      rows[2],
    ]);
    expect(
      screen.queryByRole('navigation', { name: 'Open pull requests' })
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Filtered PR' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Saved chat' })).toBeTruthy();
  });
  it('opens Archived from the footer without losing normal Shift-open', () => {
    const { open, openPage } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }));
    expect(openPage).toHaveBeenCalledWith('archived');
    fireEvent.click(screen.getByRole('button', { name: 'Saved chat' }), {
      shiftKey: true,
    });
    expect(open).toHaveBeenCalledWith(
      rows[2],
      expect.objectContaining({ shiftKey: true })
    );
    expect(screen.queryByRole('button', { name: 'Connections' })).toBeNull();
  });

  it('keeps filters applied to both sections', () => {
    setup({ type: ['chat'], status: [], pullRequest: [] });
    expect(screen.queryByRole('region', { name: 'Waiting on you' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Active work' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Saved chat' })).toBeTruthy();
  });

  it('selects the server sort from the shared menu', async () => {
    const { sort } = setup();
    fireEvent.keyDown(
      screen.getByRole('button', { name: 'Sort conversations' }),
      { key: 'ArrowDown' }
    );
    fireEvent.keyDown(
      await screen.findByRole('menuitemradio', { name: 'Date created' }),
      { key: 'Enter' }
    );
    await waitFor(() => expect(sort).toHaveBeenCalledWith('created'));
  });
});
