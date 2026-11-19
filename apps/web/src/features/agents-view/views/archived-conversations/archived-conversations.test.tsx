import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentConversationEntity } from '../../core/recent-conversations';
import { ArchivedConversations } from './archived-conversations';

vi.mock('@app/features/soup', () => ({
  MaybeSoupEntityActionDrawerManager: (props: { children: JSX.Element }) =>
    props.children,
}));
vi.mock('./archived-conversation-row', () => ({
  ArchivedConversationRow: (props: {
    conversation: AgentConversationEntity;
  }) => <div>{props.conversation.name}</div>,
}));

afterEach(cleanup);

describe('archived conversation pagination', () => {
  it('shows progress while another page remains available before fetching starts', () => {
    const onLoadMore = vi.fn();
    render(() => (
      <ArchivedConversations
        conversations={[]}
        ownerId="me"
        sort="updated"
        loading={false}
        loadingNextPage={false}
        hasNextPage={true}
        error={false}
        onLoadMore={onLoadMore}
        onRetry={vi.fn()}
        modeForConversation={() => 'chat'}
        onOpenConversation={vi.fn()}
        actions={{
          openPullRequest: vi.fn(),
          openBranch: vi.fn(),
          copyBranch: async () => true,
          unarchive: async () => true,
        }}
      />
    ));

    expect(onLoadMore).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('No archived conversations.')).toBeNull();
    expect(
      screen.getByRole('status', { name: 'Loading conversations' })
    ).toBeTruthy();
  });

  it('keeps searching across empty pages until an archived row arrives', () => {
    const [state, setState] = createSignal({
      conversations: [] as AgentConversationEntity[],
      loading: true,
      loadingNextPage: false,
      hasNextPage: true,
      error: false,
    });
    const onLoadMore = vi.fn(() =>
      setState((current) => ({ ...current, loadingNextPage: true }))
    );
    render(() => (
      <ArchivedConversations
        conversations={state().conversations}
        ownerId="me"
        sort="updated"
        loading={state().loading}
        loadingNextPage={state().loadingNextPage}
        hasNextPage={state().hasNextPage}
        error={state().error}
        onLoadMore={onLoadMore}
        onRetry={vi.fn()}
        modeForConversation={() => 'chat'}
        onOpenConversation={vi.fn()}
        actions={{
          openPullRequest: vi.fn(),
          openBranch: vi.fn(),
          copyBranch: async () => true,
          unarchive: async () => true,
        }}
      />
    ));

    expect(
      screen.getByRole('status', { name: 'Loading conversations' })
    ).toBeTruthy();
    expect(screen.queryByText('No archived conversations.')).toBeNull();

    setState((current) => ({ ...current, loading: false }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('No archived conversations.')).toBeNull();
    expect(
      screen.getByRole('status', { name: 'Loading conversations' })
    ).toBeTruthy();

    setState((current) => ({ ...current, loadingNextPage: false }));
    expect(onLoadMore).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('No archived conversations.')).toBeNull();
    expect(
      screen.getByRole('status', { name: 'Loading conversations' })
    ).toBeTruthy();

    setState((current) => ({
      ...current,
      loadingNextPage: false,
      hasNextPage: false,
      conversations: [
        {
          type: 'agent_session',
          id: 'archived',
          name: 'Found archive',
          ownerId: 'me',
          botId: 'agent',
          status: 'ready',
          archivedAt: '2025-01-01T00:00:00Z',
        },
      ],
    }));
    expect(screen.getByText('Found archive')).toBeTruthy();
    expect(
      screen.queryByRole('status', { name: 'Loading conversations' })
    ).toBeNull();
    expect(screen.queryByText('No archived conversations.')).toBeNull();
  });

  it('waits for the final page, then shows an exhausted empty history and search result', () => {
    const [loadingNextPage, setLoadingNextPage] = createSignal(true);
    const [error, setError] = createSignal(false);
    const onRetry = vi.fn();
    render(() => (
      <ArchivedConversations
        conversations={[]}
        ownerId="me"
        sort="updated"
        loading={false}
        loadingNextPage={loadingNextPage()}
        hasNextPage={false}
        error={error()}
        onLoadMore={vi.fn()}
        onRetry={onRetry}
        modeForConversation={() => 'chat'}
        onOpenConversation={vi.fn()}
        actions={{
          openPullRequest: vi.fn(),
          openBranch: vi.fn(),
          copyBranch: async () => true,
          unarchive: async () => true,
        }}
      />
    ));

    expect(screen.queryByText('No archived conversations.')).toBeNull();
    expect(
      screen.getByRole('status', { name: 'Loading conversations' })
    ).toBeTruthy();

    setLoadingNextPage(false);
    expect(screen.getByText('No archived conversations.')).toBeTruthy();
    expect(
      screen.queryByRole('status', { name: 'Loading conversations' })
    ).toBeNull();

    fireEvent.input(screen.getByPlaceholderText('Search archived'), {
      target: { value: 'missing' },
    });
    expect(screen.getByText('No results for "missing"')).toBeTruthy();

    setError(true);
    expect(screen.queryByText('No results for "missing"')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
