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
      data-testid="macro-tool"
    >
      {props.name}
    </div>
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
}));

type ToolUsePart = Extract<MessagePart, { kind: 'tool_use' }>;

function toolUse(
  detail: ToolUsePart['detail'],
  overrides?: Partial<ToolUsePart>
): ToolUsePart {
  return {
    kind: 'tool_use',
    id: 'call-1',
    label: 'Tool',
    status: 'completed',
    detail,
    rawInput: null,
    rawOutput: null,
    ...overrides,
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
          { label: 'Bash' }
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

describe('ToolCallPart Macro tool routing', () => {
  // A ReadContent call still in flight: name and arguments parse, no
  // response required yet.
  const macroPart = (overrides?: Partial<ToolUsePart>) =>
    toolUse(
      { kind: 'read', paths: [] },
      {
        label: 'ReadContent',
        status: 'running',
        rawInput: { documentId: '4a4886d8-9f4b-4f7e-a5a3-3f5c8b6c0e46' },
        ...overrides,
      }
    );

  it('routes an in-flight call with parseable input to the chat renderer', () => {
    const rendered = render(() => <ToolCallPart part={macroPart()} />);
    expect(rendered.getByTestId('macro-tool').textContent).toBe('ReadContent');
    expect(rendered.getByTestId('macro-tool').dataset.complete).toBe('false');
    expect(rendered.queryByTestId('tool-card')).toBeNull();
  });

  it('routes a completed call whose raw output parses, as the response', () => {
    const rendered = render(() => (
      <ToolCallPart
        part={macroPart({
          status: 'completed',
          rawOutput: { content: { text: 'hi' }, comments: [] },
        })}
      />
    ));
    expect(rendered.getByTestId('macro-tool').dataset.complete).toBe('true');
    expect(rendered.getByTestId('macro-tool').dataset.hasResponse).toBe('true');
  });

  it('strips an mcp__<server>__ prefix when resolving the tool name', () => {
    const rendered = render(() => (
      <ToolCallPart part={macroPart({ label: 'mcp__macro__ReadContent' })} />
    ));
    expect(rendered.getByTestId('macro-tool').textContent).toBe('ReadContent');
  });

  it('keeps a completed call with no parseable response on the generic cards', () => {
    // The chat renderer shows complete-without-response as failed, which
    // would be wrong for a call that succeeded.
    const rendered = render(() => (
      <ToolCallPart part={macroPart({ status: 'completed' })} />
    ));
    expect(rendered.queryByTestId('macro-tool')).toBeNull();
    expect(rendered.getByTestId('tool-card')).not.toBeNull();
  });

  it('routes a failed call — the chat renderer owns the failed treatment', () => {
    const rendered = render(() => (
      <ToolCallPart
        part={macroPart({ status: 'failed', rawOutput: { error: 'nope' } })}
      />
    ));
    expect(rendered.getByTestId('macro-tool').dataset.complete).toBe('true');
  });

  it('keeps an unknown tool name on the generic cards', () => {
    const rendered = render(() => (
      <ToolCallPart
        part={toolUse(
          { kind: 'read', paths: ['a.rs'] },
          { label: 'Read', rawInput: { filePath: 'a.rs' } }
        )}
      />
    ));
    expect(rendered.queryByTestId('macro-tool')).toBeNull();
    expect(rendered.getByTestId('tool-card')).not.toBeNull();
  });

  it('keeps a known name whose input does not parse on the generic cards', () => {
    const rendered = render(() => (
      <ToolCallPart
        part={macroPart({ rawInput: { documentId: 'not-a-uuid' } })}
      />
    ));
    expect(rendered.queryByTestId('macro-tool')).toBeNull();
    expect(rendered.getByTestId('tool-card')).not.toBeNull();
  });

  it('keeps a known name with no raw input on the generic cards', () => {
    const rendered = render(() => (
      <ToolCallPart part={macroPart({ rawInput: null })} />
    ));
    expect(rendered.queryByTestId('macro-tool')).toBeNull();
    expect(rendered.getByTestId('tool-card')).not.toBeNull();
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
