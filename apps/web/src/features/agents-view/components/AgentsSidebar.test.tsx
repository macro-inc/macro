import { HomeListEntity } from '@app/features/inbox-view/components/HomeListEntity';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type AgentConversationEntity,
  groupConversations,
} from '../core/recent-conversations';
import { AgentsSidebar } from './AgentsSidebar';

vi.mock('@app/components/view-shell', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@app/components/view-shell')>()),
  useViewControlHotkeys: vi.fn(),
}));
vi.mock('@phosphor/code.svg', () => ({
  default: () => <svg data-coding-icon />,
}));
vi.mock('@queries/agent-session/session', () => ({
  useAgentSessionQuery: () => ({
    get isSuccess() {
      return metadata() !== undefined;
    },
    get data() {
      return metadata();
    },
  }),
}));
vi.mock('@queries/agents/agents', () => ({
  useAgentsQuery: () => ({ isSuccess: true, data: [] }),
}));
vi.mock('@app/features/block-agent/component/AgentPullRequestChip', () => ({
  AgentPullRequestIcon: () => <svg data-pr-icon />,
}));
vi.mock('@entity', () => ({
  Entity: { Title: () => 'Recent chat', Timestamp: () => 'now' },
  MaybeEntityRow: (props: { children: JSX.Element }) => props.children,
}));
vi.mock('@entity/utils/filter', () => ({ unreadFilterFn: () => false }));
vi.mock('@app/features/inbox-view/components/HomeEntityIcon', () => ({
  HomeEntityIcon: () => null,
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'me' }));
vi.mock('@core/user', () => ({
  getDisplayName: () => '',
  tryMacroId: (id: string) => id,
}));

const [metadata, setMetadata] = createSignal<{
  harness: string;
  pullRequestUrl?: string;
}>();
afterEach(() => {
  cleanup();
  setMetadata(undefined);
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
    render(() => (
      <AgentsSidebar
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
});

describe.each(['home', 'sidebar'] as const)('%s agent rows', (surface) => {
  const conversation: AgentConversationEntity = {
    type: 'agent_session',
    id: 'coding-session',
    name: 'Fix build',
    ownerId: 'me',
    botId: 'cursor',
    status: 'acp_ready',
  };
  function setup() {
    const open = vi.fn();
    const view = render(() =>
      surface === 'home' ? (
        <HomeListEntity
          entity={conversation}
          occurrenceKey="coding-session"
          onClick={open}
        />
      ) : (
        <AgentsSidebar
          groups={groupConversations([conversation])}
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
    return { open, view };
  }

  it('adds the PR as metadata arrives without taking over session navigation', () => {
    const { open, view } = setup();
    const session = screen.getByRole('button', { name: 'Fix build' });
    expect(screen.queryByRole('link')).toBeNull();
    setMetadata({
      harness: 'cursor',
      pullRequestUrl: 'https://github.com/macro-inc/macro/pull/42',
    });
    const pr = screen.getByRole('link', { name: 'View PR #42 in GitHub' });
    expect(pr.getAttribute('href')).toBe(
      'https://github.com/macro-inc/macro/pull/42'
    );
    expect(pr.closest('button')).toBeNull();
    expect(view.container.querySelector('[data-kind="code"]')).toBeTruthy();
    expect(view.container.querySelector('[data-pr-icon]')).toBeTruthy();
    expect(view.container.querySelector('[data-coding-icon]')).toBeNull();
    expect(screen.queryByText('@cursor')).toBeNull();
    expect(screen.queryByText('Ready')).toBeNull();
    expect(pr.getAttribute('target')).toBe('_blank');
    fireEvent.mouseDown(pr, { button: 0, detail: 1 });
    fireEvent.click(pr);
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(session, { shiftKey: true });
    expect(open).toHaveBeenCalledOnce();
    const event = open.mock.calls[0][surface === 'home' ? 0 : 1];
    expect(event.shiftKey).toBe(true);
  });

  it('keeps the session available without metadata and uses the session harness for its icon', () => {
    const { open, view } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Fix build' }));
    expect(open).toHaveBeenCalledOnce();
    setMetadata({ harness: 'in-memory' });
    expect(view.container.querySelector('[data-kind="chat"]')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByText('Ready')).toBeNull();
  });
});
