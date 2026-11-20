// The shell portal host is outside this collection-composition test.
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_CONVERSATION_FILTERS } from './core/conversation-filters';
import type { AgentConversationEntity } from './core/recent-conversations';
import { PhoneAgentsList } from './phone-list';

vi.mock('@components/app/SplitHeaderScope', () => ({
  SplitHeaderScope: {
    Root: (props: { children: JSX.Element }) => props.children,
    TopBar: () => null,
  },
}));
vi.mock('@components/app/mobile-header/mobile-header', () => ({
  MobileHeader: Object.assign(
    (props: { children: JSX.Element; trailing: JSX.Element }) => (
      <div>
        {props.children}
        {props.trailing}
      </div>
    ),
    {
      Island: (props: { children: JSX.Element }) => <div>{props.children}</div>,
    }
  ),
}));
vi.mock('@app/components/view-shell', () => ({
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
  useFavoritesData: () => () => ({ favorites: [] }),
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
vi.mock(
  '@app/features/next-soup/soup-view/soup-navigation-touch-highlight',
  () => ({ soupNavigationTouchHighlight: () => () => {} })
);
afterEach(cleanup);

function Harness(props: {
  archived?: boolean;
  loading?: boolean;
  hasNextPage?: boolean;
  rows?: AgentConversationEntity[];
  focus?: () => void;
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
      filters={EMPTY_CONVERSATION_FILTERS}
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
  it('shows the conversation empty panel after the bubbles and sticky heading, and focuses the existing composer', () => {
    const focus = vi.fn();
    const { container } = render(() => <Harness focus={focus} />);
    const heading = screen.getByRole('heading', { name: 'Conversations' });
    expect(container.querySelector('header')?.className).toContain(
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

  it('shows the archived empty panel without bubbles, an action, or Back', () => {
    render(() => <Harness archived />);
    expect(screen.getByRole('heading', { name: 'Archived' })).toBeTruthy();
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
