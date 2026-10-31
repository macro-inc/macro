import type {
  FoldedMessage,
  SessionMetadata,
} from '@service-agent-fold/generated/types';
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  issue: vi.fn(),
  failure: vi.fn(),
  canEdit: true,
  liveSessions: 0,
  cards: 0,
}));
const [messages, setMessages] = createSignal<FoldedMessage[]>([]);
const [metadata, setMetadata] = createSignal<SessionMetadata>();
const [loaded, setLoaded] = createSignal(true);
vi.mock('./queries/live-session', () => ({
  createLiveSession: () => {
    mocks.liveSessions += 1;
    return {
      messages,
      metadata,
      loaded,
      failed: () => false,
      retry: vi.fn(),
      issue: mocks.issue,
    };
  },
}));
vi.mock('@queries/agent-session/session', () => ({
  useAgentSessionQuery: () => ({
    isPending: false,
    data: { canEdit: mocks.canEdit },
  }),
}));
vi.mock('@queries/bots/profiles', () => ({
  useBotProfile: () => ({
    isPending: false,
    isError: false,
    data: { name: 'Researcher', avatarUrl: undefined, deleted: false },
  }),
}));
vi.mock('@app/features/block-agent/ui', () => ({
  TextShimmer: (props: { text: string }) => <>{props.text}</>,
  WorkingDots: () => null,
}));
vi.mock('@app/features/agent-dms/components/persona-avatar', () => ({
  PersonaAvatar: () => null,
}));
vi.mock('@app/features/agent-interactions/components/InteractionCard', () => ({
  InteractionCard: (props: { request: { requestId: string } }) => {
    mocks.cards += 1;
    return (
      <section aria-label="Question">
        {props.request.requestId}
        <input aria-label="Answer" />
      </section>
    );
  },
}));
vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  () => ({
    StaticMarkdown: (props: { markdown: string }) => <p>{props.markdown}</p>,
  })
);
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.failure },
}));
vi.mock('@ui', () => ({
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
}));

import {
  publishSessionTurn,
  resetSessionTurns,
} from '@core/agent-session/session-turn';
import {
  clearTypingIndicators,
  getTypingAgents,
  handleCommsTyping,
  TYPING_INDICATOR_TIMEOUT_MS,
} from '@queries/messages/typing';
import { AgentTyping, AgentTypingProvider } from './agent-typing';

const parent = { type: 'channel', id: 'dm' } as const;
const BOT = 'bot|0a8f5e1c-2b3d-4e5f-8a9b-0c1d2e3f4a5b';

/** Rendered where the app renders it, under a query client. */
function show(ui: () => JSX.Element) {
  const client = new QueryClient();
  return render(ui, {
    wrapper: (props) => (
      <QueryClientProvider client={client}>
        {props.children}
      </QueryClientProvider>
    ),
  });
}

function typing(phase: 'thinking' | 'writing' | 'working' | 'waiting') {
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
    postedAt: null,
  };
}

/** The fold's metadata with one question on turn 1, as a new object each time. */
function asking(requestId: string): SessionMetadata {
  return {
    turn: 'blocked',
    pendingInteractions: [
      {
        kind: 'elicitation',
        turn: 1,
        requestId,
        toolCall: null,
        message: 'Which branch?',
        request: { kind: 'form', schema: {} },
      },
    ],
  } as unknown as SessionMetadata;
}

beforeEach(() => {
  clearTypingIndicators();
  mocks.canEdit = true;
  mocks.liveSessions = 0;
  mocks.cards = 0;
  mocks.issue.mockResolvedValue(ok({}));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  resetSessionTurns();
  setMessages([]);
  setMetadata(undefined);
  setLoaded(true);
});

it('shows an agent typing with what it is doing, and nothing for people', () => {
  handleCommsTyping(
    { action: 'start', parent, user_id: 'macro|you@example.com' },
    'macro|me@example.com'
  );
  const view = show(() => <AgentTyping parent={parent} threadId={null} />);
  expect(view.queryByRole('status')).toBeNull();

  typing('thinking');
  expect(view.getByRole('status').textContent).toBe('Thinking');
  typing('working');
  expect(view.getByRole('status').textContent).toBe('Working');
});

it('says it is writing without streaming the passage, and stops the turn', async () => {
  typing('writing');
  setMessages([writing('Looking at the failing test')]);
  const view = show(() => <AgentTyping parent={parent} threadId={null} />);
  expect(view.getByRole('status').textContent).toBe('Writing');
  expect(view.queryByText('Looking at the failing test')).toBeNull();

  await fireEvent.click(view.getByRole('button', { name: 'Stop' }));
  await waitFor(() =>
    expect(mocks.issue).toHaveBeenCalledWith({ type: 'stop' })
  );
});

