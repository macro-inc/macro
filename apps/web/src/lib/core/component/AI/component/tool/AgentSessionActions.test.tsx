import type { MagicChipData } from '@macro-inc/lexical-core';
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import {
  createAgentSessionHandler,
  manageAgentSessionHandler,
} from './AgentSessionActions';
import { ToolErrorContext } from './ToolRenderer';

vi.mock('../../../LexicalMarkdown/component/decorator/MagicChip', () => ({
  MagicChip: (props: MagicChipData) => (
    <div data-testid="session" data-session={props.agentSessionId} />
  ),
}));
afterEach(cleanup);
const id = '0195d721-1730-7cda-a72e-855bec53411e';
const context = {
  chat_id: 'chat',
  message_id: 'message',
  part_index: 0,
  isComplete: true,
  renderContext: { isStreaming: false, followedBy: () => false },
};

it('links the created session instead of showing its raw response', () => {
  const view = render(() => (
    <createAgentSessionHandler.render
      {...context}
      tool={{
        id,
        name: 'CreateAgentSession',
        data: { agentId: id, prompt: 'Research this topic' },
      }}
      response={{
        id,
        name: 'CreateAgentSession',
        data: { agent_id: id, agent_session_id: id, agent_name: 'Researcher' },
      }}
    />
  ));
  expect(view.getByTestId('session').dataset.session).toBe(id);
  expect(view.queryByRole('status')).toBeNull();
});

it('does not present an uncertain prompt as completed work', () => {
  const view = render(() => (
    <ToolErrorContext.Provider
      value={() => ({ kind: 'failed', reason: 'delivery unknown' })}
    >
      <manageAgentSessionHandler.render
        {...context}
        tool={{
          id,
          name: 'ManageAgentSession',
          data: {
            sessionId: id,
            action: { type: 'prompt', prompt: 'Continue' },
          },
        }}
      />
    </ToolErrorContext.Provider>
  ));
  expect(view.getByText('Could not confirm')).toBeTruthy();
  expect(view.queryByText('Complete')).toBeNull();
});
