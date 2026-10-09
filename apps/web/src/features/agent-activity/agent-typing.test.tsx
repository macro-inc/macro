import type {
  FoldedMessage,
  SessionMetadata,
} from '@service-agent-fold/generated/types';
import { cleanup, fireEvent, render, waitFor } from '@solidjs/testing-library';
import { ok } from 'neverthrow';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  issue: vi.fn(),
  canEdit: true,
  profileLoading: false,
}));
const [messages, setMessages] = createSignal<FoldedMessage[]>([]);
const [metadata, setMetadata] = createSignal<SessionMetadata>();
const [loaded, setLoaded] = createSignal(true);
vi.mock('./queries/live-session', () => ({
  createLiveSession: () => ({
    messages,
    metadata,
    loaded,
    failed: () => false,
    retry: vi.fn(),
    issue: mocks.issue,
  }),
}));
vi.mock('@queries/agent-session/session', () => ({
  useAgentSessionQuery: () => ({
    isPending: false,
    data: { canEdit: mocks.canEdit },
  }),
}));
vi.mock('@queries/bots/profiles', () => ({
  useBotProfile: () =>
    mocks.profileLoading
      ? { isPending: true, isError: false, data: undefined }
      : {
          isPending: false,
          isError: false,
          data: { name: 'Researcher', avatarUrl: undefined, deleted: false },
        },
}));
vi.mock('@app/features/agent-dms/components/persona-avatar', () => ({
  PersonaAvatar: () => null,
}));
vi.mock('@app/features/agent-interactions/components/InteractionCard', () => ({
  InteractionCard: (props: { request: { requestId: string } }) => (
    <section aria-label="Question">{props.request.requestId}</section>
  ),
}));
vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  () => ({
    StaticMarkdown: (props: { markdown: string }) => <p>{props.markdown}</p>,
  })
);
vi.mock('@core/component/Toast/Toast', () => ({ toast: { failure: vi.fn() } }));
vi.mock('@ui', () => ({
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
}));

import {
  clearTypingIndicators,
  handleCommsTyping,
} from '@queries/messages/typing';
import { AgentTyping } from './agent-typing';

const parent = { type: 'channel', id: 'dm' } as const;
const BOT = 'bot|0a8f5e1c-2b3d-4e5f-8a9b-0c1d2e3f4a5b';

function typing(phase: 'thinking' | 'working' | 'waiting') {
  handleCommsTyping(
    {
      action: 'start',
      parent,
      user_id: BOT,
      thread_id: null,
      agent: { session_id: 'session', phase },
    },
    'macro|me@example.com'
  );
}

function writing(text: string): FoldedMessage {
  return {
    agentSessionId: 'session',
    turn: 1,
    author: { kind: 'agent' },
    requestId: null,
    parts: [{ kind: 'text', text }],
    stop: null,
    pending: false,
    segments: [
      { index: 0, kind: 'prose', start: 0, end: 1, sealed: false, rows: [] },
    ],
    phase: 'writing',
  };
}

beforeEach(() => {
  clearTypingIndicators();
  mocks.canEdit = true;
  mocks.profileLoading = false;
  mocks.issue.mockResolvedValue(ok({}));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  setMessages([]);
  setMetadata(undefined);
  setLoaded(true);
});

it('shows an agent typing with what it is doing, and nothing for people', () => {
  handleCommsTyping(
    { action: 'start', parent, user_id: 'macro|you@example.com' },
    'macro|me@example.com'
  );
  const view = render(() => <AgentTyping parent={parent} threadId={null} />);
  expect(view.queryByRole('status')).toBeNull();

  typing('thinking');
  expect(view.getByRole('status').textContent).toContain(
    'Researcher is thinking'
  );
  typing('working');
  expect(view.getByRole('status').textContent).toContain(
    'Researcher is working'
  );
});

it('streams the unfinished passage beneath and stops the turn', async () => {
  typing('thinking');
  setMessages([writing('Looking at the failing test')]);
  const view = render(() => <AgentTyping parent={parent} threadId={null} />);
  expect(view.getByText('Looking at the failing test')).toBeTruthy();

  await fireEvent.click(view.getByRole('button', { name: 'Stop' }));
  await waitFor(() =>
    expect(mocks.issue).toHaveBeenCalledWith({ type: 'stop' })
  );
});

it('puts a question for the running turn under the row', () => {
  typing('waiting');
  setMessages([writing('')]);
  setMetadata({
    turn: 'running',
    pendingInteractions: [
      {
        kind: 'elicitation',
        turn: 1,
        requestId: 'ask-1',
        toolCall: null,
        message: 'Which branch?',
        request: { kind: 'form', schema: {} },
      },
      {
        kind: 'elicitation',
        turn: 0,
        requestId: 'stale',
        toolCall: null,
        message: 'Old',
        request: { kind: 'form', schema: {} },
      },
    ],
  } as unknown as SessionMetadata);
  const view = render(() => <AgentTyping parent={parent} threadId={null} />);
  expect(
    view.getAllByRole('region', { name: 'Question' }).map((q) => q.textContent)
  ).toEqual(['ask-1']);
});

it('offers no Stop to a viewer who cannot drive the session', () => {
  mocks.canEdit = false;
  typing('working');
  setMessages([writing('Partial')]);
  const view = render(() => <AgentTyping parent={parent} threadId={null} />);
  expect(view.queryByRole('button', { name: 'Stop' })).toBeNull();
});

it('names nobody until the persona is known, rather than a placeholder', () => {
  mocks.profileLoading = true;
  typing('thinking');
  const view = render(() => <AgentTyping parent={parent} threadId={null} />);
  expect(view.getByRole('status').textContent).toBe('...');
});
