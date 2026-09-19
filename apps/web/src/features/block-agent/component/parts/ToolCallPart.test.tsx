/**
 * @vitest-environment jsdom
 */

import type { MessagePart } from '@service-agent-fold/generated/types';
import { render } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { ToolCallPart } from './ToolCallPart';

// The chat block's tool renderer is mocked to a marker: it transitively pulls
// in every per-tool component (split layout, queries, icon sprites). The layer
// under test is the dispatcher's routing — chat component vs. generic card —
// not the chat components themselves, which have their own tests.
vi.mock('@core/component/AI/component/tool/handler', () => ({
  RenderTool: (props: {
    name: string;
    json: unknown;
    isComplete: boolean;
    response?: { json: unknown; name: string };
  }) => (
    <div
      data-complete={String(props.isComplete)}
      data-has-response={String(props.response !== undefined)}
      data-response={
        props.response === undefined
          ? undefined
          : JSON.stringify(props.response.json)
      }
      data-testid="macro-tool"
    >
      {props.name}
    </div>
  ),
}));

// The entity link a finished email's outcome carries needs the query client
// and the split layout; a marker carrying the id is enough here.
vi.mock('@core/component/ItemPreview', () => ({
  ItemPreview: (props: { id: string; type: string }) => (
    <span
      data-id={props.id}
      data-testid="item-preview"
      data-type={props.type}
    />
  ),
}));

// Markdown rendering pulls in the Lexical editor; the nested transcript's
// prose is a marker here.
vi.mock('./TextPart', () => ({
  TextPart: (props: { text: string }) => (
    <p data-testid="text-part">{props.text}</p>
  ),
}));

// The ui primitives are mocked (the AssistantMessageParts.test.tsx idiom):
// ToolCard pulls in kobalte + svg sprites and PierreDiff pulls in the diff
// engine — the layer under test here is the per-kind card components and the
// dispatcher's routing/common-derivation, which render for real.
vi.mock('../../ui', () => ({
  ToolCard: (props: {
    title: JSX.Element;
    subtitle?: string;
    trailing?: JSX.Element;
    muted?: boolean;
    children?: JSX.Element;
  }) => (
    <div data-muted={String(props.muted ?? false)} data-testid="tool-card">
      <span data-testid="title">{props.title}</span>
      <span data-testid="subtitle">{props.subtitle}</span>
      <span data-testid="trailing">{props.trailing}</span>
      <div data-testid="body">{props.children}</div>
    </div>
  ),
  DiffChanges: (props: { additions: number; deletions: number }) => (
    <span data-testid="diff-changes">
      +{props.additions} −{props.deletions}
    </span>
  ),
  PierreDiff: (props: { diffs: { path: string }[] }) => (
    <div data-testid="pierre-diff">
      {props.diffs.map((diff) => diff.path).join(',')}
    </div>
  ),
  FoldedTerminal: (props: { output: string }) => (
    <pre data-testid="terminal">{props.output}</pre>
  ),
  FoldedOutput: (props: { text: string }) => (
    <pre data-testid="output">{props.text}</pre>
  ),
  FoldedPathList: (props: { paths: string[] }) => (
    <div data-testid="path-list">{props.paths.join(',')}</div>
  ),
  Thought: (props: { text: string }) => (
    <div data-testid="thought">{props.text}</div>
  ),
}));

type ToolUsePart = Extract<MessagePart, { kind: 'tool_use' }>;

function toolUse(
  detail: ToolUsePart['detail'],
  overrides?: Partial<Omit<ToolUsePart, 'name'>> & { name?: string }
): ToolUsePart {
  const { name, ...rest } = overrides ?? {};
  return {
    kind: 'tool_use',
    id: 'call-1',
    name: { kind: 'native', name: name ?? 'Tool' },
    status: 'completed',
    detail,
    ...rest,
  };
}

