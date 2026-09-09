import type {
  FoldedMessage,
  MessagePart,
} from '@service-agent-fold/generated/types';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../ui', () => ({
  ActionLine: () => null,
  Thought: () => <span>Thought</span>,
}));
vi.mock('./parts/ToolCallPart', () => ({
  ToolCallPart: () => <span>Tool result</span>,
}));
vi.mock('./parts/PermissionPart', () => ({
  PermissionPart: () => <button>Approve</button>,
}));
vi.mock('./parts/PlanPart', () => ({ PlanPart: () => null }));
vi.mock('./parts/ControlPart', () => ({ ControlPart: () => null }));
vi.mock('./parts/TextPart', () => ({
  TextPart: (props: { text: string }) => <p>{props.text}</p>,
}));

import { Message } from './AgentMessage';

afterEach(cleanup);
const tool = (id: string): MessagePart =>
  ({
    kind: 'tool_use',
    id,
    name: { kind: 'native', name: 'read' },
    status: 'completed',
    detail: { kind: 'read', paths: ['file.ts'] },
  }) as MessagePart;

it('keeps collapsed activity collapsed during streaming and leaves permissions visible', async () => {
  const [message, setMessage] = createSignal({
    agentSessionId: 'session',
    turn: 0,
    author: { kind: 'agent' },
    stop: null,
    parts: [tool('a'), tool('b'), { kind: 'permission' }],
  } as FoldedMessage);
  const view = render(() => <Message message={message()} />);
  const summary = view.getByRole('button', { name: '2 tool calls' });
  expect(summary.getAttribute('aria-expanded')).toBe('true');
  await fireEvent.click(summary);
  expect(summary.getAttribute('aria-expanded')).toBe('false');
  expect(view.getByRole('button', { name: 'Approve' })).toBeTruthy();
  setMessage((previous) => ({
    ...previous,
    parts: [
      tool('a'),
      tool('b'),
      tool('c'),
      { kind: 'permission' } as MessagePart,
    ],
  }));
  expect(
    view
      .getByRole('button', { name: '3 tool calls' })
      .getAttribute('aria-expanded')
  ).toBe('false');
  expect(view.getByRole('button', { name: 'Approve' })).toBeTruthy();
});
