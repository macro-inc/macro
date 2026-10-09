import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@app/features/agent-conversations/queries/conversations', () => ({
  useAgentConversations: mocks.query,
}));
vi.mock(
  '@app/features/agent-conversations/agent-conversation-controls',
  () => ({
    AgentConversationControls: () => null,
  })
);
vi.mock('@ui', () => ({
  Button: (props: { onClick: () => void; children: JSX.Element }) => (
    <button onClick={props.onClick}>{props.children}</button>
  ),
}));

import { AgentDmComposer } from './agent-dm-composer';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('agent DM composer availability', () => {
  it('keeps normal channel composers independent of the agent metadata service', () => {
    const view = render(() => (
      <AgentDmComposer channelId="ordinary" botId={undefined}>
        <textarea aria-label="Message" />
      </AgentDmComposer>
    ));
    expect(view.getByRole('textbox')).toBeTruthy();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('waits for access and preserves readable history when a persona is revoked', () => {
    const [state, setState] = createStore({
      status: 'pending',
      available: true,
    });
    mocks.query.mockReturnValue({
      get isSuccess() {
        return state.status === 'success';
      },
      get isError() {
        return state.status === 'error';
      },
      get data() {
        if (state.status !== 'success')
          throw new Error('Pending data must not be read');
        return [{ botId: 'persona', available: state.available }];
      },
      refetch: vi.fn(),
    });
    const view = render(() => (
      <>
        <p>Earlier conversation</p>
        <AgentDmComposer channelId="dm" botId="persona">
          <textarea aria-label="Message" />
        </AgentDmComposer>
      </>
    ));
    expect(view.getByText('Loading conversation…')).toBeTruthy();
    expect(view.queryByRole('textbox')).toBeNull();
    setState('status', 'success');
    expect(view.getByRole('textbox')).toBeTruthy();
    setState('available', false);
    expect(view.queryByRole('textbox')).toBeNull();
    expect(view.getByText(/no longer available/)).toBeTruthy();
    expect(view.getByText('Earlier conversation')).toBeTruthy();
  });

  it('offers a retry for metadata failures without treating them as lost access', async () => {
    const refetch = vi.fn();
    mocks.query.mockReturnValue({ isSuccess: false, isError: true, refetch });
    const view = render(() => (
      <AgentDmComposer channelId="dm" botId="persona">
        <textarea />
      </AgentDmComposer>
    ));
    await fireEvent.click(view.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledOnce();
    expect(view.queryByText(/no longer available/)).toBeNull();
  });
});
