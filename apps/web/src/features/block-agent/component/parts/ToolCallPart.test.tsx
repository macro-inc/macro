/**
 * @vitest-environment jsdom
 */

import type { MessagePart } from '@service-agent-fold/generated/types';
import { render } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { ToolCallContext } from './shared';
import { ToolCallPart } from './ToolCallPart';

// Rich renderers own their result controls; this test verifies dispatch and
// context without mounting their split-layout and query dependencies.
vi.mock('@core/component/AI/component/tool/handler', () => ({
  hasToolRenderer: (name: string) => name !== 'ListSkills',
  RenderTool: (props: {
    name: string;
    json: unknown;
    response?: { json: unknown };
    isComplete: boolean;
    renderContext: {
      renderContext: { grouped?: boolean; isStreaming: boolean };
    };
  }) => (
    <div
      data-testid="macro-tool"
      data-response={JSON.stringify(props.response?.json)}
      data-grouped={String(props.renderContext.renderContext.grouped)}
      data-streaming={String(props.renderContext.renderContext.isStreaming)}
    >
      {props.name}
    </div>
  ),
}));

vi.mock('@app/features/dynamic-ui/DashboardToolView.lazy', () => ({
  DashboardToolView: (props: { view: unknown; pending?: boolean }) => (
    <div data-testid="dashboard-view" data-pending={props.pending}>
      {JSON.stringify(props.view)}
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
vi.mock('../../ui', async () => ({
  ...(await import('../../ui/types')),
  ToolCard: (props: {
    title: JSX.Element;
    subtitle?: string;
    trailing?: JSX.Element;
    status: string;
    muted?: boolean;
    hasContent?: boolean;
    children?: JSX.Element;
  }) => (
    <div
      data-muted={String(props.muted ?? false)}
      data-status={props.status}
      data-expandable={String(props.hasContent ?? 'children' in props)}
      data-testid="tool-card"
    >
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
  Thought: (props: { text: string; active?: boolean }) => (
    <div data-active={String(props.active ?? false)} data-testid="thought">
      {props.text}
    </div>
  ),
}));

type ToolUsePart = Extract<MessagePart, { kind: 'tool_use' }>;

/** Where a part sits in a turn that is (or is not) still running. */
const context = (inFlight: boolean): ToolCallContext => ({
  sessionId: 'session',
  messageId: 'session:0:agent',
  partIndex: 0,
  inFlight,
});

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

  it('shows an MCP tool by its own name, with the server beside it', () => {
    const rendered = render(() => (
      <ToolCallPart
        part={{
          ...toolUse({
            kind: 'other',
            acpKind: 'other',
            output: null,
            input: null,
            result: null,
            error: null,
          }),
          name: { kind: 'mcp', server: 'deepwiki', tool: 'ask' },
        }}
      />
    ));
    expect(rendered.getByTestId('title').textContent).toBe('ask');
    expect(rendered.getByTestId('subtitle').textContent).toBe('deepwiki');
  });

  it('reuses a known renderer for calls from the explicit Macro MCP server', () => {
    const rendered = render(() => (
      <ToolCallPart
        part={{
          ...toolUse({
            kind: 'other',
            acpKind: 'other',
            output: null,
            input: { documentId: '4a4886d8-9f4b-4f7e-a5a3-3f5c8b6c0e46' },
            result: { content: { text: 'Q3 plan' }, comments: [] },
            error: null,
          }),
          name: { kind: 'mcp', server: 'macro', tool: 'ReadContent' },
        }}
      />
    ));
    expect(rendered.getByTestId('macro-tool').textContent).toBe('ReadContent');
    expect(rendered.queryByTestId('tool-card')).toBeNull();
  });

  it('shows a failed MCP call as a summary without a disclosure', () => {
    const rendered = render(() => (
      <ToolCallPart
        part={{
          ...toolUse(
            {
              kind: 'other',
              acpKind: 'other',
              output: null,
              input: {},
              result: null,
              error: 'user declined',
            },
            { status: 'failed' }
          ),
          name: { kind: 'mcp', server: 'ops', tool: 'deploy' },
        }}
      />
    ));
    expect(rendered.getByTestId('tool-card').dataset.muted).toBe('true');
    expect(rendered.getByTestId('subtitle').textContent).toBe('ops');
    expect(rendered.getByTestId('trailing').textContent).toBe('Failed');
    expect(rendered.getByTestId('tool-card').dataset.expandable).toBe('false');
    expect(rendered.getByTestId('body').textContent).toBe('');
  });

  it('does not select a Macro renderer for an external server with the same tool name', () => {
    const rendered = render(() => (
      <ToolCallPart
        part={{
          ...toolUse({
            kind: 'other',
            acpKind: 'other',
            output: null,
            error: null,
            input: { documentId: '4a4886d8-9f4b-4f7e-a5a3-3f5c8b6c0e46' },
            result: { content: { text: 'Q3 plan' }, comments: [] },
          }),
          name: { kind: 'mcp', server: 'external', tool: 'ReadContent' },
        }}
      />
    ));
    expect(rendered.queryByTestId('macro-tool')).toBeNull();
    expect(rendered.getByTestId('subtitle').textContent).toBe('external');
    expect(rendered.getByTestId('tool-card').dataset.expandable).toBe('false');
    expect(rendered.getByTestId('body').textContent).toBe('');
  });

  it('keeps malformed Macro MCP results hidden instead of exposing JSON', () => {
    const rendered = render(() => (
      <ToolCallPart
        part={{
          ...toolUse({
            kind: 'other',
            acpKind: 'other',
            output: null,
            error: null,
            input: { documentId: '4a4886d8-9f4b-4f7e-a5a3-3f5c8b6c0e46' },
            result: { unexpected: 'payload' },
          }),
          name: { kind: 'mcp', server: 'macro', tool: 'ReadContent' },
        }}
      />
    ));
    expect(rendered.queryByTestId('macro-tool')).toBeNull();
    expect(rendered.getByTestId('tool-card').dataset.expandable).toBe('false');
    expect(rendered.getByTestId('body').textContent).toBe('');
  });

  it('updates a generic Macro MCP result without remounting its existing renderer', () => {
    const call = (text: string): ToolUsePart => ({
      ...toolUse({
        kind: 'other',
        acpKind: 'other',
        output: null,
        error: null,
        input: { documentId: '4a4886d8-9f4b-4f7e-a5a3-3f5c8b6c0e46' },
        result: { content: { text }, comments: [] },
      }),
      name: { kind: 'mcp', server: 'macro', tool: 'ReadContent' },
    });
    const [part, setPart] = createSignal(call('First result'));
    const rendered = render(() => <ToolCallPart part={part()} />);
    const result = rendered.getByTestId('macro-tool');
    setPart(call('Updated result'));
    expect(rendered.getByTestId('macro-tool')).toBe(result);
    expect(JSON.parse(result.dataset.response ?? '')).toEqual({
      content: { text: 'Updated result' },
      comments: [],
    });
    expect(rendered.queryByTestId('tool-card')).toBeNull();
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

  it('keeps unmodeled tool output hidden without a registered renderer', () => {
    const rendered = render(() => (
      <ToolCallPart
        part={toolUse({
          kind: 'other',
          acpKind: 'custom_tool',
          output: 'raw result',
          input: null,
          result: null,
          error: null,
        })}
      />
    ));
    expect(rendered.getByTestId('tool-card').dataset.expandable).toBe('false');
    expect(rendered.getByTestId('body').textContent).toBe('');
  });

  it('routes fetch and think to the plain output card', () => {
    const rendered = render(() => (
      <ToolCallPart part={toolUse({ kind: 'fetch', output: 'page body' })} />
    ));
    expect(rendered.getByTestId('output').textContent).toBe('page body');
    expect(rendered.queryByTestId('exchange')).toBeNull();
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

  it('keeps a running Macro tool on the compact active row', () => {
    const rendered = render(() => (
      <ToolCallPart part={readContent()} context={context(true)} />
    ));
    expect(rendered.getByTestId('title').textContent).toBe('ReadContent');
    expect(rendered.getAllByTestId('tool-card')).toHaveLength(1);
    expect(rendered.getByTestId('tool-card').dataset.expandable).toBe('false');
  });

  it('marks a Macro call cut off by the turn as stopped', () => {
    // The turn ended with this call still `running` in the log; it settles
    // and, with no response to show, keeps the labelled card.
    const rendered = render(() => (
      <ToolCallPart part={readContent()} context={context(false)} />
    ));
    expect(rendered.getByTestId('tool-card').dataset.status).toBe('completed');
  });

  it('keeps a stopped call labelled even when it already has renderable output', () => {
    const rendered = render(() => (
      <ToolCallPart
        part={readContent({
          detail: {
            kind: 'macro',
            input: { documentId: '4a4886d8-9f4b-4f7e-a5a3-3f5c8b6c0e46' },
            output: { content: { text: 'partial' }, comments: [] },
            error: null,
          },
        })}
        context={context(false)}
      />
    ));
    expect(rendered.getByTestId('trailing').textContent).toBe('Stopped');
    expect(rendered.queryByTestId('macro-tool')).toBeNull();
  });

  it('reuses the registered result renderer without an outer tool disclosure', () => {
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
    const richTool = rendered.getByTestId('macro-tool');
    expect(JSON.parse(richTool.dataset.response ?? '')).toEqual({
      content: { text: 'hi' },
      comments: [],
    });
    expect(richTool.dataset.grouped).toBe('true');
    expect(richTool.dataset.streaming).toBe('false');
    expect(rendered.queryByTestId('tool-card')).toBeNull();
  });

  it('keeps an unknown Macro tool on a labelled card', () => {
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
    expect(rendered.getByTestId('title').textContent).toBe('BrandNewTool');
    expect(rendered.getByTestId('tool-card').dataset.expandable).toBe('false');
    expect(rendered.getByTestId('body').textContent).toBe('');
  });

  it('preserves a completed call whose output does not fit the tool schema', () => {
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
    expect(rendered.getByTestId('tool-card').dataset.muted).toBe('false');
    expect(rendered.getByTestId('trailing').textContent).toBe('');
    expect(rendered.getByTestId('tool-card').dataset.expandable).toBe('false');
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
    expect(rendered.getByTestId('tool-card')).not.toBeNull();
  });

  it('shows a failed Macro tool as a faded summary', () => {
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
    expect(rendered.getByTestId('tool-card').dataset.muted).toBe('true');
    expect(rendered.getByTestId('trailing').textContent).toBe('Failed');
    expect(rendered.getByTestId('tool-card').dataset.expandable).toBe('false');
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
    expect(rendered.getByTestId('title').textContent).toBe('SendEmail');
    expect(rendered.getByTestId('subtitle').textContent).toBe('Q3 plan');
    expect(rendered.getByTestId('trailing').textContent).toBe('Awaiting you');
    expect(rendered.getByTestId('tool-card').dataset.expandable).toBe('true');
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
    expect(rendered.getByTestId('tool-card').dataset.muted).toBe('true');
    expect(rendered.getByTestId('body').textContent).toBe('no inbox');
    expect(rendered.getByTestId('trailing').textContent).toBe('Failed');
  });

  it('keeps a draft the schema rejects summary-only, with its outcome still labelled', () => {
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
    expect(rendered.getByTestId('trailing').textContent).toBe('Answered');
    expect(rendered.getByTestId('tool-card').dataset.expandable).toBe('false');
    expect(rendered.getByTestId('body').textContent).toBe('');
  });

  it('does not add a disclosure for a failed user tool with no recognized draft', () => {
    const rendered = render(() => (
      <ToolCallPart
        part={toolUse(
          {
            kind: 'user_tool',
            input: { privatePayload: 'not a draft' },
            outcome: { kind: 'failed', message: 'Failed to prepare draft' },
          },
          { name: 'SendEmail' }
        )}
      />
    ));
    expect(rendered.getByTestId('trailing').textContent).toBe('Failed');
    expect(rendered.getByTestId('tool-card').dataset.expandable).toBe('false');
    expect(rendered.getByTestId('body').textContent).toBe('');
  });
});

describe('ToolCallPart inline results', () => {
  it.each(['native', 'mcp'] as const)(
    'does not route an unrelated %s tool named DisplayResults to the dashboard',
    (kind) => {
      const part = toolUse({
        kind: 'other',
        input: { view: { widgets: [] } },
        result: null,
        output: null,
        error: null,
        acpKind: 'other',
      });
      part.name =
        kind === 'mcp'
          ? { kind, server: 'external', tool: 'DisplayResults' }
          : { kind, name: 'DisplayResults' };
      const rendered = render(() => <ToolCallPart part={part} />);
      expect(rendered.queryByTestId('dashboard-view')).toBeNull();
      expect(rendered.getByTestId('tool-card').dataset.expandable).toBe(
        'false'
      );
    }
  );

  it.each(['macro', 'other'] as const)(
    'renders %s DisplayResults from call arguments before any response',
    (kind) => {
      const input = { view: { kind: 'text', text: 'Launch checklist' } };
      const part = toolUse(
        kind === 'macro'
          ? { kind, input, output: null, error: null }
          : {
              kind,
              input,
              result: null,
              output: null,
              error: null,
              acpKind: 'other',
            },
        { name: 'DisplayResults', status: 'running' }
      );
      if (kind === 'other')
        part.name = { kind: 'mcp', server: 'macro', tool: 'DisplayResults' };
      const rendered = render(() => (
        <ToolCallPart part={part} context={context(true)} />
      ));
      expect(rendered.getByTestId('dashboard-view').textContent).toBe(
        JSON.stringify(input.view)
      );
      expect(rendered.queryByTestId('tool-card')).toBeNull();
      expect(rendered.queryByTestId('macro-tool')).toBeNull();
    }
  );

  it('updates inline results as the call arguments change', () => {
    const [part, setPart] = createSignal(
      toolUse(
        {
          kind: 'macro',
          input: { view: { text: 'First' } },
          output: null,
          error: null,
        },
        { name: 'DisplayResults', status: 'running' }
      )
    );
    const rendered = render(() => (
      <ToolCallPart part={part()} context={context(true)} />
    ));
    const dashboard = rendered.getByTestId('dashboard-view');
    setPart(
      toolUse(
        {
          kind: 'macro',
          input: { view: { text: 'Updated' } },
          output: null,
          error: null,
        },
        { name: 'DisplayResults', status: 'running' }
      )
    );
    expect(rendered.getByTestId('dashboard-view')).toBe(dashboard);
    expect(dashboard.textContent).toBe('{"text":"Updated"}');
  });

  it('passes settled missing input to dashboard validation without a tool disclosure', () => {
    const rendered = render(() => (
      <ToolCallPart
        part={toolUse(
          { kind: 'macro', input: null, output: null, error: null },
          { name: 'DisplayResults' }
        )}
      />
    ));
    expect(rendered.getByTestId('dashboard-view').dataset.pending).toBe(
      'false'
    );
    expect(rendered.queryByTestId('tool-card')).toBeNull();
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
      '1 tool · 3.5s'
    );
  });

  it('preserves a nested tool body while the subagent streams updated children', () => {
    const [part, setPart] = createSignal(subagent({ result: null }));
    const rendered = render(() => <ToolCallPart part={part()} />);
    const terminal = rendered.getByTestId('terminal');
    setPart(
      subagent({
        children: [
          toolUse(
            {
              kind: 'terminal',
              command: 'python3 -c "print(5+5)"',
              output: '10\nFinished',
              exitCode: 0,
            },
            { id: 'child', name: 'Bash' }
          ),
        ],
      })
    );
    expect(rendered.getByTestId('terminal')).toBe(terminal);
    expect(terminal.textContent).toBe('10\nFinished');
    expect(rendered.getAllByTestId('trailing')[0]?.textContent).toBe(
      '1 tool · 3.5s'
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

  it('shimmers only a trailing child thought while the subagent is live', () => {
    const rendered = render(() => (
      <ToolCallPart
        part={toolUse(
          {
            kind: 'subagent',
            title: 'Add 5+5 with Python',
            agentType: 'general-purpose',
            description: 'Add 5+5 with Python',
            prompt: 'Run python and report the output.',
            background: false,
            children: [
              { kind: 'thought', text: 'already decided' },
              toolUse(
                {
                  kind: 'terminal',
                  command: 'python3 -c "print(5+5)"',
                  output: '10',
                  exitCode: 0,
                },
                { id: 'child', name: 'Bash' }
              ),
              { kind: 'thought', text: 'still weighing this' },
            ],
            result: null,
          },
          { name: 'Agent', status: 'running' }
        )}
        context={{
          sessionId: 'session',
          messageId: 'session:0:agent',
          partIndex: 0,
          inFlight: true,
        }}
      />
    ));
    const rows = rendered.getAllByTestId('thought');
    expect(rows.map((el) => el.textContent)).toEqual([
      'already decided',
      'still weighing this',
    ]);
    expect(rows.map((el) => el.dataset.active)).toEqual(['false', 'true']);
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

describe('ToolCallPart settling', () => {
  const running = () =>
    toolUse(
      { kind: 'terminal', command: 'cargo test', output: null, exitCode: null },
      { name: 'Bash', status: 'running' }
    );

  it('keeps a running call active while its turn is live', () => {
    const rendered = render(() => (
      <ToolCallPart part={running()} context={context(true)} />
    ));
    expect(rendered.getByTestId('tool-card').dataset.status).toBe('running');
  });

  it('settles a running call once its turn is over, without calling it failed', () => {
    const rendered = render(() => (
      <ToolCallPart part={running()} context={context(false)} />
    ));
    expect(rendered.getByTestId('tool-card').dataset.status).toBe('completed');
    expect(rendered.getByTestId('tool-card').dataset.muted).toBe('false');
    expect(rendered.getByTestId('trailing').textContent).toBe('Stopped');
  });

  it('settles a call with no turn to place it in', () => {
    const rendered = render(() => <ToolCallPart part={running()} />);
    expect(rendered.getByTestId('tool-card').dataset.status).toBe('completed');
  });

  it('settles a subagent and its nested children with the turn', () => {
    const rendered = render(() => (
      <ToolCallPart
        part={toolUse(
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
                  output: null,
                  exitCode: null,
                },
                { id: 'child', name: 'Bash', status: 'running' }
              ),
              { kind: 'thought', text: 'still weighing this' },
            ],
            result: null,
          },
          { name: 'Agent', status: 'running' }
        )}
        context={context(false)}
      />
    ));
    expect(
      rendered.getAllByTestId('tool-card').map((el) => el.dataset.status)
    ).toEqual(['completed', 'completed']);
    expect(rendered.getByTestId('thought').dataset.active).toBe('false');
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

describe('ToolCallPart result summaries', () => {
  it.each([
    {
      name: 'MoveToProject',
      input: {},
      output: { success: false, message: 'Denied' },
    },
    {
      name: 'WebFetch',
      input: { input: 'https://status.macro.com' },
      output: {
        tool_use_id: 'call-1',
        content: {
          type: 'web_fetch_tool_result_error',
          error_code: 'url_not_accessible',
        },
      },
    },
    {
      name: 'WebSearch',
      input: { input: 'launch checklist' },
      output: {
        tool_use_id: 'call-1',
        content: {
          type: 'web_search_tool_result_error',
          error_code: 'unavailable',
        },
      },
    },
  ])(
    'shows a validated $name response failure even if the call completed',
    ({ name, input, output }) => {
      const rendered = render(() => (
        <ToolCallPart
          part={toolUse(
            { kind: 'macro', input, output, error: null },
            { name }
          )}
        />
      ));
      expect(rendered.getByTestId('trailing').textContent).toBe('Failed');
      expect(rendered.getByTestId('tool-card').dataset.muted).toBe('true');
      expect(rendered.queryByTestId('macro-tool')).toBeNull();
    }
  );

  it('updates a mounted terminal body when a streamed response replaces the part', () => {
    const [part, setPart] = createSignal(
      toolUse(
        {
          kind: 'terminal',
          command: 'bun run check',
          output: 'Checking…',
          exitCode: null,
        },
        { status: 'running' }
      )
    );
    const rendered = render(() => (
      <ToolCallPart part={part()} context={context(true)} />
    ));
    const body = rendered.getByTestId('terminal');
    setPart(
      toolUse({
        kind: 'terminal',
        command: 'bun run check',
        output: 'All checks passed',
        exitCode: 0,
      })
    );
    expect(rendered.getByTestId('terminal')).toBe(body);
    expect(body.textContent).toBe('All checks passed');
    expect(rendered.getByTestId('tool-card').dataset.status).toBe('completed');
  });

  it('shows a reported terminal exit failure even if the harness completed the call', () => {
    const rendered = render(() => (
      <ToolCallPart
        part={toolUse({
          kind: 'terminal',
          command: 'false',
          output: '',
          exitCode: 1,
        })}
      />
    ));
    expect(rendered.getByTestId('trailing').textContent).toBe(
      'Failed · exit 1'
    );
    expect(rendered.getByTestId('tool-card').dataset.muted).toBe('true');
    expect(rendered.getByTestId('terminal')).toBeTruthy();
  });

  it('counts completed file reads and keeps a single path available in the body', () => {
    const rendered = render(() => (
      <ToolCallPart
        part={toolUse({ kind: 'read', paths: ['docs/launch.md'] })}
      />
    ));
    expect(rendered.getByTestId('trailing').textContent).toBe('1 file');
    expect(rendered.getByTestId('path-list').textContent).toBe(
      'docs/launch.md'
    );
  });

  it('does not present pending edit diffs as completed changes', () => {
    const rendered = render(() => (
      <ToolCallPart
        part={toolUse(
          {
            kind: 'edit',
            diffs: [{ path: 'a.ts', oldText: 'a', newText: 'b' }],
          },
          { status: 'running' }
        )}
        context={context(true)}
      />
    ));
    expect(rendered.queryByTestId('diff-changes')).toBeNull();
  });

  it.each([0, 1, 3])(
    'counts %i validated results when the tool has no registered renderer',
    (count) => {
      const rendered = render(() => (
        <ToolCallPart
          part={toolUse(
            {
              kind: 'macro',
              input: {},
              output: {
                results: Array.from({ length: count }, () => ({
                  documentId: '4a4886d8-9f4b-4f7e-a5a3-3f5c8b6c0e46',
                  name: 'Launch checklist',
                })),
              },
              error: null,
            },
            { name: 'ListSkills' }
          )}
        />
      ));
      expect(rendered.queryByTestId('macro-tool')).toBeNull();
      expect(rendered.getByTestId('trailing').textContent).toBe(
        `${count} ${count === 1 ? 'result' : 'results'}`
      );
    }
  );

  it('does not infer a result count from an invalid Macro response', () => {
    const rendered = render(() => (
      <ToolCallPart
        part={toolUse(
          {
            kind: 'macro',
            input: { name: 'launch checklist' },
            output: { results: ['a', 'b', 'c'] },
            error: null,
          },
          { name: 'SearchSkills' }
        )}
      />
    ));
    expect(rendered.getByTestId('trailing').textContent).toBe('');
  });
});
