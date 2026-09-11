/** @vitest-environment jsdom */

import type { FoldedMessage } from '@service-agent-fold/generated/types';
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WORKING_LABEL } from '../ui/working-verbs';
import { Message } from './AgentMessage';

vi.mock('./parts/TextPart', () => ({
  TextPart: (props: { text: string }) => <span>{props.text}</span>,
}));
vi.mock('./parts/ToolCallPart', () => ({ ToolCallPart: () => null }));
vi.mock('./parts/ControlPart', () => ({ ControlPart: () => null }));
vi.mock('./parts/ElicitationPart', () => ({ ElicitationPart: () => null }));
vi.mock('./parts/PermissionPart', () => ({ PermissionPart: () => null }));
vi.mock('./parts/PlanPart', () => ({ PlanPart: () => null }));
vi.mock('../ui', () => ({
  ActionLine: () => null,
  Thought: (props: { text: string }) => <span>{props.text}</span>,
  WorkingLine: () => (
    <div data-working-line aria-label="Working">
      Working
    </div>
  ),
}));

afterEach(cleanup);

const message = (
  author: 'user' | 'agent',
  parts: FoldedMessage['parts'],
  stop: FoldedMessage['stop'] = null
): FoldedMessage =>
  ({
    agentSessionId: 'session',
    turn: 0,
    requestId: null,
    author:
      author === 'user' ? { kind: 'user', userId: null } : { kind: 'agent' },
    parts,
    stop,
  }) as FoldedMessage;

describe('Message working line', () => {
  it('shows while an in-flight reply has nothing else narrating the wait', () => {
    const empty = render(() => <Message message={message('agent', [])} />);
    expect(empty.container.querySelector('[data-working-line]')).not.toBeNull();
    expect(empty.getAllByLabelText(WORKING_LABEL)).toHaveLength(1);

    const prose = render(() => (
      <Message message={message('agent', [{ kind: 'text', text: 'On it.' }])} />
    ));
    expect(prose.container.querySelector('[data-working-line]')).not.toBeNull();
  });

  it('stays hidden behind a thought shimmer or a settled turn', () => {
    const thinking = render(() => (
      <Message message={message('agent', [{ kind: 'thought', text: 'hmm' }])} />
    ));
    expect(thinking.container.querySelector('[data-working-line]')).toBeNull();

    const done = render(() => (
      <Message
        message={message('agent', [{ kind: 'text', text: 'done' }], {
          kind: 'end_turn',
        })}
      />
    ));
    expect(done.container.querySelector('[data-working-line]')).toBeNull();
  });

  it('hangs off the prompt while the agent has not begun thinking', () => {
    const waiting = render(() => (
      <Message
        message={message('user', [{ kind: 'text', text: 'hi' }])}
        awaitingReply
      />
    ));
    expect(
      waiting.container.querySelector('[data-working-line]')
    ).not.toBeNull();

    const idle = render(() => (
      <Message message={message('user', [{ kind: 'text', text: 'hi' }])} />
    ));
    expect(idle.container.querySelector('[data-working-line]')).toBeNull();
  });
});
