import type {
  MessagePart,
  ToolDetail,
  ToolName,
} from '@service-agent-fold/generated/types';
import { describe, expect, it } from 'vitest';
import { rendersOwnView, segmentParts } from './tool-groups';

const text = (): MessagePart => ({ kind: 'text', text: 'hi' });
const tool = (
  overrides?: Partial<Extract<MessagePart, { kind: 'tool_use' }>>
): MessagePart => ({
  kind: 'tool_use',
  id: 'call',
  name: { kind: 'native', name: 'Read' },
  status: 'completed',
  detail: { kind: 'read', paths: ['a.rs'] },
  ...overrides,
});
const thought = (): MessagePart => ({ kind: 'thought', text: 'thinking...' });
/**
 * `displayResults`: the model composes a dynamic-UI view and the call renders
 * it. The answer itself, not a card about one.
 */
const displayResults = (): Extract<MessagePart, { kind: 'tool_use' }> => ({
  kind: 'tool_use',
  id: 'view',
  name: { kind: 'native', name: 'DisplayResults' },
  status: 'completed',
  detail: {
    kind: 'macro',
    input: { view: { widgets: [] } },
    output: { message: 'done' },
    error: null,
  },
});
const permission = (): MessagePart => ({
  kind: 'permission',
  requestId: 'permission-test',
  toolCall: 'call',
  options: [],
  outcome: { kind: 'pending' },
});

describe('segmentParts', () => {
  it('leaves a message without tool calls as one segment per part', () => {
    expect(segmentParts([text(), text()])).toEqual([
      { kind: 'part', start: 0, end: 1 },
      { kind: 'part', start: 1, end: 2 },
    ]);
  });

  it('keeps a lone tool call as its own part', () => {
    expect(segmentParts([text(), tool(), text()])).toEqual([
      { kind: 'part', start: 0, end: 1 },
      { kind: 'part', start: 1, end: 2 },
      { kind: 'part', start: 2, end: 3 },
    ]);
  });

  it('folds a run of consecutive tool calls into one group', () => {
    expect(segmentParts([text(), tool(), tool(), tool(), text()])).toEqual([
      { kind: 'part', start: 0, end: 1 },
      { kind: 'tools', start: 1, end: 4 },
      { kind: 'part', start: 4, end: 5 },
    ]);
  });

  it('breaks a run at anything that is not a tool call', () => {
    // The permission prompt is waiting on the reader; it must stay visible.
    expect(
      segmentParts([tool(), tool(), permission(), tool(), tool()])
    ).toEqual([
      { kind: 'tools', start: 0, end: 2 },
      { kind: 'part', start: 2, end: 3 },
      { kind: 'tools', start: 3, end: 5 },
    ]);
  });

  describe.each([
    {
      label: 'native',
      name: { kind: 'native', name: 'DisplayResults' } satisfies ToolName,
    },
    {
      label: 'MCP',
      name: {
        kind: 'mcp',
        server: 'macro',
        tool: 'DisplayResults',
      } satisfies ToolName,
    },
  ])('DisplayResults called through $label', ({ name }) => {
    it.each(['pending', 'running', 'completed'] as const)(
      'breaks tool groups before and after a %s call',
      (status) => {
        const details: ToolDetail[] = [
          { kind: 'macro', input: null, output: null, error: null },
          {
            kind: 'other',
            acpKind: 'other',
            input: null,
            output: null,
            result: null,
            error: null,
          },
        ];
        for (const detail of details) {
          if (name.kind === 'native' && detail.kind === 'other') continue;
          const display = tool({ name, status, detail });
          expect(
            segmentParts([tool(), tool(), display, tool(), tool()])
          ).toEqual([
            { kind: 'tools', start: 0, end: 2 },
            { kind: 'part', start: 2, end: 3 },
            { kind: 'tools', start: 3, end: 5 },
          ]);
        }
      }
    );
  });

  it('keeps adjacent thoughts in their own runs around inline results', () => {
    expect(
      segmentParts([tool(), thought(), displayResults(), thought(), tool()])
    ).toEqual([
      { kind: 'tools', start: 0, end: 2 },
      { kind: 'part', start: 2, end: 3 },
      { kind: 'tools', start: 3, end: 5 },
    ]);
  });

  it('groups a run that closes the message', () => {
    expect(segmentParts([text(), tool(), tool()])).toEqual([
      { kind: 'part', start: 0, end: 1 },
      { kind: 'tools', start: 1, end: 3 },
    ]);
  });

  it('is empty for no parts', () => {
    expect(segmentParts([])).toEqual([]);
  });

  it('groups thinking blocks with tool calls', () => {
    expect(segmentParts([text(), thought(), tool(), tool(), text()])).toEqual([
      { kind: 'part', start: 0, end: 1 },
      { kind: 'tools', start: 1, end: 4 },
      { kind: 'part', start: 4, end: 5 },
    ]);
  });

  it('groups consecutive thinking blocks with tool calls', () => {
    expect(
      segmentParts([thought(), tool(), thought(), tool(), thought()])
    ).toEqual([
      { kind: 'tools', start: 0, end: 4 },
      { kind: 'part', start: 4, end: 5 },
    ]);
  });

  it('leaves a trailing thought out of a run that closes the message', () => {
    expect(segmentParts([thought(), tool(), thought()])).toEqual([
      { kind: 'tools', start: 0, end: 2 },
      { kind: 'part', start: 2, end: 3 },
    ]);
  });

  it('keeps a trailing thought in a run that prose follows', () => {
    expect(segmentParts([tool(), tool(), thought(), text()])).toEqual([
      { kind: 'tools', start: 0, end: 3 },
      { kind: 'part', start: 3, end: 4 },
    ]);
  });

  it('leaves a thought after a single tool as its own part', () => {
    expect(segmentParts([tool(), thought()])).toEqual([
      { kind: 'part', start: 0, end: 1 },
      { kind: 'part', start: 1, end: 2 },
    ]);
  });

  it('keeps a lone thinking block as its own part', () => {
    expect(segmentParts([text(), thought(), text()])).toEqual([
      { kind: 'part', start: 0, end: 1 },
      { kind: 'part', start: 1, end: 2 },
      { kind: 'part', start: 2, end: 3 },
    ]);
  });

  it('groups thinking blocks at the start with tool calls', () => {
    expect(segmentParts([thought(), thought(), tool()])).toEqual([
      { kind: 'tools', start: 0, end: 3 },
    ]);
  });

  it('breaks a run at permissions even with thinking blocks', () => {
    expect(
      segmentParts([thought(), tool(), permission(), thought(), tool()])
    ).toEqual([
      { kind: 'tools', start: 0, end: 2 },
      { kind: 'part', start: 2, end: 3 },
      { kind: 'tools', start: 3, end: 5 },
    ]);
  });
  // A collapsed group would put the composed view behind a closed caret,
  // indented in a row of muted chips — the one part of the turn the reader
  // actually came for.
  it('keeps a view-rendering call out of the run it interrupts', () => {
    expect(
      segmentParts([tool(), tool(), displayResults(), tool(), tool()])
    ).toEqual([
      { kind: 'tools', start: 0, end: 2 },
      { kind: 'part', start: 2, end: 3 },
      { kind: 'tools', start: 3, end: 5 },
    ]);
  });

  it('keeps a view-rendering call alone even between single calls', () => {
    expect(segmentParts([tool(), displayResults(), tool()])).toEqual([
      { kind: 'part', start: 0, end: 1 },
      { kind: 'part', start: 1, end: 2 },
      { kind: 'part', start: 2, end: 3 },
    ]);
  });

  it('does not fold two view-rendering calls into each other', () => {
    expect(segmentParts([displayResults(), displayResults()])).toEqual([
      { kind: 'part', start: 0, end: 1 },
      { kind: 'part', start: 1, end: 2 },
    ]);
  });

  it('keeps a thought before the dashboard in the preceding tool group', () => {
    expect(
      segmentParts([thought(), tool(), thought(), displayResults()])
    ).toEqual([
      { kind: 'tools', start: 0, end: 3 },
      { kind: 'part', start: 3, end: 4 },
    ]);
  });
});

