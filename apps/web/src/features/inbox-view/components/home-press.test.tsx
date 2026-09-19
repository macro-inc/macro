import { SidebarCreateHeader } from '@app/components/view-shell/SidebarCreateButton';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomeListEntity } from './HomeListEntity';

vi.mock('@app/features/agents-view/views/AgentSessionListItem', () => ({
  AgentSessionListItem: () => null,
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'test-user' }));
vi.mock('@core/user', () => ({
  getDisplayName: () => 'Peter',
  tryMacroId: (id: string) => id,
}));
vi.mock('@components/app/split-panel', () => ({
  SplitPanel: { CloseButton: () => null },
}));

vi.mock('@entity', () => ({
  Entity: { Title: () => 'Recent chat', Timestamp: () => 'now' },
  MaybeEntityRow: (props: { children: JSX.Element }) => props.children,
}));
vi.mock('@entity/utils/filter', () => ({ unreadFilterFn: () => false }));
vi.mock('./HomeEntityIcon', () => ({ HomeEntityIcon: () => null }));
vi.mock('@ui', async () => ({
  ...(await import('@app/components/ui/utils/press')),
  cn: (...parts: unknown[]) => parts.filter(Boolean).join(' '),
}));

afterEach(cleanup);

describe.each(['recent', 'new chat'] as const)('Home %s press', (kind) => {
  function setup() {
    const activate = vi.fn();
    const view = render(() =>
      kind === 'new chat' ? (
        <SidebarCreateHeader
          title="Home"
          label="New chat"
          onCreate={activate}
        />
      ) : (
        <HomeListEntity
          entity={{
            type: 'chat',
            id: 'recent-chat',
            name: 'Recent chat',
            ownerId: 'test-user',
          }}
          occurrenceKey="recent-chat"
          onClick={activate}
        />
      )
    );
    const item = view.container.querySelector<HTMLElement>(
      kind === 'new chat' ? 'button' : '[data-home-item]'
    )!;
    return { activate, item };
  }

  it('activates on primary press exactly once and preserves modifiers', () => {
    const { activate, item } = setup();
    fireEvent.mouseDown(item, { button: 0, detail: 1, ctrlKey: true });
    expect(activate).toHaveBeenCalledTimes(1);
    if (kind === 'recent') {
      expect(activate.mock.calls[0][0].ctrlKey).toBe(true);
    }
    fireEvent.mouseUp(item, { button: 0, detail: 1 });
    fireEvent.click(item, { button: 0, detail: 1 });
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('supports keyboard and click-only activation', () => {
    const { activate, item } = setup();
    fireEvent.click(item, { button: 0, detail: 0 });
    fireEvent.click(item, { button: 0, detail: 1 });
    expect(activate).toHaveBeenCalledTimes(2);
  });

  it('ignores secondary presses', () => {
    const { activate, item } = setup();
    fireEvent.mouseDown(item, { button: 2 });
    fireEvent.click(item, { button: 2 });
    expect(activate).not.toHaveBeenCalled();
  });
});
