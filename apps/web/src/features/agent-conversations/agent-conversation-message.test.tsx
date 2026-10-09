import type { AgentConversation } from '@service-agent-harness/agent-conversations';
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('./queries/controls', () => ({ useAgentConversationControl: vi.fn() }));
vi.mock('@core/component/Toast/Toast', () => ({ toast: {} }));
vi.mock('@ui', () => ({ Button: () => null }));

import { AgentConversationContextBoundary } from './agent-conversation-message';
import {
  AgentConversationsContext,
  type AgentConversationsContextValue,
} from './context';

afterEach(cleanup);

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
