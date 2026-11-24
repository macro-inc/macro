// The shell portal host is outside this collection-composition test.
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type ConversationFilters,
  EMPTY_CONVERSATION_FILTERS,
} from './core/conversation-filters';
import type { AgentConversationEntity } from './core/recent-conversations';
import { PhoneAgentsList } from './phone-list';

const headerMeasurement = vi.hoisted(() => ({
  height: 60,
  notify: undefined as (() => void) | undefined,
}));
const favoriteRows = vi.hoisted(() => ({
  items: [] as { entityType: string; entityId: string }[],
}));

vi.stubGlobal(
  'ResizeObserver',
  class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(element: HTMLElement) {
      if (element.hasAttribute('data-mobile-list-header')) {
        headerMeasurement.notify = () =>
          this.callback(
            [
              {
                target: element,
                contentRect: element.getBoundingClientRect(),
                borderBoxSize: [],
                contentBoxSize: [],
                devicePixelContentBoxSize: [],
              },
            ],
            this
          );
      }
    }
    unobserve() {}
    disconnect() {}
  }
);

vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => true,
}));
vi.mock('@app/components/view-shell', async () => ({
  SearchBar: (await import('../../components/view-shell/SearchBar')).SearchBar,
  ViewShell: {
    TopBar: (props: { children: JSX.Element; navigation: JSX.Element }) => (
      <div>
        {props.navigation}
        {props.children}
      </div>
    ),
    TopBarActions: (props: { children: JSX.Element }) => (
      <div>{props.children}</div>
    ),
    TopBarIsland: (props: { children: JSX.Element }) => (
      <div>{props.children}</div>
    ),
  },
  ViewSidebar: { Toggle: () => <button aria-label="Show sidebar" /> },
}));
vi.mock('@queries/favorites/favorites', () => ({
  useFavoritesData: () => () => ({ favorites: favoriteRows.items }),
}));
vi.mock('@app/features/soup', () => ({
  MaybeSoupEntityActionDrawerManager: (props: { children: JSX.Element }) =>
    props.children,
}));
vi.mock(
  './views/shared/conversation-context-menu/conversation-context-menu',
  () => ({
    ConversationContextMenu: (props: { children: JSX.Element }) =>
      props.children,
  })
);
vi.mock('./views/shared/phone-conversation-row/phone-conversation-row', () => ({
  PhoneConversationRow: (props: { conversation: AgentConversationEntity }) => (
    <div>{props.conversation.name}</div>
  ),
}));
vi.mock('./views/mobile/filters/filters', () => ({
  ConversationFiltersDrawer: () => <button>Filter conversations</button>,
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  headerMeasurement.height = 60;
  headerMeasurement.notify = undefined;
  favoriteRows.items = [];
});

function Harness(props: {
  archived?: boolean;
  loading?: boolean;
  hasNextPage?: boolean;
  rows?: AgentConversationEntity[];
  focus?: () => void;
  filters?: ConversationFilters;
}) {
  const [search, setSearch] = createSignal('');
  return (
    <PhoneAgentsList
      archived={!!props.archived}
      conversations={props.archived ? [] : (props.rows ?? [])}
      archivedRows={props.archived ? (props.rows ?? []) : []}
      archivedTotalCount={props.archived ? (props.rows?.length ?? 0) : 0}
      conversationTotalCount={props.archived ? 0 : (props.rows?.length ?? 0)}
      roster={[]}
      rosterLoading={false}
      search={search()}
      onSearchChange={setSearch}
      filters={props.filters ?? EMPTY_CONVERSATION_FILTERS}
      onFilterChange={() => {}}
      onClearFilters={() => {}}
      showUnlistedRuns={false}
      onShowUnlistedRunsChange={() => {}}
      modeForConversation={() => 'chat'}
      loading={!!props.loading}
      error={false}
      hasNextPage={!!props.hasNextPage}
      loadingNextPage={false}
      onLoadMore={() => {}}
      onRetry={() => {}}
      onOpenConversation={() => {}}
      onSelectAgent={() => {}}
      onCreateAgent={() => {}}
      onFocusComposer={props.focus ?? (() => {})}
      actions={{
        openPullRequest: () => {},
        openBranch: () => {},
        copyBranch: async () => true,
        unarchive: async () => true,
      }}
    />
  );
}

describe('phone Agents list', () => {
  it.each([false, true])(
    'reserves the measured island row once on the list scroller (archived=%s)',
    (archived) => {
      vi.spyOn(
        HTMLElement.prototype,
        'getBoundingClientRect'
      ).mockImplementation(function (this: HTMLElement) {
        return new DOMRect(
          0,
          0,
          390,
          this.hasAttribute('data-mobile-list-header')
            ? headerMeasurement.height
            : 844
        );
      });
      const { container } = render(() => <Harness archived={archived} />);
      const layout = container.querySelector<HTMLElement>(
        '[data-mobile-list-layout]'
      )!;
      const heading = screen
        .getByRole('heading', {
          name: archived ? 'Archived' : 'Conversations',
        })
        .closest('header')!;
      const scroller = heading.closest('[data-agents-list-scroll]')!;
      expect(layout.style.getPropertyValue('--mobile-content-inset-top')).toBe(
        '60px'
      );
      expect(scroller.className).toContain('pt-(--mobile-content-inset-top)');
      expect(
        scroller.querySelector('.h-\\(--mobile-content-inset-top\\)')
      ).toBeNull();
      expect(heading.parentElement?.tagName).toBe('SECTION');
      expect(heading.className).toContain('top-(--mobile-content-inset-top)');
      const verticalScrollers = Array.from(
        container.querySelectorAll('[class]')
      ).filter((element) => element.classList.contains('overflow-y-auto'));
      expect(verticalScrollers).toEqual([scroller]);

      headerMeasurement.height = 76;
      headerMeasurement.notify?.();
      expect(layout.style.getPropertyValue('--mobile-content-inset-top')).toBe(
        '76px'
      );
    }
  );
  it('shows the conversation empty panel after the bubbles and sticky heading, and focuses the existing composer', () => {
    const focus = vi.fn();
    render(() => <Harness focus={focus} />);
    const heading = screen.getByRole('heading', { name: 'Conversations' });
    expect(heading.closest('header')?.className).toContain(
      'sticky top-(--mobile-content-inset-top)'
    );
    expect(
      screen
        .getByRole('button', { name: 'New agent' })
        .compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.getByText('No conversations yet')).toBeTruthy();
    expect(screen.queryByText('Your agents')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Search conversations' })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Filter conversations' })
    ).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'Start a conversation' })
    );
    expect(focus).toHaveBeenCalledOnce();
  });

  it('bounds sticky headings by their own rows instead of neighboring cards', () => {
    favoriteRows.items = [
      { entityType: 'agent_session', entityId: 'favorite' },
    ];
    const { container } = render(() => (
      <Harness
        rows={[
          {
            type: 'agent_session',
            id: 'waiting',
            botId: 'agent',
            name: 'Waiting session',
            ownerId: 'owner',
            status: 'acp_ready',
            turnState: 'blocked',
          },
          {
            type: 'agent_session',
            id: 'recent',
            botId: 'agent',
            name: 'Recent session',
            ownerId: 'owner',
            status: 'acp_ready',
            turnState: 'complete',
          },
          {
            type: 'agent_session',
            id: 'favorite',
            botId: 'agent',
            name: 'Favorite session',
            ownerId: 'owner',
            status: 'acp_ready',
            turnState: 'complete',
          },
        ]}
      />
    ));
    const bubbles = screen.getByRole('button', { name: 'New agent' });
    const heading = screen.getByRole('heading', { name: 'Conversations' });
    const waiting = screen.getByRole('region', { name: 'Waiting on you' });
    const row = screen.getByText('Recent session');
    const favorites = screen.getByRole('region', { name: 'Favorites' });
    for (const [before, after] of [
      [bubbles, waiting],
      [waiting, favorites],
      [favorites, heading],
      [heading, row],
    ]) {
      expect(
        before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    }
    expect(
      screen.getAllByRole('heading', { name: 'Conversations' })
    ).toHaveLength(1);
    const sticky = heading.closest('header');
    expect(sticky?.className).toContain(
      'sticky top-(--mobile-content-inset-top)'
    );
    expect(sticky?.className).toContain('bg-panel');
    expect(heading.className).toContain('text-[20px]/[26px]');
    const conversations = screen.getByRole('region', { name: 'Conversations' });
    expect(sticky?.parentElement).toBe(conversations);
    expect(row.closest('section')).toBe(conversations);
    for (const section of [waiting, favorites, conversations]) {
      const header = section.querySelector('header')!;
      expect(header.parentElement).toBe(section);
      expect(header.classList.contains('sticky')).toBe(true);
      expect(section.className).not.toContain('overflow');
    }
    const list = container.querySelector('[data-agents-list-scroll]')!;
    expect(list.querySelectorAll('header')).toHaveLength(3);
    for (const element of list.querySelectorAll('section, header')) {
      expect(
        [...element.classList].filter((name) => /^-?m[trblxyse]?-/.test(name))
      ).toEqual([]);
    }
    expect(
      container.querySelectorAll('[data-mobile-list-header]')
    ).toHaveLength(1);
    expect(
      container.querySelector('[data-mobile-list-layout]')?.parentElement
        ?.className
    ).toContain('flex size-full min-h-0 flex-col');
  });

  it('keeps the search trigger square and expands the field only after activation', () => {
    render(() => <Harness hasNextPage />);
    const trigger = screen.getByRole('button', {
      name: 'Search conversations',
    });
    expect(trigger.className).toContain('w-10');
    expect(trigger.className).toContain('h-10');
    expect(trigger.className).toContain('px-0');
    expect(screen.queryByRole('searchbox')).toBeNull();
    fireEvent.click(trigger);
    const search = screen.getByRole('searchbox');
    fireEvent.input(search, { target: { value: 'Session' } });
    expect(search.getAttribute('type')).toBe('search');
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Search conversations' })
    ).toBeTruthy();
  });

  it('keeps active archive search reachable when the last archived row disappears', () => {
    const [rows, setRows] = createSignal<AgentConversationEntity[]>([
      {
        type: 'agent_session',
        id: 'archived',
        status: 'acp_ready',
        botId: 'agent',
        name: 'Archived session',
        ownerId: 'owner',
      },
    ]);
    render(() => <Harness archived rows={rows()} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Search conversations' })
    );
    const search = screen.getByRole('searchbox');
    fireEvent.input(search, { target: { value: 'missing' } });
    setRows([]);
    expect(screen.getByRole('searchbox')).toBe(search);
    expect(screen.queryByText('No archived conversations')).toBeNull();
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(screen.getByText('No archived conversations')).toBeTruthy();
  });

  it('shows the archive empty state despite retained filters and hides the search and filter controls', () => {
    render(() => (
      <Harness
        archived
        filters={{ ...EMPTY_CONVERSATION_FILTERS, status: ['unread'] }}
      />
    ));
    expect(screen.getByRole('status').textContent).toContain(
      'No archived conversations'
    );
    expect(
      screen.queryByRole('button', { name: 'Search conversations' })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Filter conversations' })
    ).toBeNull();
    expect(
      screen.getByRole('heading', { name: 'Archived' }).parentElement
        ?.textContent
    ).toBe('Archived');
    const graphic = screen
      .getByRole('status')
      .querySelector('.empty-state-graphic');
    expect(graphic?.className).toContain('opacity-70');
    expect(screen.getByRole('status').querySelector('button')).toBeNull();
  });

  it('shows the archived empty panel without bubbles, an action, or Back', () => {
    render(() => <Harness archived />);
    expect(screen.getByRole('heading', { name: 'Archived' })).toBeTruthy();
    const heading = screen.getByRole('heading', { name: 'Archived' });
    const header = heading.closest('header');
    expect(header?.classList.contains('px-3')).toBe(true);
    expect(header?.parentElement?.tagName).toBe('SECTION');
    expect(header?.parentElement?.firstElementChild).toBe(header);
    expect(header?.closest('[data-agents-list-scroll]')?.className).toContain(
      'pt-(--mobile-content-inset-top)'
    );
    expect(
      screen.getByRole('status').classList.contains('overflow-y-auto')
    ).toBe(false);
    expect(
      screen.getByRole('status').classList.contains('overflow-visible')
    ).toBe(true);
    expect(header?.closest('[data-mobile-list-header]')).toBeNull();
    expect(screen.getAllByRole('heading', { name: 'Archived' })).toHaveLength(
      1
    );
    expect(screen.getByText('No archived conversations')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New agent' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Start a conversation' })
    ).toBeNull();
    expect(screen.queryByRole('button', { name: /back/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Show sidebar' })).toBeTruthy();
  });

  it('does not claim empty history or a total before pagination finishes', () => {
    render(() => <Harness archived hasNextPage />);
    expect(screen.queryByText('No archived conversations')).toBeNull();
    expect(screen.getByRole('button', { name: 'Load more' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Search conversations' })
    ).toBeTruthy();
  });

  it('waits for the initial query before displaying either empty state', () => {
    render(() => <Harness loading />);
    expect(screen.queryByText('No conversations yet')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Start a conversation' })
    ).toBeNull();
  });
});
