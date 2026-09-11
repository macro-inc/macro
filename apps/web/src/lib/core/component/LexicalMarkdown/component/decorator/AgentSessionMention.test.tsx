import { fireEvent, render, screen } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: { isSuccess: true, isError: false, data: {} as unknown },
  open: vi.fn(),
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