describe('rendersOwnView', () => {
  it('does not treat a same-named external MCP tool as a dashboard', () => {
    const part = tool({
      name: { kind: 'mcp', server: 'external', tool: 'DisplayResults' },
      detail: {
        kind: 'other',
        acpKind: 'other',
        input: { view: { widgets: [] } },
        output: null,
        result: null,
        error: null,
      },
    });
    expect(rendersOwnView(part)).toBe(false);
    expect(segmentParts([tool(), part, tool()])).toEqual([
      { kind: 'tools', start: 0, end: 3 },
    ]);
  });

  it('is true for a Macro displayResults call', () => {
    expect(rendersOwnView(displayResults())).toBe(true);
  });

  it('recognizes a Macro displayResults call with an MCP namespace', () => {
    const part = displayResults();
    expect(
      rendersOwnView({
        ...part,
        name: { kind: 'mcp', server: 'macro', tool: 'DisplayResults' },
      })
    ).toBe(true);
  });

  it('is false for any other tool call, and for a non-tool part', () => {
    expect(rendersOwnView(tool())).toBe(false);
    expect(rendersOwnView(text())).toBe(false);
    expect(rendersOwnView(undefined)).toBe(false);
  });

  // A harness tool that happens to share the name is not Macro's: the fold
  // decides whose shape a call is in, and only a `macro` detail carries the
  // tool's own arguments.
  it('is false for a same-named call the fold did not read as a Macro tool', () => {
    expect(
      rendersOwnView({
        kind: 'tool_use',
        id: 'other',
        name: { kind: 'native', name: 'DisplayResults' },
        status: 'completed',
        detail: {
          kind: 'other',
          acpKind: 'other',
          output: null,
          input: null,
          result: null,
          error: null,
        },
      })
    ).toBe(false);
  });
});
