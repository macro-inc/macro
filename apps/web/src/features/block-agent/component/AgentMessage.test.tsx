/**
 * @vitest-environment jsdom
 */

import type {
  FoldedMessage,
  MessagePart,
} from '@service-agent-fold/generated/types';
import { cleanup, render } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Message } from './AgentMessage';

// The layer under test is how a message lays its parts out — which calls fold
// into a group and at what index — so every part renderer and ui primitive
// is a marker. The per-part components have their own tests.
vi.mock('@core/util/message-send-motion', () => ({
  messageSendMotion: () => {},
}));
vi.mock('@ui', () => ({
  UserMessageBubble: (props: { children: JSX.Element }) => (
    <div data-testid="bubble">{props.children}</div>
  ),
}));
vi.mock('./parts/TextPart', () => ({
  TextPart: (props: { text: string }) => <p data-testid="text">{props.text}</p>,
}));
vi.mock('./parts/ToolCallPart', () => ({
  ToolCallPart: (props: {
    part: { id: string };
    context: { partIndex: number };
  }) => (
    <div data-index={props.context.partIndex} data-testid="tool">
      {props.part.id}
    </div>
  ),
}));
vi.mock('./parts/PermissionPart', () => ({
  PermissionPart: () => <div data-testid="permission" />,
}));
vi.mock('./parts/PlanPart', () => ({ PlanPart: () => null }));
vi.mock('./parts/ControlPart', () => ({ ControlPart: () => null }));
vi.mock('./parts/ElicitationPart', () => ({ ElicitationPart: () => null }));
vi.mock('../ui', () => ({
  isToolActive: (status: string) =>
    status === 'pending' || status === 'running',
  Thought: (props: { text: string }) => (
    <div data-testid="thought">{props.text}</div>
  ),
  WorkingLine: () => <div data-testid="working" />,
  ActionLine: (props: { label: string }) => <div>{props.label}</div>,
  ToolGroup: (props: {
    count: number;
    active: boolean;
    latest: { label: string; detail?: string };
    children: JSX.Element;
  }) => (
    <div
      data-active={String(props.active)}
      data-count={props.count}
      data-latest={`${props.latest.label}${props.latest.detail ? ` · ${props.latest.detail}` : ''}`}
      data-testid="group"
    >
      {props.children}
    </div>
  ),
}));

afterEach(cleanup);

const text = (value: string): MessagePart => ({ kind: 'text', text: value });
const tool = (
  id: string,
  overrides?: Partial<Extract<MessagePart, { kind: 'tool_use' }>>
): MessagePart => ({
  kind: 'tool_use',
  id,
  name: { kind: 'native', name: 'Read' },
  status: 'completed',
  detail: { kind: 'read', paths: [`${id}.rs`] },
  ...overrides,
});
const permission = (toolCall: string): MessagePart => ({
  kind: 'permission',
  toolCall,
  options: [],
  outcome: { kind: 'pending' },
});
const message = (
  parts: MessagePart[],
  stop: FoldedMessage['stop'] = { kind: 'end_turn' }
): FoldedMessage => ({
  agentSessionId: 'session',
  requestId: null,
  turn: 0,
  author: { kind: 'agent' },
  parts,
  stop,
});

describe('Message tool grouping', () => {
  it('folds consecutive tool calls into one group, keeping their indices', () => {
    const view = render(() => (
      <Message
        message={message([
          text('Looking.'),
          tool('read'),
          tool('edit'),
          tool('bash', {
            name: { kind: 'native', name: 'Bash' },
            detail: {
              kind: 'terminal',
              command: 'cargo test',
              output: null,
              exitCode: 0,
            },
          }),
          text('Done.'),
        ])}
      />
    ));
    const group = view.getByTestId('group');
    expect(group.dataset.count).toBe('3');
    expect(group.dataset.active).toBe('false');
    expect(group.dataset.latest).toBe('Bash · cargo test');
    expect(view.getAllByTestId('tool').map((el) => el.dataset.index)).toEqual([
      '1',
      '2',
      '3',
    ]);
    expect(view.getAllByTestId('text').map((el) => el.textContent)).toEqual([
      'Looking.',
      'Done.',
    ]);
  });

  it('leaves a lone tool call as its own card', () => {
    const view = render(() => (
      <Message message={message([text('Looking.'), tool('read')])} />
    ));
    expect(view.queryByTestId('group')).toBeNull();
    expect(view.getByTestId('tool').dataset.index).toBe('1');
  });

  it('breaks a run at a permission prompt', () => {
    const view = render(() => (
      <Message
        message={message([
          tool('a'),
          tool('b'),
          permission('b'),
          tool('c'),
          tool('d'),
        ])}
      />
    ));
    expect(view.getAllByTestId('group').map((el) => el.dataset.count)).toEqual([
      '2',
      '2',
    ]);
    expect(view.getByTestId('permission')).toBeTruthy();
  });

  it('reads as active while a call in the run is still running', () => {
    const view = render(() => (
      <Message
        message={message([tool('a'), tool('b', { status: 'running' })], null)}
      />
    ));
    expect(view.getByTestId('group').dataset.active).toBe('true');
  });

  it('keeps the group mounted as streamed calls extend the run', () => {
    const [store, setStore] = createStore({
      message: message([text('Looking.'), tool('a'), tool('b')], null),
    });
    const view = render(() => <Message message={store.message} />);
    const group = view.getByTestId('group');
    expect(group.dataset.count).toBe('2');

    setStore(
      'message',
      reconcile(
        message([text('Looking.'), tool('a'), tool('b'), tool('c')], null)
      )
    );
    expect(view.getByTestId('group')).toBe(group);
    expect(group.dataset.count).toBe('3');
    expect(group.dataset.latest).toBe('Read · c.rs');
    expect(view.getAllByTestId('tool').map((el) => el.dataset.index)).toEqual([
      '1',
      '2',
      '3',
    ]);
  });

  it('promotes a lone call to a group when a second follows it', () => {
    const [store, setStore] = createStore({
      message: message([text('Looking.'), tool('a')], null),
    });
    const view = render(() => <Message message={store.message} />);
    expect(view.queryByTestId('group')).toBeNull();
    const prose = view.getByTestId('text');

    setStore(
      'message',
      reconcile(message([text('Looking.'), tool('a'), tool('b')], null))
    );
    expect(view.getByTestId('group').dataset.count).toBe('2');
    expect(view.getByTestId('text')).toBe(prose);
  });
});
