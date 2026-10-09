import type { AgentDmConversationResponse } from '@service-agent-harness/direct-messages';
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('./queries/controls', () => ({ useAgentDmControl: vi.fn() }));
vi.mock('@core/component/Toast/Toast', () => ({ toast: {} }));
vi.mock('@ui', () => ({ Button: () => null }));

import { AgentDmContextBoundary } from './agent-dm-message';
import { AgentDmContext, type AgentDmContextValue } from './context';

afterEach(cleanup);

function conversation(): AgentDmConversationResponse {
  return {
    channelId: 'channel',
    botId: 'bot',
    name: 'Researcher',
    avatarUrl: null,
    available: true,
    settingsChanged: false,
    segments: [
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

function context(data: () => AgentDmConversationResponse): AgentDmContextValue {
  return { conversation: data, refresh: vi.fn() };
}

it('places a fresh-context divider only before the segment’s first source message', () => {
  const view = render(() => (
    <AgentDmContext.Provider value={context(conversation)}>
      <AgentDmContextBoundary messageId="source" />
      <AgentDmContextBoundary messageId="reply" />
    </AgentDmContext.Provider>
  ));
  expect(view.getAllByRole('separator')).toHaveLength(1);
});
