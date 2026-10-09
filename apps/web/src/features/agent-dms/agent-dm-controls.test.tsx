import type {
  AgentDmConversationResponse,
  AgentDmTurn,
} from '@service-agent-harness/direct-messages';
import { cleanup, fireEvent, render, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import type { JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  retry: vi.fn(),
  failure: vi.fn(),
}));
vi.mock('@service-agent-harness/client', () => ({
  agentHarnessServiceClient: { control: vi.fn() },
}));
vi.mock('@service-agent-harness/direct-messages', () => ({
  retryAgentDm: mocks.retry,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.failure },
}));
vi.mock('@ui', () => ({
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
}));

import { AgentDmControls } from './agent-dm-controls';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function turn(sessionId: string, state: AgentDmTurn['state']): AgentDmTurn {
  return {
    sessionId,
    state,
    sourceMessageId: `${sessionId}-message`,
    actionId: `${sessionId}-attempt`,
    replyMessageId: null,
    createdAt: '2026-10-01T00:00:00Z',
  };
}

function conversation(
  turns: AgentDmTurn[],
  available = true
): AgentDmConversationResponse {
  return {
    channelId: 'dm',
    botId: 'bot',
    name: 'Researcher',
    avatarUrl: null,
    available,
    settingsChanged: false,
    segments: [
      {
        sessionId: 'current',
        isCurrent: true,
        createdAt: '2026-10-01T00:00:00Z',
      },
    ],
    turns,
  };
}

function mount(data: AgentDmConversationResponse) {
  const changed = vi.fn();
  const view = render(() => (
    <QueryClientProvider client={new QueryClient()}>
      <AgentDmControls conversation={data} onChanged={changed} />
    </QueryClientProvider>
  ));
  return { ...view, changed };
}

describe('agent DM controls', () => {
  it('counts queued messages while a turn runs and leaves Stop to its typing row', () => {
    const view = mount(
      conversation([
        turn('old', 'failed'),
        turn('current', 'running'),
        turn('current', 'queued'),
      ])
    );
    expect(view.getByText('1 queued')).toBeTruthy();
    expect(view.queryByRole('button', { name: 'Stop' })).toBeNull();
    expect(view.queryByText(/could not finish/)).toBeNull();
  });

  it('retries only the chosen current-segment attempt with its original identity', async () => {
    mocks.retry.mockResolvedValue(ok(undefined));
    const current = turn('current', 'interrupted');
    const view = mount(conversation([turn('old', 'failed'), current]));
    expect(view.getByText(/Review any completed actions/)).toBeTruthy();
    expect(mocks.retry).not.toHaveBeenCalled();
    await fireEvent.click(view.getByRole('button', { name: 'Retry message' }));
    await waitFor(() =>
      expect(mocks.retry).toHaveBeenCalledWith('dm', current)
    );
  });

  it('keeps unavailable failed conversations readable without offering a new run', () => {
    const view = mount(conversation([turn('current', 'failed')], false));
    expect(view.getByText(/could not finish/)).toBeTruthy();
    expect(view.queryByRole('button', { name: 'Retry message' })).toBeNull();
  });
});
