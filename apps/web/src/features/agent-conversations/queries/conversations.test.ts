import {
  clearTypingIndicators,
  handleCommsTyping,
} from '@queries/messages/typing';
import {
  type AgentConversation,
  type AgentConversationTurn,
  listAgentConversations,
} from '@service-agent-harness/agent-conversations';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { createComponent, createRoot } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAgentConversations } from './conversations';

vi.mock('@service-agent-harness/agent-conversations', () => ({
  listAgentConversations: vi.fn(),
}));

const list = vi.mocked(listAgentConversations);
const parent = { type: 'channel', id: 'dm' } as const;
const BOT = 'bot|persona';
let client: QueryClient;
let dispose: (() => void) | undefined;

function conversation(
  state: AgentConversationTurn['state']
): AgentConversation[] {
  return [
    {
      channelId: 'dm',
      botId: 'persona',
      name: 'Researcher',
      avatarUrl: null,
      available: true,
      settingsChanged: false,
      sessions: [
        { sessionId: 'session', isCurrent: true, createdAt: '2026-10-01' },
      ],
      turns: [
        {
          sessionId: 'session',
          sourceMessageId: 'source',
          replyMessageId: null,
          actionId: 'attempt',
          state,
          retryable: false,
          createdAt: '2026-10-01',
        },
      ],
    },
  ];
}

function agentTyping(action: 'start' | 'stop') {
  handleCommsTyping(
    {
      action,
      parent,
      user_id: BOT,
      thread_id: null,
      agent: { session_id: 'session', phase: 'working' },
    },
    'macro|me@example.com'
  );
}

function Harness() {
  useAgentConversations(() => 'dm');
  return null;
}

function mount() {
  dispose = createRoot((dispose) => {
    createComponent(QueryClientProvider, {
      client,
      get children() {
        return createComponent(Harness, {});
      },
    });
    return dispose;
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  clearTypingIndicators();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  list.mockReset();
});

afterEach(() => {
  dispose?.();
  client.clear();
  clearTypingIndicators();
  vi.useRealTimers();
});

it('polls every few seconds while a turn is queued or running', async () => {
  list.mockResolvedValue(ok(conversation('running')));
  mount();
  await vi.advanceTimersByTimeAsync(0);
  expect(list).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(list).toHaveBeenCalledTimes(2);
});

it('polls about once a minute while every turn has settled', async () => {
  list.mockResolvedValue(ok(conversation('succeeded')));
  mount();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(list).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(list).toHaveBeenCalledTimes(2);
});

it('polls fast while the agent types, until a poll lands after it stops', async () => {
  list.mockResolvedValue(ok(conversation('succeeded')));
  mount();
  await vi.advanceTimersByTimeAsync(0);
  // A new turn types before any poll has seen it.
  agentTyping('start');
  await vi.advanceTimersByTimeAsync(5_000);
  expect(list).toHaveBeenCalledTimes(2);

  // Its turn ends: one more poll reads how, then polling goes idle.
  await vi.advanceTimersByTimeAsync(1_000);
  agentTyping('stop');
  await vi.advanceTimersByTimeAsync(4_000);
  expect(list).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(list).toHaveBeenCalledTimes(3);
});