it('allows Stop to be retried after its request rejects', async () => {
  typing('working');
  setMessages([writing('Partial')]);
  mocks.issue.mockRejectedValueOnce(new Error('Disconnected'));
  const view = show(() => <AgentTyping parent={parent} threadId={null} />);
  const stop = view.getByRole<HTMLButtonElement>('button', { name: 'Stop' });

  await fireEvent.click(stop);
  await waitFor(() => {
    expect(mocks.failure).toHaveBeenCalledWith(
      'The agent could not be stopped'
    );
    expect(stop.disabled).toBe(false);
  });
  await fireEvent.click(stop);
  await waitFor(() => expect(mocks.issue).toHaveBeenCalledTimes(2));
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
  const view = show(() => <AgentTyping parent={parent} threadId={null} />);
  expect(
    view.getAllByRole('region', { name: 'Question' }).map((q) => q.textContent)
  ).toEqual(['ask-1']);
});

it('offers no Stop to a viewer who cannot drive the session', () => {
  mocks.canEdit = false;
  typing('working');
  setMessages([writing('Partial')]);
  const view = show(() => <AgentTyping parent={parent} threadId={null} />);
  expect(view.queryByRole('button', { name: 'Stop' })).toBeNull();
});

it('names the step the open run is on, and never what it ran', () => {
  typing('working');
  setMessages([
    {
      ...writing('Checking the tests first.'),
      segments: [
        { index: 0, kind: 'prose', start: 0, end: 1, sealed: true, rows: [] },
        {
          index: 1,
          kind: 'activity',
          start: 1,
          end: 2,
          sealed: false,
          rows: [
            {
              id: 't1',
              label: 'Running',
              detail: 'cargo test',
              status: 'running',
            },
          ],
        },
      ],
      phase: 'working',
    },
  ]);
  const view = show(() => <AgentTyping parent={parent} threadId={null} />);
  expect(view.getByRole('status').textContent).toBe('Running');
  expect(view.queryByText(/cargo/)).toBeNull();
});

it('keeps a card as it was left through a metadata event that resends it', () => {
  typing('waiting');
  setMessages([writing('')]);
  setMetadata(asking('ask-1'));
  const view = show(() => <AgentTyping parent={parent} threadId={null} />);
  const answer = view.getByRole<HTMLInputElement>('textbox', {
    name: 'Answer',
  });
  answer.value = 'main';
  setMetadata(asking('ask-1'));
  expect(view.getByRole('textbox', { name: 'Answer' })).toBe(answer);
  expect(answer.value).toBe('main');
  expect(mocks.cards).toBe(1);
});

it('moves the live turn with the newest row rather than starting it over', () => {
  typing('waiting');
  setMessages([writing('')]);
  setMetadata(asking('ask-1'));
  const [newest, setNewest] = createSignal<string>('first');
  const view = show(() => (
    <AgentTypingProvider parent={parent} threadId={null}>
      <For each={['first', 'second']}>
        {(row) => (
          <div data-testid={row}>
            <Show when={newest() === row}>
              <AgentTyping parent={parent} threadId={null} />
            </Show>
          </div>
        )}
      </For>
      {/* Another place makes its own rows; nothing types there. */}
      <div data-testid="thread">
        <AgentTyping parent={parent} threadId="thread" />
      </div>
    </AgentTypingProvider>
  ));
  const answer = within(view.getByTestId('first')).getByRole<HTMLInputElement>(
    'textbox',
    { name: 'Answer' }
  );
  answer.value = 'main';

  // A message arrives below, so the next row is the newest.
  setNewest('second');
  expect(
    within(view.getByTestId('second')).getByRole('textbox', { name: 'Answer' })
  ).toBe(answer);
  // The reader scrolls away, and the virtualized row unmounts, then back.
  setNewest('');
  expect(view.queryByRole('textbox', { name: 'Answer' })).toBeNull();
  setNewest('second');
  expect(view.getByRole('textbox', { name: 'Answer' })).toBe(answer);

  expect(answer.value).toBe('main');
  expect(mocks.cards).toBe(1);
  expect(mocks.liveSessions).toBe(1);
  expect(within(view.getByTestId('thread')).queryByRole('status')).toBeNull();
});

it('keeps the row of a turn waiting on the viewer after its typing lapses', () => {
  vi.useFakeTimers();
  typing('waiting');
  setMessages([writing('')]);
  setMetadata(asking('ask-1'));
  publishSessionTurn('session', 'blocked');
  const view = show(() => <AgentTyping parent={parent} threadId={null} />);
  const answer = view.getByRole('textbox', { name: 'Answer' });

  // No heartbeat for a while, as when a phone sleeps with the app open.
  vi.advanceTimersByTime(TYPING_INDICATOR_TIMEOUT_MS);
  expect(getTypingAgents(parent, null).size).toBe(0);
  expect(view.getByRole('status').textContent).toBe('Waiting for an answer');
  expect(view.getByRole('textbox', { name: 'Answer' })).toBe(answer);

  // The turn ends, and the row goes with it.
  publishSessionTurn('session', 'idle');
  expect(view.queryByRole('status')).toBeNull();
});

it('lets a lapsed typing go when the fold has no turn open', () => {
  vi.useFakeTimers();
  typing('thinking');
  const view = show(() => <AgentTyping parent={parent} threadId={null} />);
  expect(view.getByRole('status')).toBeTruthy();
  vi.advanceTimersByTime(TYPING_INDICATOR_TIMEOUT_MS);
  expect(view.queryByRole('status')).toBeNull();
});
