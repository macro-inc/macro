/**
 * @vitest-environment jsdom
 */

import { publishSessionActivity } from '@core/agent-session/session-activity';
import type {
  FoldedMessage,
  MessagePart,
} from '@service-agent-fold/generated/types';
import { cleanup, render } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
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
const openedOrigins = vi.hoisted(() => [] as unknown[]);
vi.mock('../open-prompt-origin', () => ({
  useOpenPromptOrigin: () => (destination: unknown, options: unknown) => {
    openedOrigins.push({ destination, options });
  },
}));

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
vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  () => ({
    StaticMarkdown: (props: { markdown: string }) => (
      <p data-testid="text">{props.markdown}</p>
    ),
  })
);
vi.mock('@core/component/LexicalMarkdown/theme', () => ({
  channelTheme: {},
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
  ToolGroup: (props: {
    count: number;
    failed?: number;
    live?: boolean;
    steps?: readonly { label: string; status: string }[];
    summary?: string;
    children: JSX.Element;
  }) => (
    <div
      data-count={props.count}
      data-failed={props.failed ?? 0}
      data-live-line={String(props.live ?? false)}
      data-steps={props.steps
        ?.map((step) => `${step.label}:${step.status}`)
        .join('|')}
      data-summary={props.summary}
      data-testid="group"
    >
      {props.children}
    </div>
  ),
}));
const programs = vi.hoisted(() => ({
  steps: {} as Record<string, number>,
  failures: {} as Record<string, number>,
  activity: {} as Record<
    string,
    { id: number; label: string; status: string }[]
  >,
}));
vi.mock('../views/code-execution-record', () => ({
  useCodeExecutionRecord: (part: () => { id: string }) => ({
    steps: () => programs.steps[part().id] ?? 0,
    failures: () => programs.failures[part().id] ?? 0,
    record: () => {
      const activity = programs.activity[part().id];
      return activity ? { activity } : undefined;
    },
  }),
}));