describe('ToolCallPart routing', () => {
  it('renders a terminal call with the command as subtitle and output body', () => {
    const rendered = render(() => (
      <ToolCallPart
        part={toolUse(
          {
            kind: 'terminal',
            command: 'cargo test -p agent_fold',
            output: 'running 14 tests',
            exitCode: 0,
          },
          { name: 'Bash' }
        )}
      />
    ));
    expect(rendered.getByTestId('title').textContent).toBe('Bash');
    expect(rendered.getByTestId('subtitle').textContent).toBe(
      'cargo test -p agent_fold'
    );
    expect(rendered.getByTestId('body').textContent).toContain(
      'running 14 tests'
    );
  });

  it('shows an MCP tool by its own name, without the server namespace', () => {
    const rendered = render(() => (
      <ToolCallPart
        part={{
          ...toolUse({
            kind: 'other',
            acpKind: 'other',
            output: null,
            input: null,
          }),
          name: { kind: 'mcp', server: 'deepwiki', tool: 'ask' },
        }}
      />
    ));
    expect(rendered.getByTestId('title').textContent).toBe('ask');
  });

  it('renders an edit with computed +/− counts and the diff body', () => {
    const rendered = render(() => (
      <ToolCallPart
        part={toolUse({
          kind: 'edit',
          diffs: [
            {
              path: 'src/a.rs',
              oldText: 'old\nsame\n',
              newText: 'new\nsame\n',
            },
          ],
        })}
      />
    ));
    expect(rendered.getByTestId('subtitle').textContent).toBe('src/a.rs');
    expect(rendered.getByTestId('diff-changes').textContent).toBe('+1 −1');
    expect(rendered.getByTestId('pierre-diff').textContent).toBe('src/a.rs');
  });

  it('summarizes multi-path reads and lists the paths in the body', () => {
    const rendered = render(() => (
      <ToolCallPart part={toolUse({ kind: 'read', paths: ['a.rs', 'b.rs'] })} />
    ));
    expect(rendered.getByTestId('subtitle').textContent).toBe('2 files');
    expect(rendered.getByTestId('path-list').textContent).toBe('a.rs,b.rs');
  });

  it('routes unmodeled kinds to the output fallback', () => {
    const rendered = render(() => (
      <ToolCallPart
        part={toolUse({
          kind: 'other',
          acpKind: 'custom_tool',
          output: 'raw result',
          input: null,
        })}
      />
    ));
    expect(rendered.getByTestId('body').textContent).toContain('raw result');
  });
});

