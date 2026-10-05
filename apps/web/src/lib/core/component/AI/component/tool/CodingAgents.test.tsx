import type { MagicChipData } from '@macro-inc/lexical-core';
import type { NamedTool } from '@service-cognition/generated/tools/tool';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  dispatchCodingAgentHandler,
  listCodingAgentsHandler,
} from './CodingAgents';
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

const result: NamedTool<'DispatchCodingAgent', 'response'> = {
  id: 'dispatch-1',
  name: 'DispatchCodingAgent',
  data: {
    agent_session_id: '0195d721-1730-7cda-a72e-855bec53411e',
    agent_id: '0195d721-1730-7cda-a72e-855bec53411f',
    agent_name: 'Frontend coder',
  },
};

describe('coding agent dispatch', () => {
  it('replaces the pending call with the live chip anchored to the dispatched turn', () => {
    const [response, setResponse] = createSignal<typeof result>();
    const view = render(() => (
      <dispatchCodingAgentHandler.render
        tool={{
          id: result.id,
          name: 'DispatchCodingAgent',
          data: {
            agent_id: result.data.agent_id,
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
      'Starting coding agent'
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
        <dispatchCodingAgentHandler.render
          tool={{
            id: result.id,
            name: 'DispatchCodingAgent',
            data: {
              agent_id: result.data.agent_id,
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
      'Could not confirm coding agent dispatch'
    );
    expect(view.queryByText('Starting coding agent…')).toBeNull();
    expect(view.queryByTestId('magic-chip')).toBeNull();
  });
});

describe('available coding agents', () => {
  it.each([false, true])(
    'updates an already mounted row when listing fails (grouped: %s)',
    (grouped) => {
      const [error, setError] = createSignal<string>();
      const view = render(() => (
        <ToolErrorContext.Provider value={error}>
          <listCodingAgentsHandler.render
            tool={{ id: 'list-1', name: 'ListCodingAgents', data: {} }}
            chat_id="chat-1"
            message_id="message-1"
            part_index={0}
            isComplete={!!error()}
            renderContext={{
              isStreaming: !error(),
              followedBy: () => false,
              grouped,
            }}
          />
        </ToolErrorContext.Provider>
      ));
      const label = view.getByText('Available coding agents');
      expect(view.queryByText('Failed')).toBeNull();
      expect(label.closest('.opacity-50')).toBeNull();

      setError('failed');
      expect(view.getByText('Failed')).toBeTruthy();
      expect(label.closest('.opacity-50')).toBeTruthy();
      expect(view.getByText('Available coding agents')).toBe(label);

      setError(undefined);
      expect(view.queryByText('Failed')).toBeNull();
      expect(label.closest('.opacity-50')).toBeNull();
    }
  );

  it('keeps an empty result discoverable in its disclosure', () => {
    const view = render(() => (
      <listCodingAgentsHandler.render
        tool={{ id: 'list-1', name: 'ListCodingAgents', data: {} }}
        response={{
          id: 'list-1',
          name: 'ListCodingAgents',
          data: { agents: [] },
        }}
        chat_id="chat-1"
        message_id="message-1"
        part_index={0}
        isComplete
        renderContext={{ isStreaming: false, followedBy: () => false }}
      />
    ));
    fireEvent.click(view.getByRole('button', { name: '0 agents' }));
    expect(view.getByText('No coding agents available.')).toBeTruthy();
  });
});