afterEach(() => {
  viewerId.current = 'macro|me@macro.com';
  publishSessionActivity('session', null);
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
type Row = FoldedMessage['segments'][number]['rows'][number];
const row = (
  id: string,
  label: string,
  status: Row['status'] = 'completed',
  detail: string | null = null
): Row => ({ id, label, detail, status, card: null });
const message = (
  parts: MessagePart[],
  stop: FoldedMessage['stop'] = { kind: 'end_turn' },
  rows: Row[] = []
): FoldedMessage => ({
  agentSessionId: 'session',
  key: '0:agent',
  requestId: null,
  pending: false,
  postedAt: null,
  segments: [
    {
      index: 0,
      kind: 'activity',
      start: 0,
      end: parts.length,
      sealed: stop !== null,
      rows,
    },
  ],
  phase: null,
  turn: 0,
  author: { kind: 'agent' },
  parts,
  stop,
});

describe('Message incomplete mentions', () => {
  const partial = 'See <m-document-mention>{"documentId":"unfinished';

  it('keeps a cancelled reply clean when stopping and after remount', () => {
    const [reply, setReply] = createSignal(message([text(partial)], null));
    const [inFlight, setInFlight] = createSignal(true);
    const view = render(() => (
      <Message message={reply()} inFlight={inFlight()} />
    ));
    expect(view.getByTestId('text').textContent).toBe('See ');

    setReply(message([text(partial)], { kind: 'cancelled' }));
    setInFlight(false);
    expect(view.getByTestId('text').textContent).toBe('See ');
    view.unmount();

    const restored = render(() => (
      <Message message={reply()} inFlight={false} />
    ));
    expect(restored.getByTestId('text').textContent).toBe('See ');
  });

  it('hides an interrupted reply without a recorded stop reason', () => {
    const view = render(() => (
      <Message message={message([text(partial)], null)} inFlight={false} />
    ));
    expect(view.getByTestId('text').textContent).toBe('See ');
  });

  it('preserves unfinished markup in user prompts', () => {
    const view = render(() => (
      <Message
        message={{
          ...message([text(partial)]),
          author: { kind: 'user', userId: null },
        }}
        inFlight={false}
      />
    ));
    expect(view.getByTestId('text').textContent).toBe(partial);
  });
});

describe('Message tool grouping', () => {
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
    expect(group.dataset.liveLine).toBe('false');
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
            detail: { kind: 'view', view: null, error: null },
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

  it('is the live line while a call in the run is still running', () => {
    const view = render(() => (
      <Message
        message={message([tool('a'), tool('b', { status: 'running' })], null)}
        inFlight
      />
    ));
    expect(view.getByTestId('group').dataset.liveLine).toBe('true');
  });

  it('names each call by its fold row and what it acted on', () => {
    const view = render(() => (
      <Message
        message={message(
          [tool('slow', { status: 'running' }), tool('fast')],
          null,
          [
            row('slow', 'Reading', 'running', 'slow.rs'),
            row('fast', 'Read', 'completed', 'fast.rs'),
          ]
        )}
        inFlight
      />
    ));
    expect(view.getByTestId('group').dataset.steps).toBe(
      'Reading slow.rs:running|Read fast.rs:completed'
    );
  });

  it('puts the session status line on the live run only', () => {
    publishSessionActivity('session', 'Checking the launch plan');
    const view = render(() => (
      <Message
        message={message([tool('a'), text('So far.'), tool('b')], null)}
        inFlight
      />
    ));
    const groups = view.getAllByTestId('group');
    expect(groups.map((group) => group.dataset.liveLine)).toEqual([
      'false',
      'true',
    ]);
    expect(groups.map((group) => group.dataset.summary)).toEqual([
      undefined,
      'Checking the launch plan',
    ]);
  });

  it('keeps an earlier run settled when the log left a call in it running', () => {
    const view = render(() => (
      <Message
        message={message(
          [tool('a', { status: 'running' }), text('Meanwhile.'), tool('b')],
          null
        )}
        inFlight
      />
    ));
    expect(
      view.getAllByTestId('group').map((group) => group.dataset.liveLine)
    ).toEqual(['false', 'true']);
  });

  it('stays live while one of its calls waits on a permission', () => {
    const view = render(() => (
      <Message
        message={message(
          [tool('a'), tool('b', { status: 'running' }), permission('b')],
          null
        )}
        inFlight
      />
    ));
    expect(view.getByTestId('group').dataset.liveLine).toBe('true');
    expect(view.getByTestId('permission')).toBeTruthy();
    expect(view.queryByTestId('working')).toBeNull();
  });

  it('counts the failed calls of a settled run', () => {
    const view = render(() => (
      <Message
        message={message([
          tool('a'),
          tool('b', { status: 'failed' }),
          tool('c', { status: 'failed' }),
          text('Done.'),
        ])}
        inFlight={false}
      />
    ));
    expect(view.getByTestId('group').dataset.failed).toBe('2');
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
    expect(view.getByTestId('group').dataset.liveLine).toBe('false');
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

  it('stays live between calls at the tail of an open turn', () => {
    const view = render(() => (
      <Message message={message([tool('a'), tool('b')], null)} inFlight />
    ));
    expect(view.getByTestId('group').dataset.liveLine).toBe('true');
    expect(view.queryByTestId('working')).toBeNull();
  });

  it('settles once prose follows, leaving its calls their own status', () => {
    const view = render(() => (
      <Message
        message={message(
          [tool('a'), tool('b', { status: 'running' }), text('Answer')],
          null
        )}
        inFlight
      />
    ));
    expect(view.getByTestId('group').dataset.liveLine).toBe('false');
    expect(view.getAllByTestId('tool').map((row) => row.dataset.live)).toEqual([
      'true',
      'true',
    ]);
  });
});

describe('Message tool runs', () => {
  const program = (
    id: string,
    status: 'running' | 'completed' = 'completed'
  ): MessagePart =>
    tool(id, {
      name: { kind: 'mcp', server: 'macro_internal', tool: 'ExecuteCode' },
      status,
    });
  const lookup = (id: string, name: string): MessagePart =>
    tool(id, { name: { kind: 'mcp', server: 'macro_internal', tool: name } });

  it('counts one group per segment: shown calls and program steps, never lookups or programs', () => {
    programs.steps.first = 5;
    programs.steps.second = 2;
    const view = render(() => (
      <Message
        message={message(
          [
            lookup('search', 'SearchTools'),
            lookup('load', 'LoadTools'),
            program('first'),
            tool('read'),
            program('second'),
          ],
          null
        )}
        inFlight={false}
      />
    ));
    expect(view.getAllByTestId('group')).toHaveLength(1);
    expect(view.getByTestId('group').dataset.count).toBe('8');
    expect(view.getAllByTestId('tool').map((row) => row.textContent)).toEqual([
      'first',
      'read',
      'second',
    ]);
  });

  it("names a running program's observed operations ahead of its receipt", () => {
    programs.steps.live = 2;
    programs.activity.live = [
      { id: 0, label: 'Searched documents', status: 'completed' },
      { id: 1, label: 'Reading a document', status: 'running' },
    ];
    const view = render(() => (
      <Message
        message={message(
          [
            lookup('search', 'SearchTools'),
            tool('a'),
            program('live', 'running'),
          ],
          null,
          [
            row('a', 'Read', 'completed', 'a.rs'),
            row('live', 'Working in your workspace', 'running'),
          ]
        )}
        inFlight
      />
    ));
    expect(view.getByTestId('group').dataset.steps).toBe(
      'Read a.rs:completed|Searched documents:completed|Reading a document:running'
    );
  });

  it("counts a program's failed steps with the run's failed calls", () => {
    programs.steps.timedOut = 1;
    programs.failures.timedOut = 1;
    programs.steps.partly = 3;
    programs.failures.partly = 1;
    const view = render(() => (
      <Message
        message={message([
          program('timedOut'),
          tool('a', { status: 'failed' }),
          program('partly'),
          text('Done.'),
        ])}
        inFlight={false}
      />
    ));
    const group = view.getByTestId('group');
    expect(group.dataset.count).toBe('5');
    expect(group.dataset.failed).toBe('3');
  });

  it('opens a live run before its first call names itself', () => {
    const view = render(() => (
      <Message
        message={message([lookup('search', 'SearchTools')], null)}
        inFlight
      />
    ));
    expect(view.getByTestId('group').dataset.steps).toBe('Working:running');
  });
});

describe('Message working tail', () => {
  it('lets the live run stand for the working row', () => {
    const view = render(() => (
      <Message
        message={message([text('Looking.'), tool('a')], null)}
        inFlight
      />
    ));
    expect(view.getByTestId('group').dataset.liveLine).toBe('true');
    expect(view.queryByTestId('working')).toBeNull();
  });

  it('reads as working after a call that stands outside the runs', () => {
    const view = render(() => (
      <Message
        message={message(
          [
            tool('a'),
            tool('display', {
              name: { kind: 'mcp', server: 'macro', tool: 'DisplayResults' },
              detail: { kind: 'view', view: null, error: null },
            }),
          ],
          null
        )}
        inFlight
      />
    ));
    expect(view.getByTestId('group').dataset.liveLine).toBe('false');
    expect(view.getByTestId('working').textContent).toBe('Working');
  });

  it('does not duplicate the active tool or group with a working shimmer', () => {
    const view = render(() => (
      <Message
        message={message([tool('a'), tool('b', { status: 'running' })], null)}
        inFlight
      />
    ));
    expect(view.getByTestId('group').dataset.liveLine).toBe('true');
    expect(view.queryByTestId('working')).toBeNull();
  });

  it('does not duplicate an active batch when its final call completes first', () => {
    const view = render(() => (
      <Message
        message={message([tool('a', { status: 'running' }), tool('b')], null)}
        inFlight
      />
    ));
    expect(view.getByTestId('group').dataset.liveLine).toBe('true');
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

  it('folds the trailing thought into the run, whose live line says Thinking', () => {
    const view = render(() => (
      <Message
        message={message(
          [
            thought('already decided'),
            tool('read'),
            thought('still weighing this'),
          ],
          null,
          [row('read', 'Read', 'completed', 'read.rs')]
        )}
        inFlight
      />
    ));
    const group = view.getByTestId('group');
    const rows = view.getAllByTestId('thought');
    expect(rows.map((el) => el.textContent)).toEqual([
      'already decided',
      'still weighing this',
    ]);
    expect(rows.every((el) => group.contains(el))).toBe(true);
    expect(rows.map((el) => el.dataset.active)).toEqual(['false', 'true']);
    expect(group.dataset.steps).toBe('Read read.rs:completed|Thinking:running');
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

describe('Message prompt context', () => {
  it.each([true, false])(
    'hides internal context when pending is %s',
    (pending) => {
      const raw =
        '<m-agent-context>{"version":1,"text":"Private instructions"}</m-agent-context>\n\nOnly user text.';
      const prompt: FoldedMessage = {
        ...message([text(raw)]),
        author: { kind: 'user', userId: null },
        pending,
      };
      const view = render(() => <Message message={prompt} inFlight={false} />);
      expect(view.getByTestId('bubble').textContent).toBe('Only user text.');
      expect(prompt.parts).toEqual([text(raw)]);
    }
  );
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

describe('Message prompt footer', () => {
  const context = (xml: string) =>
    `<m-agent-context>${JSON.stringify({ version: 1, text: xml }).replace(/</g, '\\u003c')}</m-agent-context>\nWork on the assigned task.`;

  it('says under the prompt what started it, and goes there on click', () => {
    openedOrigins.length = 0;
    const view = render(() => (
      <Message
        message={{
          ...message([
            text(
              context(
                '<trigger kind="task_assigned" discussion="d1"><assigned by="Julia" by_id="macro|julia@example.com"/><task id="task-1" title="Fix calendar popover scroll" status="Todo"/></trigger>'
              )
            ),
          ]),
          author: { kind: 'user', userId: 'macro|me@macro.com' },
        }}
        inFlight={false}
      />
    ));

    const line = view.getByRole('button', {
      name: 'via task Fix calendar popover scroll from Julia',
    });
    line.click();
    line.dispatchEvent(
      new MouseEvent('click', { bubbles: true, shiftKey: true })
    );
    expect(openedOrigins).toEqual([
      {
        destination: { kind: 'task', taskId: 'task-1' },
        options: { newSplit: false },
      },
      {
        destination: { kind: 'task', taskId: 'task-1' },
        options: { newSplit: true },
      },
    ]);
  });

  it('shows only when a prompt typed in the session was posted', () => {
    const view = render(() => (
      <Message
        message={{
          ...message([
            text(
              context('<session owner="Me" owner_id="macro|me@macro.com"/>')
            ),
          ]),
          author: { kind: 'user', userId: 'macro|me@macro.com' },
          postedAt: '2026-10-15T14:02:00+00:00',
        }}
        inFlight={false}
      />
    ));
    const footer = view.getByTestId('prompt-footer');
    expect(footer.querySelector('button')).toBeNull();
    expect(footer.querySelector('time')?.dateTime).toBe(
      '2026-10-15T14:02:00+00:00'
    );
  });

  it('adds nothing under a prompt the log has not confirmed', () => {
    const view = render(() => (
      <Message
        message={{
          ...message([text('Do the thing.')]),
          author: { kind: 'user', userId: 'macro|me@macro.com' },
          pending: true,
        }}
        inFlight={false}
      />
    ));
    expect(view.queryByTestId('prompt-footer')).toBeNull();
  });
});