describe('ToolCallPart Macro tools', () => {
  // A ReadContent call the fold already named and unwrapped.
  const readContent = (overrides?: Partial<Omit<ToolUsePart, 'name'>>) =>
    toolUse(
      {
        kind: 'macro',
        input: { documentId: '4a4886d8-9f4b-4f7e-a5a3-3f5c8b6c0e46' },
        output: null,
        error: null,
      },
      { name: 'ReadContent', status: 'running', ...overrides }
    );

  it('renders a known Macro tool with the chat component', () => {
    const rendered = render(() => <ToolCallPart part={readContent()} />);
    expect(rendered.getByTestId('macro-tool').textContent).toBe('ReadContent');
    expect(rendered.getByTestId('macro-tool').dataset.complete).toBe('false');
    expect(rendered.queryByTestId('tool-card')).toBeNull();
  });

  it('passes the unwrapped output as the chat response once complete', () => {
    const rendered = render(() => (
      <ToolCallPart
        part={readContent({
          status: 'completed',
          detail: {
            kind: 'macro',
            input: { documentId: '4a4886d8-9f4b-4f7e-a5a3-3f5c8b6c0e46' },
            output: { content: { text: 'hi' }, comments: [] },
            error: null,
          },
        })}
      />
    ));
    expect(rendered.getByTestId('macro-tool').dataset.complete).toBe('true');
    expect(rendered.getByTestId('macro-tool').dataset.hasResponse).toBe('true');
  });

  it('keeps a Macro tool the chat has no component for on a labelled card', () => {
    const rendered = render(() => (
      <ToolCallPart
        part={toolUse(
          {
            kind: 'macro',
            input: { anything: 1 },
            output: { result: 'ok' },
            error: null,
          },
          { name: 'BrandNewTool' }
        )}
      />
    ));
    expect(rendered.queryByTestId('macro-tool')).toBeNull();
    expect(rendered.getByTestId('title').textContent).toBe('BrandNewTool');
    expect(rendered.getByTestId('body').textContent).toContain(
      '"result": "ok"'
    );
  });

  it('keeps a completed call whose output the chat cannot read on the card', () => {
    // The chat renderer would show this as failed; the call succeeded.
    const rendered = render(() => (
      <ToolCallPart
        part={readContent({
          status: 'completed',
          detail: {
            kind: 'macro',
            input: { documentId: '4a4886d8-9f4b-4f7e-a5a3-3f5c8b6c0e46' },
            output: { unexpected: true },
            error: null,
          },
        })}
      />
    ));
    expect(rendered.queryByTestId('macro-tool')).toBeNull();
    expect(rendered.getByTestId('tool-card').dataset.muted).toBe('false');
    expect(rendered.getByTestId('trailing').textContent).toBe('');
  });

  it('keeps a known tool whose arguments do not fit its schema on the card', () => {
    const rendered = render(() => (
      <ToolCallPart
        part={readContent({
          detail: {
            kind: 'macro',
            input: { documentId: 'not-a-uuid' },
            output: null,
            error: null,
          },
        })}
      />
    ));
    expect(rendered.queryByTestId('macro-tool')).toBeNull();
    expect(rendered.getByTestId('tool-card')).not.toBeNull();
  });

  it('shows a failed Macro tool with its error, faded', () => {
    const rendered = render(() => (
      <ToolCallPart
        part={toolUse(
          {
            kind: 'macro',
            input: { limit: 5 },
            output: null,
            error: 'permission denied',
          },
          { name: 'ListEntities', status: 'failed' }
        )}
      />
    ));
    expect(rendered.queryByTestId('macro-tool')).toBeNull();
    expect(rendered.getByTestId('tool-card').dataset.muted).toBe('true');
    expect(rendered.getByTestId('subtitle').textContent).toBe(
      'permission denied'
    );
    expect(rendered.getByTestId('trailing').textContent).toBe('Failed');
  });
});

