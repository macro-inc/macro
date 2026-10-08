/**
 * @vitest-environment jsdom
 */

import type {
  FoldedMessage,
  MessagePart,
} from '@service-agent-fold/generated/types';
import { cleanup, render } from '@solidjs/testing-library';
import { createSignal, type JSX, onMount } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Message } from './AgentMessage';

const renderTelemetry = vi.hoisted(() => ({
  context: vi.fn(),
  observe: vi.fn(),
}));
vi.mock('../context/AgentSessionContext', () => ({
  useOptionalAgentSession: renderTelemetry.context,
}));

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
  TextPart: (props: {
    text: string;
    observeRender?: (element: HTMLElement) => void;
  }) => {
    let element!: HTMLParagraphElement;
    onMount(() => props.observeRender?.(element));
    return (
      <p ref={element} data-testid="text">
        {props.text}
      </p>
    );
  },
}));
vi.mock('./parts/ToolCallPart', () => ({
  ToolCallPart: (props: {
    part: { id: string; status: string };
    context: {
      partIndex: number;
      inFlight: boolean;
      followedBy: (name: string) => boolean;
    };
  }) => (
    <div
      data-index={props.context.partIndex}
      data-followed-by-save={String(
        props.context.followedBy('SaveDatabaseQuery')
      )}
      data-status={props.part.status}
      data-live={String(props.context.inFlight)}
      data-testid="tool"
    >
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
  ActionLine: (props: { label: string; detail?: string }) => (
    <div data-testid="action-line" data-detail={props.detail}>
      {props.label}
    </div>
  ),
  FailureNoticeCard: (props: {
    notice: { title: string; body: string; link?: { url: string } | null };
  }) => (
    <div data-link={props.notice.link?.url} data-testid="failure-notice">
      {props.notice.title}
    </div>
  ),
}));
vi.mock('../views/LiveToolGroup', () => ({
  LiveToolGroup: (props: {
    count: number;
    active: boolean;
    activeIndex?: number;
    children: JSX.Element;
  }) => (
    <div
      data-active={String(props.active)}
      data-count={props.count}
      data-active-index={props.activeIndex}
      data-testid="group"
    >
      {props.children}
    </div>
  ),
}));

afterEach(() => {
  viewerId.current = 'macro|me@macro.com';
  renderTelemetry.context.mockReset();
  renderTelemetry.observe.mockReset();
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
  it('renders leading prompt context above the user bubble', () => {
    const context = '<session>Owner and origin</session>';
    const prompt = `<m-agent-context>${JSON.stringify({ version: 1, text: context })}</m-agent-context>\n\nHello`;
    const userMessage = {
      ...message([text(prompt)]),
      author: { kind: 'user' as const, userId: null },
    };
    const view = render(() => (
      <Message message={userMessage} inFlight={false} />
    ));
    const line = view.getByTestId('action-line');
    expect(line.textContent).toBe('Agent context');
    expect(line.getAttribute('data-detail')).toBe(context);
    expect(view.getByTestId('bubble').contains(line)).toBe(false);
    expect(view.getByTestId('text').textContent).toBe('Hello');
  });

  it('observes only agent answer DOM on the existing session and matching turn', () => {
    renderTelemetry.context.mockReturnValue({
      observeRenderedText: renderTelemetry.observe,
    });
    const answer = message([text('Hello')]);
    answer.turn = 3;
    render(() => <Message message={answer} inFlight />);
    expect(renderTelemetry.observe).toHaveBeenCalledExactlyOnceWith(
      'session',
      3,
      expect.any(HTMLElement)
    );
    cleanup();
    renderTelemetry.observe.mockClear();
    render(() => (
      <Message
        message={{ ...answer, author: { kind: 'user', userId: null } }}
        inFlight={false}
      />
    ));
    expect(renderTelemetry.observe).not.toHaveBeenCalled();
  });

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
    expect(group.dataset.activeIndex).toBeUndefined();
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

  it('tells each call whether a later call of the turn saves the query', () => {
    const view = render(() => (
      <Message
        message={message([
          {
            kind: 'tool_use',
            id: 'query',
            name: { kind: 'mcp', server: 'macro', tool: 'QueryDatabase' },
            status: 'completed',
            detail: { kind: 'macro', input: {}, output: {}, error: null },
          },
          {
            kind: 'tool_use',
            id: 'save',
            name: { kind: 'mcp', server: 'macro', tool: 'SaveDatabaseQuery' },
            status: 'completed',
            detail: { kind: 'macro', input: {}, output: {}, error: null },
          },
          text('Saved.'),
        ])}
        inFlight={false}
      />
    ));
    expect(
      view
        .getAllByTestId('tool')
        .map((el) => [el.textContent, el.dataset.followedBySave])
    ).toEqual([
      ['query', 'true'],
      ['save', 'false'],
    ]);
  });

  it('starts a stable group with the first tool call', () => {
    const view = render(() => (
      <Message
        message={message([text('Looking.'), tool('read')])}
        inFlight={false}
      />
    ));
    expect(view.getByTestId('group').dataset.count).toBe('1');
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

  it('keeps DisplayResults outside the tool groups before and after it', () => {
    const [reply, setReply] = createSignal(
      message(
        [
          tool('a'),
          tool('b'),
          tool('display', {
            name: { kind: 'mcp', server: 'macro', tool: 'DisplayResults' },
            status: 'pending',
            detail: { kind: 'macro', input: null, output: null, error: null },
          }),
          tool('c'),
          tool('d'),
        ],
        null
      )
    );
    const view = render(() => <Message message={reply()} inFlight />);
    const groups = view.getAllByTestId('group');
    const display = view.getByText('display');
    expect(groups.map((group) => group.dataset.count)).toEqual(['2', '2']);
    expect(display.closest('[data-testid="group"]')).toBeNull();
    expect(view.getAllByTestId('tool').map((row) => row.dataset.index)).toEqual(
      ['0', '1', '2', '3', '4']
    );

    setReply((previous) => ({
      ...previous,
      parts: previous.parts.map((part) =>
        part.kind === 'tool_use' && part.id === 'display'
          ? { ...part, status: 'completed' }
          : part
      ),
    }));
    expect(view.getByText('display')).toBe(display);
    expect(display.closest('[data-testid="group"]')).toBeNull();
    expect(view.getAllByTestId('group')).toEqual(groups);
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

  it('follows unfinished work even when later calls have completed', () => {
    const view = render(() => (
      <Message
        message={message(
          [tool('slow', { status: 'running' }), tool('fast')],
          null
        )}
        inFlight
      />
    ));
    expect(view.getByTestId('group').dataset.activeIndex).toBe('0');
  });

  it('keeps delegated agents visible between tool bursts', () => {
    const view = render(() => (
      <Message
        message={message(
          [
            tool('before'),
            tool('agent', {
              status: 'running',
              detail: {
                kind: 'subagent',
                title: 'Investigate',
                agentType: null,
                description: null,
                background: false,
                prompt: null,
                children: [],
                result: null,
              },
            }),
            tool('after'),
          ],
          null
        )}
        inFlight
      />
    ));
    const agent = view
      .getAllByTestId('tool')
      .find((el) => el.textContent === 'agent');
    expect(agent?.closest('[data-testid="group"]')).toBeNull();
    expect(agent?.dataset.index).toBe('1');
    expect(view.getAllByTestId('group')).toHaveLength(2);
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
    expect(group.dataset.activeIndex).toBeUndefined();
    expect(view.getAllByTestId('tool').map((el) => el.dataset.index)).toEqual([
      '1',
      '2',
      '3',
    ]);
  });

  it('keeps the first tool and its group mounted when a second follows it', () => {
    const [store, setStore] = createStore({
      message: message([text('Looking.'), tool('a')], null),
    });
    const view = render(() => <Message message={store.message} inFlight />);
    const group = view.getByTestId('group');
    const firstTool = view.getByTestId('tool');
    const prose = view.getByTestId('text');

    setStore(
      'message',
      reconcile(message([text('Looking.'), tool('a'), tool('b')], null))
    );
    expect(view.getByTestId('group').dataset.count).toBe('2');
    expect(view.getByTestId('group')).toBe(group);
    expect(view.getAllByTestId('tool')[0]).toBe(firstTool);
    expect(view.getByTestId('text')).toBe(prose);
  });

  it('updates immutable streamed calls without remounting their rows', () => {
    const [reply, setReply] = createSignal(
      message([tool('a'), tool('b', { status: 'running' })], null)
    );
    const view = render(() => <Message message={reply()} inFlight />);
    const group = view.getByTestId('group');
    const rows = view.getAllByTestId('tool');

    setReply(
      message([tool('a'), tool('b'), tool('c', { status: 'running' })], null)
    );
    expect(view.getByTestId('group')).toBe(group);
    expect(view.getAllByTestId('tool')[0]).toBe(rows[0]);
    expect(view.getAllByTestId('tool')[1]).toBe(rows[1]);
    expect(rows[1].dataset.status).toBe('completed');
    expect(view.getAllByTestId('tool')[2].dataset.status).toBe('running');
  });

  it('keeps completed batches inactive even at the live tail', () => {
    const view = render(() => (
      <Message message={message([tool('a'), tool('b')], null)} inFlight />
    ));
    expect(view.getByTestId('group').dataset.activeIndex).toBeUndefined();
    expect(view.getByTestId('group').dataset.active).toBe('false');
  });

  it('preserves unfinished call status when another part follows the group', () => {
    const view = render(() => (
      <Message
        message={message(
          [tool('a'), tool('b', { status: 'running' }), text('Answer')],
          null
        )}
        inFlight
      />
    ));
    expect(view.getByTestId('group').dataset.active).toBe('true');
    expect(view.getByTestId('group').dataset.activeIndex).toBe('1');
    expect(view.getAllByTestId('tool').map((row) => row.dataset.live)).toEqual([
      'true',
      'true',
    ]);
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

  it('does not duplicate the active tool or group with a working shimmer', () => {
    const view = render(() => (
      <Message
        message={message([tool('a'), tool('b', { status: 'running' })], null)}
        inFlight
      />
    ));
    expect(view.getByTestId('group').dataset.active).toBe('true');
    expect(view.queryByTestId('working')).toBeNull();
  });

  it('does not duplicate an active batch when its final call completes first', () => {
    const view = render(() => (
      <Message
        message={message([tool('a', { status: 'running' }), tool('b')], null)}
        inFlight
      />
    ));
    expect(view.getByTestId('group').dataset.active).toBe('true');
    expect(view.queryByTestId('working')).toBeNull();
  });
});

describe('Message thought shimmer', () => {
  const thought = (value: string): MessagePart => ({
    kind: 'thought',
    text: value,
  });

  it('keeps consecutive thoughts visible without creating an empty tool group', () => {
    const [reply, setReply] = createSignal(
      message(
        [
          text('Looking.'),
          thought('First thought'),
          thought('Second thought'),
          text('Answer.'),
        ],
        null
      )
    );
    const view = render(() => <Message message={reply()} inFlight />);
    const thoughts = view.getAllByTestId('thought');
    expect(thoughts.map((row) => row.textContent)).toEqual([
      'First thought',
      'Second thought',
    ]);
    expect(thoughts.map((row) => row.dataset.active)).toEqual([
      'false',
      'false',
    ]);
    expect(view.queryByTestId('group')).toBeNull();
    expect(view.getAllByTestId('text').map((row) => row.textContent)).toEqual([
      'Looking.',
      'Answer.',
    ]);

    setReply(
      message(
        [
          text('Looking.'),
          thought('First thought'),
          thought('Updated thought'),
          text('Answer continued.'),
        ],
        null
      )
    );
    expect(view.getAllByTestId('thought')[0]).toBe(thoughts[0]);
    expect(view.getAllByTestId('thought')[1]).toBe(thoughts[1]);
    expect(thoughts[1].textContent).toBe('Updated thought');
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

  it('settles a lone active call without adding another working row', () => {
    const [state, setState] = createStore({ inFlight: true });
    const view = render(() => (
      <Message
        message={message([tool('read', { status: 'running' })], null)}
        inFlight={state.inFlight}
      />
    ));
    expect(view.getByTestId('tool').dataset.live).toBe('true');
    expect(view.queryByTestId('working')).toBeNull();

    setState('inFlight', false);
    expect(view.getByTestId('tool').dataset.live).toBe('false');
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

  it('renders a notification Cursor wrote full-width, not as a prompt', () => {
    const notification = [
      '<system_notification source="github" conclusion="success" checks="27" subscriptionType="github:ci:branch">',
      'All 27 CI checks completed without failures.',
      '</system_notification>',
    ].join('\n');
    const view = render(() => (
      <Message
        message={{
          ...message([text(notification)]),
          author: { kind: 'user', userId: 'macro|wolf@macro.com' },
        }}
        inFlight={false}
      />
    ));
    expect(view.queryByTestId('bubble')).toBeNull();
    expect(view.queryByTestId('prompt-author')).toBeNull();
    expect(view.getByTestId('text').textContent).toBe(notification);
  });
});

describe('Message failed turns', () => {
  it('reads an opaque failure as an action line carrying the runtime message', () => {
    const view = render(() => (
      <Message
        message={message([], {
          kind: 'failed',
          message: 'Internal error: something broke',
        })}
        inFlight={false}
      />
    ));
    expect(view.getByTestId('action-line').dataset.detail).toBe(
      'Internal error: something broke'
    );
    expect(view.queryByTestId('failure-notice')).toBeNull();
  });

  it("shows a classified failure as a notice card, not the runtime's message", () => {
    const view = render(() => (
      <Message
        message={message([], {
          kind: 'failed',
          message: 'Cursor usage limit reached. Raise the limit.',
          notice: {
            kind: 'provider_usage_limit',
            title: 'Cursor usage limit reached',
            body: 'Raise the spending limit in your Cursor dashboard.',
            link: {
              label: 'Manage Cursor usage',
              url: 'https://www.cursor.com/dashboard?tab=settings',
            },
          },
        })}
        inFlight={false}
      />
    ));
    const notice = view.getByTestId('failure-notice');
    expect(notice.textContent).toBe('Cursor usage limit reached');
    expect(notice.dataset.link).toBe(
      'https://www.cursor.com/dashboard?tab=settings'
    );
    expect(view.queryByTestId('action-line')).toBeNull();
  });
});
