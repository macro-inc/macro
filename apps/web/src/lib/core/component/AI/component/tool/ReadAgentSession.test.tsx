import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, expect, it } from 'vitest';
import { readAgentSessionHandler } from './ReadAgentSession';

afterEach(cleanup);

it('expands the conversation and preserves the failure when text was truncated', () => {
  const view = render(() => (
    <readAgentSessionHandler.render
      tool={{
        id: 'read-1',
        name: 'ReadAgentSession',
        data: { sessionId: '0195d721-1730-7cda-a72e-855bec53411e' },
      }}
      response={{
        id: 'read-1',
        name: 'ReadAgentSession',
        data: {
          sessionId: '0195d721-1730-7cda-a72e-855bec53411e',
          name: 'Debug session',
          ownerId: 'macro|owner@example.com',
          botId: 'bot-id',
          isArchived: false,
          harness: 'in-memory',
          model: 'test',
          status: 'disconnected',
          totalMessages: 2,
          truncated: true,
          messages: [
            {
              turn: 0,
              role: 'agent',
              content: 'Checking the integration',
              truncated: true,
              failure: 'Unknown tool mcp__missing',
            },
          ],
        },
      }}
      chat_id="chat-1"
      message_id="message-1"
      part_index={0}
      isComplete={true}
      renderContext={{ isStreaming: false, followedBy: () => false }}
    />
  ));
  expect(view.queryByText('Checking the integration')).toBeNull();
  fireEvent.click(view.getByRole('button', { name: /1 messages/ }));
  expect(view.getByText('Checking the integration')).toBeTruthy();
  expect(view.getByText('Failed: Unknown tool mcp__missing')).toBeTruthy();
  expect(view.getByText('Message truncated')).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: /1 messages/ }));
  expect(view.queryByText('Checking the integration')).toBeNull();
});