describe('ToolCallPart user tools', () => {
  const email = (
    outcome: Extract<ToolUsePart['detail'], { kind: 'user_tool' }>['outcome']
  ) =>
    toolUse(
      {
        kind: 'user_tool',
        input: {
          subject: 'Q3 plan',
          body: 'Hi Alice',
          to: [{ email: 'alice@example.com', name: 'Alice' }],
        },
        outcome,
      },
      { name: 'SendEmail' }
    );

  it('renders a pending email draft read-only on its own card, never through the chat', () => {
    const rendered = render(() => (
      <ToolCallPart part={email({ kind: 'pending' })} />
    ));
    expect(rendered.queryByTestId('macro-tool')).toBeNull();
    expect(rendered.getByTestId('title').textContent).toBe('SendEmail');
    expect(rendered.getByTestId('subtitle').textContent).toBe('Q3 plan');
    expect(rendered.getByTestId('trailing').textContent).toBe('Awaiting you');
    const body = rendered.getByTestId('body');
    expect(body.textContent).toContain('Alice <alice@example.com>');
    expect(body.textContent).toContain('Q3 plan');
    expect(rendered.getByTestId('text-part').textContent).toBe('Hi Alice');
  });

  it('labels every outcome, and links the thread an email went to', () => {
    const cases: [
      Extract<ToolUsePart['detail'], { kind: 'user_tool' }>['outcome'],
      string,
      string | undefined,
    ][] = [
      [{ kind: 'edited' }, 'Edited', undefined],
      [
        {
          kind: 'sent',
          messageId: '9c4d2c6e-2f3a-4d1e-8b0a-5e6f7a8b9c0d',
          threadId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
        },
        'Sent',
        '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
      ],
      [
        {
          kind: 'draft',
          draftId: '7e8f9a0b-1c2d-4e3f-8a9b-0c1d2e3f4a5b',
          threadId: null,
        },
        'Saved as draft',
        undefined,
      ],
      [
        {
          kind: 'draft',
          draftId: '7e8f9a0b-1c2d-4e3f-8a9b-0c1d2e3f4a5b',
          threadId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
        },
        'Saved as draft',
        '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
      ],
      [{ kind: 'rejected' }, 'Rejected', undefined],
      [{ kind: 'completed', result: { id: 'evt' } }, 'Done', undefined],
    ];
    for (const [outcome, label, thread] of cases) {
      const rendered = render(() => <ToolCallPart part={email(outcome)} />);
      const trailing = rendered.getByTestId('trailing');
      expect(trailing.textContent).toContain(label);
      const link = rendered.queryByTestId('item-preview');
      expect(link?.dataset.id).toBe(thread);
      rendered.unmount();
    }
  });

  it('shows an edited body, which arrives as base64url HTML, as its text', () => {
    const html = btoa('<body><p>Hi <b>Alice</b>,</p><p>see plan</p></body>')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    const rendered = render(() => (
      <ToolCallPart
        part={toolUse(
          {
            kind: 'user_tool',
            input: {
              subject: 'Q3 plan',
              body: html,
              to: [{ email: 'alice@example.com' }],
            },
            outcome: { kind: 'edited' },
          },
          { name: 'SendEmail' }
        )}
      />
    ));
    expect(rendered.queryByTestId('text-part')).toBeNull();
    expect(rendered.getByTestId('output').textContent).toBe(
      'Hi Alice,see plan'
    );
  });

  it('renders a calendar event draft with when, where and attendees', () => {
    const rendered = render(() => (
      <ToolCallPart
        part={toolUse(
          {
            kind: 'user_tool',
            input: {
              title: 'Q3 sync',
              time: {
                kind: 'timed',
                startsAt: '2026-08-20T17:00:00Z',
                endsAt: '2026-08-20T17:30:00Z',
                timeZone: 'UTC',
              },
              location: 'Room 4',
              attendees: [
                { email: 'alice@example.com' },
                { email: 'bob@example.com', isOptional: true },
              ],
              description: 'Agenda in the doc.',
            },
            outcome: { kind: 'pending' },
          },
          { name: 'CreateCalendarEvent' }
        )}
      />
    ));
    expect(rendered.getByTestId('title').textContent).toBe(
      'CreateCalendarEvent'
    );
    expect(rendered.getByTestId('subtitle').textContent).toBe('Q3 sync');
    const body = rendered.getByTestId('body').textContent ?? '';
    expect(body).toContain('Aug 20, 2026');
    expect(body).toContain('Room 4');
    expect(body).toContain('alice@example.com, bob@example.com (optional)');
    expect(rendered.getByTestId('text-part').textContent).toBe(
      'Agenda in the doc.'
    );
  });

  it('keeps a failed user tool on a faded card with the error as body', () => {
    const rendered = render(() => (
      <ToolCallPart part={email({ kind: 'failed', message: 'no inbox' })} />
    ));
    expect(rendered.queryByTestId('macro-tool')).toBeNull();
    expect(rendered.getByTestId('tool-card').dataset.muted).toBe('true');
    expect(rendered.getByTestId('body').textContent).toBe('no inbox');
    expect(rendered.getByTestId('trailing').textContent).toBe('Failed');
  });

  it('shows a draft the schema rejects as JSON, with the outcome still labelled', () => {
    const rendered = render(() => (
      <ToolCallPart
        part={toolUse(
          {
            kind: 'user_tool',
            input: { subject: 'no recipients or body' },
            outcome: { kind: 'unrecognized' },
          },
          { name: 'SendEmail' }
        )}
      />
    ));
    expect(rendered.queryByTestId('macro-tool')).toBeNull();
    expect(rendered.getByTestId('trailing').textContent).toBe('Answered');
    expect(rendered.getByTestId('body').textContent).toContain(
      '"subject": "no recipients or body"'
    );
  });
});

