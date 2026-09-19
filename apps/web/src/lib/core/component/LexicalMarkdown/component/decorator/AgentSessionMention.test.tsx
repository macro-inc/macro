import { fireEvent, render, screen } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: { isSuccess: true, isError: false, data: {} as unknown },
  open: vi.fn(),
  magic: vi.fn(),
  subscribe: vi.fn(() => () => {}),
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: mocks.open }),
}));
vi.mock('@core/util/useSplitNavigationHandler', () => ({
  useSplitNavigationHandler: (onClick: (event: MouseEvent) => void) => ({
    onClick,
  }),
}));
vi.mock('@queries/agent-session/mentions', () => ({
  useAgentSessionMentionPreview: () => mocks.query,
}));
vi.mock('@queries/agent-session/session-fold', () => ({
  subscribeAgentSessionLog: mocks.subscribe,
}));
vi.mock('./MagicChip', () => ({
  MagicChip: (props: unknown) => {
    mocks.magic(props);
    return <span data-magic-chip>Latest session response</span>;
  },
}));
vi.mock('@core/component/DocumentPreview', () => ({
  PopupPreview: () => null,
}));
vi.mock('@core/component/HoverCard', () => ({
  HoverCard: (props: { trigger: import('solid-js').JSX.Element }) =>
    props.trigger,
}));
vi.mock('../../plugins', () => ({ autoRegister: vi.fn() }));

import { AgentSessionMention } from './AgentSessionMention';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.isSuccess = true;
  mocks.query.isError = false;
  mocks.query.data = {
    access: 'access',
    data: {
      id: 'session',
      name: 'Fix mentions',
      bot: { name: 'Ada', avatarUrl: 'https://example.com/avatar.png' },
      status: { kind: 'disconnected' },
    },
  };
});

describe('agent session mention rendering', () => {
  it('mounts the shared Magic Chip with a null message lock only when expanded', () => {
    const view = render(() => (
      <AgentSessionMention
        id="session"
        label="Saved title"
        key="node"
        theme={{}}
        expanded
      />
    ));
    expect(view.container.querySelector('[data-magic-chip]')).not.toBeNull();
    expect(mocks.magic).toHaveBeenCalledWith(
      expect.objectContaining({
        agentSessionId: 'session',
        promptedMessage: null,
      })
    );
  });
  it.each(['no_access', 'does_not_exist'])(
    'does not mount expanded session content for %s',
    (access) => {
      mocks.query.data = { access };
      render(() => (
        <AgentSessionMention
          id="session"
          label="Secret"
          key="node"
          theme={{}}
          expanded
        />
      ));
      expect(mocks.magic).not.toHaveBeenCalled();
    }
  );

  it('shows only the agent icon and underlined title, and opens the agent block', () => {
    const view = render(() => (
      <AgentSessionMention
        id="session"
        label="Old title"
        key="node"
        theme={{}}
      />
    ));
    expect(view.container.textContent).not.toContain('Ada');
    expect(view.container.textContent).toContain('Fix mentions');
    expect(view.container.textContent).not.toContain('Disconnected');
    expect(view.container.querySelector('img')).toBeNull();
    expect(view.container.querySelector('svg')).not.toBeNull();
    expect(
      screen.getByText('Fix mentions').classList.contains('underline')
    ).toBe(true);
    expect(mocks.subscribe).not.toHaveBeenCalled();
    expect(mocks.magic).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Fix mentions'));
    expect(mocks.open).toHaveBeenCalledWith(
      { type: 'agent', id: 'session' },
      expect.anything()
    );
  });
  it.each(['no_access', 'does_not_exist'])(
    'hides saved metadata and disables opening for %s',
    (access) => {
      mocks.query.data = { access };
      const view = render(() => (
        <AgentSessionMention
          id="session"
          label="Secret old title"
          key="node"
          theme={{}}
        />
      ));
      expect(view.container.textContent).not.toContain('Secret');
      expect(view.container.querySelector('img')).toBeNull();
      fireEvent.click(view.container.firstElementChild!);
      expect(mocks.open).not.toHaveBeenCalled();
      expect(mocks.subscribe).not.toHaveBeenCalled();
      expect(mocks.magic).not.toHaveBeenCalled();
    }
  );
  it('does not read pending query data or suspend the editor', () => {
    mocks.query.isSuccess = false;
    const original = Object.getOwnPropertyDescriptor(mocks.query, 'data')!;
    Object.defineProperty(mocks.query, 'data', {
      configurable: true,
      get: () => {
        throw new Error('unguarded resource read');
      },
    });
    try {
      render(() => (
        <AgentSessionMention
          id="session"
          label="Saved title"
          key="node"
          theme={{}}
        />
      ));
      expect(screen.getByText('Saved title')).toBeTruthy();
    } finally {
      Object.defineProperty(mocks.query, 'data', original);
    }
  });
});
