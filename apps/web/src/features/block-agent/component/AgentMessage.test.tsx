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
const viewerId = vi.hoisted(() => ({
  current: 'macro|me@macro.com' as string | undefined,
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => viewerId.current,
}));
vi.mock('@core/user/util', () => ({
  idToDisplayName: (id: string) => id.replace(/^macro\|/, ''),
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
vi.mock('./parts/AttachmentPart', () => ({
  AttachmentPart: (props: { part: { name: string } }) => (
    <div data-testid="attachment">{props.part.name}</div>
  ),
}));
vi.mock('./parts/ControlPart', () => ({ ControlPart: () => null }));
vi.mock('./parts/ElicitationPart', () => ({ ElicitationPart: () => null }));
vi.mock('../ui', () => ({
  isToolActive: (status: string) =>
    status === 'pending' || status === 'running',
  Thought: (props: { text: string; active?: boolean }) => (
    <div data-active={String(props.active ?? false)} data-testid="thought">
      {props.text}
    </div>
  ),
  WorkingLine: (props: { label?: string }) => (
    <div data-testid="working">{props.label}</div>
  ),
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

afterEach(() => {
  viewerId.current = 'macro|me@macro.com';
  cleanup();
});

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
  requestId: 'permission-test',
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
  pending: false,
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
        inFlight={false}
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
      <Message
        message={message([text('Looking.'), tool('read')])}
        inFlight={false}
      />
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
        inFlight={false}
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
        inFlight
      />
    ));
    expect(view.getByTestId('group').dataset.active).toBe('true');
  });

  it('settles a run the log left running once the turn is no longer live', () => {
    // A superseded turn keeps `stop: null` and its last call `running`
    // forever; a dead runtime leaves the tail the same way.
    const view = render(() => (
      <Message
        message={message([tool('a'), tool('b', { status: 'running' })], null)}
        inFlight={false}
      />
    ));
    expect(view.getByTestId('group').dataset.active).toBe('false');
    expect(view.queryByTestId('working')).toBeNull();
  });

  it('keeps the group mounted as streamed calls extend the run', () => {
    const [store, setStore] = createStore({
      message: message([text('Looking.'), tool('a'), tool('b')], null),
    });
    const view = render(() => <Message message={store.message} inFlight />);
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
    const view = render(() => <Message message={store.message} inFlight />);
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

describe('Message working tail', () => {
  it('names the work after the last part of an open turn', () => {
    const view = render(() => (
      <Message
        message={message([text('Looking.'), tool('a')], null)}
        inFlight
      />
    ));
    expect(view.getByTestId('working').textContent).toBe('Running tools');
  });
});

describe('Message thought shimmer', () => {
  const thought = (value: string): MessagePart => ({
    kind: 'thought',
    text: value,
  });

  it('keeps grouped thoughts at their real indices when the group opens', () => {
    const view = render(() => (
      <Message
        message={message(
          [thought('why this file'), tool('read'), tool('edit')],
          null
        )}
        inFlight
      />
    ));
    expect(view.getByTestId('thought').dataset.active).toBe('false');
    expect(view.getByTestId('thought').textContent).toBe('why this file');
    expect(view.getAllByTestId('tool').map((el) => el.dataset.index)).toEqual([
      '1',
      '2',
    ]);
  });

  it('shimmers only the trailing thought of an open turn', () => {
    const view = render(() => (
      <Message
        message={message(
          [
            thought('already decided'),
            tool('read'),
            thought('still weighing this'),
          ],
          null
        )}
        inFlight
      />
    ));
    const rows = view.getAllByTestId('thought');
    expect(rows.map((el) => el.textContent)).toEqual([
      'already decided',
      'still weighing this',
    ]);
    expect(rows.map((el) => el.dataset.active)).toEqual(['false', 'true']);
  });

  it('settles the trailing thought of an unclosed turn the session is not working on', () => {
    const view = render(() => (
      <Message
        message={message(
          [thought('already decided'), tool('read'), thought('cut off here')],
          null
        )}
        inFlight={false}
      />
    ));
    expect(
      view.getAllByTestId('thought').map((el) => el.dataset.active)
    ).toEqual(['false', 'false']);
  });

  it('moves the tail thought from Thinking to Thought when the turn settles', () => {
    const [state, setState] = createStore({ inFlight: true });
    const view = render(() => (
      <Message
        message={message([tool('read'), thought('wrapping up')], null)}
        inFlight={state.inFlight}
      />
    ));
    expect(view.getByTestId('thought').dataset.active).toBe('true');

    setState('inFlight', false);
    expect(view.getByTestId('thought').dataset.active).toBe('false');
  });

  it('drops the working row when the turn settles with a call still open', () => {
    const [state, setState] = createStore({ inFlight: true });
    const view = render(() => (
      <Message
        message={message([tool('read', { status: 'running' })], null)}
        inFlight={state.inFlight}
      />
    ));
    expect(view.getByTestId('working')).toBeTruthy();

    setState('inFlight', false);
    expect(view.queryByTestId('working')).toBeNull();
  });

  it('settles a thought once prose follows it', () => {
    const view = render(() => (
      <Message
        message={message(
          [thought('weighing'), text('Here is the answer.')],
          null
        )}
        inFlight
      />
    ));
    expect(view.getByTestId('thought').dataset.active).toBe('false');
  });

  it('settles every thought once the turn has a stop reason', () => {
    const view = render(() => (
      <Message message={message([thought('done thinking')])} inFlight={false} />
    ));
    expect(view.getByTestId('thought').dataset.active).toBe('false');
  });
});

describe('Message prompt attribution', () => {
  const prompt = (userId: string | null): FoldedMessage => ({
    ...message([text('Do the thing.')]),
    author: { kind: 'user', userId },
  });

  it("names the sender above another participant's prompt", () => {
    const view = render(() => (
      <Message message={prompt('macro|wolf@macro.com')} inFlight={false} />
    ));
    expect(view.getByTestId('prompt-author').textContent).toBe(
      'wolf@macro.com'
    );
    expect(view.getByTestId('bubble').textContent).toBe('Do the thing.');
  });

  it("leaves the viewer's own prompt unlabelled", () => {
    const view = render(() => (
      <Message message={prompt('macro|me@macro.com')} inFlight={false} />
    ));
    expect(view.queryByTestId('prompt-author')).toBeNull();
    expect(view.getByTestId('bubble')).toBeTruthy();
  });

  it('leaves an unattributed prompt unlabelled', () => {
    const view = render(() => (
      <Message message={prompt(null)} inFlight={false} />
    ));
    expect(view.queryByTestId('prompt-author')).toBeNull();
    expect(view.getByTestId('bubble')).toBeTruthy();
  });

  it('leaves a prompt unlabelled while the viewer id is still loading', () => {
    viewerId.current = undefined;
    const view = render(() => (
      <Message message={prompt('macro|me@macro.com')} inFlight={false} />
    ));
    expect(view.queryByTestId('prompt-author')).toBeNull();
    expect(view.getByTestId('bubble')).toBeTruthy();
  });
});
