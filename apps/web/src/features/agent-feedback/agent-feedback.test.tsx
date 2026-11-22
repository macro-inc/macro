import { messageFeedbackSubject } from '@channel/Message/agent-feedback-subject';
import type { MessageData } from '@core/messages/types';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { Toolbar } from '@ui';
import type { JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeFeedbackClient } from './tests/fake-client';

const mocks = vi.hoisted(() => ({
  flag: { enabled: false, loading: false },
  fake: undefined as
    | ReturnType<typeof import('./tests/fake-client').createFakeFeedbackClient>
    | undefined,
}));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ ...mocks.flag, payload: undefined }),
}));
vi.mock('./queries/client', () => ({
  get agentFeedbackClient() {
    return mocks.fake?.client;
  },
}));
vi.mock('@core/user', () => ({
  tryMacroId: (id: string) => id,
  isAgentAccount: (id: string) => id === 'macro|teammate@agents.example',
}));

const { AgentFeedbackScope, ResponseFeedback } = await import(
  './agent-feedback'
);
const { MessageFeedbackToolbar } = await import(
  './views/message-feedback-toolbar'
);

const TURN = {
  kind: 'agent_session_turn',
  sessionId: 'session-1',
  turn: 3,
} as const;

function renderWithQueries(ui: () => JSX.Element) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(() => (
    <QueryClientProvider client={queryClient}>{ui()}</QueryClientProvider>
  ));
}

function message(senderId: string): MessageData {
  return {
    id: 'message-1',
    content: 'Done: the report is in the doc.',
    sender_id: senderId,
    created_at: '2026-11-22T10:00:00Z',
    updated_at: '2026-11-22T10:00:00Z',
    attachments: [],
    reactions: [],
  };
}

beforeEach(() => {
  // The note dialog scrolls its field into view, which jsdom lacks.
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  mocks.fake = createFakeFeedbackClient();
  mocks.flag = { enabled: false, loading: false };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ResponseFeedback', () => {
  it('renders nothing and asks nothing while the flag is off or loading', async () => {
    mocks.flag = { enabled: false, loading: true };
    renderWithQueries(() => (
      <ResponseFeedback subject={TURN} surface="agents_view" />
    ));
    await Promise.resolve();

    expect(screen.queryByRole('button')).toBeNull();
    expect(mocks.fake?.client.mine).not.toHaveBeenCalled();
  });

  it('rates down, then saves the note with the rating', async () => {
    mocks.flag = { enabled: true, loading: false };
    renderWithQueries(() => (
      <ResponseFeedback subject={TURN} surface="agents_view" />
    ));

    const down = await screen.findByRole('button', { name: 'Bad response' });
    expect(down.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(down);

    expect(
      await screen.findByText('What was wrong with this response?')
    ).toBeTruthy();
    await vi.waitFor(() =>
      expect(mocks.fake?.client.rate).toHaveBeenCalledTimes(1)
    );
    mocks.fake?.release();

    const note = screen.getByRole('textbox', { name: 'Add a note' });
    fireEvent.input(note, { target: { value: 'Edited the wrong file' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await vi.waitFor(() =>
      expect(mocks.fake?.client.rate).toHaveBeenCalledTimes(2)
    );
    expect(mocks.fake?.client.rate).toHaveBeenLastCalledWith(
      TURN,
      expect.objectContaining({
        rating: 'down',
        note: 'Edited the wrong file',
        surface: 'agents_view',
      })
    );
    mocks.fake?.release();
    expect(screen.queryByText('What was wrong with this response?')).toBeNull();
    expect(
      (
        await screen.findByRole('button', { name: 'Remove bad rating' })
      ).getAttribute('aria-pressed')
    ).toBe('true');
    expect(screen.getByRole('button', { name: 'Edit note' })).toBeTruthy();
  });
});

describe('message feedback in a channel', () => {
  const parent = { type: 'channel', id: 'channel-1' } as const;

  function renderToolbar(senderId: string) {
    const data = message(senderId);
    renderWithQueries(() => (
      <AgentFeedbackScope
        subject={messageFeedbackSubject(data, parent)}
        surface="message_timeline"
      >
        <Toolbar>
          <MessageFeedbackToolbar />
          <Toolbar.Button aria-label="Reply" />
        </Toolbar>
      </AgentFeedbackScope>
    ));
  }

  it('offers thumbs on a bot message and an agent account message', async () => {
    mocks.flag = { enabled: true, loading: false };
    renderToolbar('bot|0b8f6c1e-4d4f-4c9e-9a51-1f2a3b4c5d6e');
    expect(
      await screen.findByRole('button', { name: 'Good response' })
    ).toBeTruthy();
    expect(mocks.fake?.client.mine).toHaveBeenCalledWith({
      kind: 'message_parent',
      parentType: 'channel',
      parentId: 'channel-1',
    });
    cleanup();

    renderToolbar('macro|teammate@agents.example');
    expect(
      await screen.findByRole('button', { name: 'Bad response' })
    ).toBeTruthy();
  });

  it("offers nothing on a person's message", async () => {
    mocks.flag = { enabled: true, loading: false };
    renderToolbar('macro|alice@example.com');
    await screen.findByRole('button', { name: 'Reply' });

    expect(screen.queryByRole('button', { name: 'Good response' })).toBeNull();
    expect(mocks.fake?.client.mine).not.toHaveBeenCalled();
  });
});