describe('ToolCallPart subagents', () => {
  const subagent = (
    overrides?: Partial<Extract<ToolUsePart['detail'], { kind: 'subagent' }>>
  ) =>
    toolUse(
      {
        kind: 'subagent',
        title: 'Add 5+5 with Python',
        agentType: 'general-purpose',
        description: 'Add 5+5 with Python',
        prompt: 'Run python and report the output.',
        background: false,
        children: [
          toolUse(
            {
              kind: 'terminal',
              command: 'python3 -c "print(5+5)"',
              output: '10',
              exitCode: 0,
            },
            { id: 'child', name: 'Bash' }
          ),
        ],
        result: {
          text: 'Output: `10`',
          error: null,
          agentId: 'a1',
          model: 'claude-opus-5[1m]',
          durationMs: 3485,
          tokens: 26077,
          toolUses: 1,
          stats: null,
        },
        ...overrides,
      },
      { name: 'Agent' }
    );

  it('titles the card with the description and nests the children', () => {
    const rendered = render(() => <ToolCallPart part={subagent()} />);
    const titles = rendered.getAllByTestId('title').map((el) => el.textContent);
    expect(titles).toEqual(['Add 5+5 with Python', 'Bash']);
    expect(rendered.getAllByTestId('subtitle')[0]?.textContent).toBe(
      'general-purpose'
    );
    expect(rendered.getByTestId('terminal').textContent).toBe('10');
    expect(rendered.getByTestId('text-part').textContent).toBe('Output: `10`');
  });

  it('summarizes the result in the trailing slot', () => {
    const rendered = render(() => <ToolCallPart part={subagent()} />);
    expect(rendered.getAllByTestId('trailing')[0]?.textContent).toBe(
      '1 tool · 3.5s · 26k tokens'
    );
  });

  it('shows the title the fold chose, whatever the harness gave', () => {
    // The fold has already decided the title - description, else the brief's
    // first line, else the tool name - so the card shows it as is.
    const rendered = render(() => (
      <ToolCallPart
        part={subagent({
          title: 'Run python and report the output.',
          description: null,
          agentType: null,
          children: [],
          result: null,
        })}
      />
    ));
    expect(rendered.getByTestId('title').textContent).toBe(
      'Run python and report the output.'
    );
    expect(rendered.getByTestId('body').textContent).toContain(
      'Run python and report the output.'
    );
  });

  it('shows a failed subagent faded with its error', () => {
    const rendered = render(() => (
      <ToolCallPart
        part={subagent({
          children: [],
          result: {
            text: null,
            error: 'Subagent failed: boom',
            agentId: null,
            model: null,
            durationMs: null,
            tokens: null,
            toolUses: null,
            stats: null,
          },
        })}
      />
    ));
    expect(rendered.getByTestId('tool-card').dataset.muted).toBe('true');
    expect(rendered.getByTestId('trailing').textContent).toBe('Failed');
    expect(rendered.getByTestId('output').textContent).toBe(
      'Subagent failed: boom'
    );
  });
});

describe('ToolCallPart failed treatment', () => {
  it('fades the row and shows a quiet Failed trailing label', () => {
    const rendered = render(() => (
      <ToolCallPart
        part={toolUse(
          { kind: 'terminal', command: 'x', output: null, exitCode: 1 },
          { status: 'failed' }
        )}
      />
    ));
    expect(rendered.getByTestId('tool-card').dataset.muted).toBe('true');
    expect(rendered.getByTestId('trailing').textContent).toBe('Failed');
  });

  it('a failed edit shows Failed instead of the +/− badge', () => {
    const rendered = render(() => (
      <ToolCallPart
        part={toolUse(
          {
            kind: 'edit',
            diffs: [{ path: 'src/a.rs', oldText: 'a', newText: 'b' }],
          },
          { status: 'failed' }
        )}
      />
    ));
    expect(rendered.getByTestId('trailing').textContent).toBe('Failed');
    expect(rendered.queryByTestId('diff-changes')).toBeNull();
  });
});
