import type { MagicChipData } from '@macro-inc/lexical-core';
import type { NamedTool } from '@service-cognition/generated/tools/tool';
import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startAgentSessionHandler } from './StartAgentSession';
import { ToolErrorContext } from './ToolRenderer';

vi.mock('../../../LexicalMarkdown/component/decorator/MagicChip', () => ({
  MagicChip: (props: MagicChipData) => (
    <div
      data-testid="magic-chip"
      data-session={props.agentSessionId}
      data-message={JSON.stringify(props.promptedMessage)}
      data-status={props.status}
    />
  ),
}));

afterEach(cleanup);

const result: NamedTool<'StartAgentSession', 'response'> = {
  id: 'dispatch-1',
  name: 'StartAgentSession',
  data: {
    agent_session_id: '0195d721-1730-7cda-a72e-855bec53411e',
    agent_id: '0195d721-1730-7cda-a72e-855bec53411f',
    agent_name: 'Frontend coder',
  },
};

describe('agent session launch', () => {
  it('replaces the pending call with the live chip anchored to the dispatched turn', () => {
    const [response, setResponse] = createSignal<typeof result>();
    const view = render(() => (
      <startAgentSessionHandler.render
        tool={{
          id: result.id,
          name: 'StartAgentSession',
          data: {
            agent: result.data.agent_id,
            prompt: 'Fix the editor layout',
          },
        }}
        response={response()}
        chat_id="chat-1"
        message_id="message-1"
        part_index={0}
        isComplete={!!response()}
        renderContext={{ isStreaming: !response(), followedBy: () => false }}
      />
    ));
    expect(view.getByRole('status').textContent).toContain(
      'Starting agent session'
    );
    expect(view.queryByTestId('magic-chip')).toBeNull();
    setResponse(result);
    const chip = view.getByTestId('magic-chip');
    expect(chip.dataset.session).toBe(result.data.agent_session_id);
    expect(JSON.parse(chip.dataset.message ?? '')).toEqual({
      turn: 0,
      author: 'user',
    });
    expect(chip.dataset.status).toBe('booting');
    expect(view.queryByRole('status')).toBeNull();
  });

  it('shows a dispatch error without leaving a starting indicator or session card', () => {
    const [error, setError] = createSignal<string>();
    const view = render(() => (
      <ToolErrorContext.Provider value={error}>
        <startAgentSessionHandler.render
          tool={{
            id: result.id,
            name: 'StartAgentSession',
            data: {
              agent: result.data.agent_id,
              prompt: 'Fix the editor layout',
            },
          }}
          chat_id="chat-1"
          message_id="message-1"
          part_index={0}
          isComplete={!!error()}
          renderContext={{ isStreaming: !error(), followedBy: () => false }}
        />
      </ToolErrorContext.Provider>
    ));
    setError('failed');
    expect(view.getByRole('status').textContent).toContain(
      'Could not confirm agent session start'
    );
    expect(view.queryByText('Starting agent session…')).toBeNull();
    expect(view.queryByTestId('magic-chip')).toBeNull();
  });
});
