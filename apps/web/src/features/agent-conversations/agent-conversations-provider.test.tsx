import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('./queries/conversations', () => ({
  useAgentConversations: mocks.query,
}));

import { AgentConversationsProvider } from './agent-conversations-provider';
import { useOptionalAgentConversations } from './context';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function Names() {
  const context = useOptionalAgentConversations();
  return (
    <output>
      {(context?.conversations() ?? []).map((c) => c.botId).join(',')}
    </output>
  );
}

it('keeps the last conversations through a failed poll', () => {
  const [state, setState] = createStore({ status: 'success' });
  mocks.query.mockReturnValue({
    isPending: false,
    get isSuccess() {
      return state.status === 'success';
    },
    get isError() {
      return state.status === 'error';
    },
    // A failed refetch keeps the last data it loaded.
    data: [{ botId: 'persona' }],
    refetch: vi.fn(),
  });
  const view = render(() => (
    <AgentConversationsProvider channelId="dm" hasAgents>
      <Names />
    </AgentConversationsProvider>
  ));
  expect(view.getByRole('status').textContent).toBe('persona');
  setState('status', 'error');
  expect(view.getByRole('status').textContent).toBe('persona');
});

it('mounts the channel once when its agent is known only later', () => {
  const [hasAgents, setHasAgents] = createSignal(false);
  mocks.query.mockImplementation(
    (_channelId: () => string, enabled: () => boolean) => ({
      get isPending() {
        return !enabled();
      },
      get data() {
        if (!enabled()) throw new Error('Disabled data must not be read');
        return [{ botId: 'persona' }];
      },
      refetch: vi.fn(),
    })
  );
  let mounts = 0;
  const Channel = () => {
    mounts += 1;
    return <Names />;
  };
  const view = render(() => (
    <AgentConversationsProvider channelId="dm" hasAgents={hasAgents()}>
      <Channel />
    </AgentConversationsProvider>
  ));
  expect(view.getByRole('status').textContent).toBe('');
  setHasAgents(true);
  expect(view.getByRole('status').textContent).toBe('persona');
  expect(mounts).toBe(1);
});
