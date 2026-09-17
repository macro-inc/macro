import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import {
  type AgentConversationEntity,
  groupConversations,
} from '../core/recent-conversations';
import { AgentsSidebar } from './AgentsSidebar';

vi.mock('@app/components/view-shell', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@app/components/view-shell')>()),
  useViewControlHotkeys: vi.fn(),
}));
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
        handleForBot={() => undefined}
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
    expect(code.getAttribute('data-kind')).toBe('code');
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
