import type { AgentConversation } from '@service-agent-harness/agent-conversations';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ control: vi.fn() }));
vi.mock('./queries/controls', () => ({
  useAgentConversationControl: mocks.control,
}));
vi.mock('@core/component/Toast/Toast', () => ({ toast: {} }));
vi.mock('@ui', () => ({
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
}));

import {
  AgentConversationContextBoundary,
  AgentConversationMessageStatus,
} from './agent-conversation-message';
import {
  AgentConversationsContext,
  type AgentConversationsContextValue,
} from './context';

beforeEach(() => {
  // Each status's own mutation, pending from the click until it settles.
  mocks.control.mockImplementation(() => {
    const [pending, setPending] = createSignal(false);
    return {
      get isPending() {
        return pending();
      },
      mutate: () => setPending(true),
    };
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function conversation(): AgentConversation {
  return {
    channelId: 'channel',
    botId: 'bot',
    name: 'Researcher',
    avatarUrl: null,
    available: true,
    settingsChanged: false,
    sessions: [
      { sessionId: 'old', isCurrent: false, createdAt: '2026-10-01T00:00:00Z' },
      { sessionId: 'new', isCurrent: true, createdAt: '2026-10-01T01:00:00Z' },
    ],
    turns: [
      {
        sessionId: 'new',
        sourceMessageId: 'source',
        replyMessageId: 'reply',
        actionId: 'attempt',
        state: 'running',
        retryable: false,
        createdAt: '2026-10-01T01:00:00Z',
      },
    ],
  };
}

function context(
  data: () => AgentConversation
): AgentConversationsContextValue {
  return { conversations: () => [data()], refresh: vi.fn() };
}

it('places a fresh-context divider only before the session’s first source message', () => {
  const view = render(() => (
    <AgentConversationsContext.Provider value={context(conversation)}>
      <AgentConversationContextBoundary messageId="source" />
      <AgentConversationContextBoundary messageId="reply" />
    </AgentConversationsContext.Provider>
  ));
  expect(view.getAllByRole('separator')).toHaveLength(1);
});

it('keeps a failed message’s status, and its Retry in flight, as the conversation polls', async () => {
  const failed = (): AgentConversation => {
    const data = conversation();
    return {
      ...data,
      turns: [{ ...data.turns[0]!, state: 'failed', retryable: true }],
    };
  };
  const [data, setData] = createSignal(failed());
  const view = render(() => (
    <AgentConversationsContext.Provider value={context(data)}>
      <AgentConversationMessageStatus messageId="source" />
    </AgentConversationsContext.Provider>
  ));
  const retry = view.getByRole<HTMLButtonElement>('button', {
    name: 'Retry message',
  });
  await fireEvent.click(retry);
  expect(retry.disabled).toBe(true);

  // The next poll carries the same conversation as new objects.
  setData(failed());
  expect(view.getByRole('button', { name: 'Retry message' })).toBe(retry);
  expect(retry.disabled).toBe(true);
  expect(mocks.control).toHaveBeenCalledOnce();
});
