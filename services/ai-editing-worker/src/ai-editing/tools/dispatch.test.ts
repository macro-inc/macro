import type { LanguageModel, LanguageModelUsage } from 'ai';
import { describe, expect, it } from 'vitest';
import type { coder } from '../agents';
import { createEditingSession, loadMarkdown } from '../ai-toolkit/session';
import { mockAwarenessSource } from '../awareness/awareness-source';
import { Doc } from '../doc/doc';
import { TokenTracker } from '../token-tracker';
import {
  computeContextRange,
  createDispatchTool,
  type DispatchEditTrace,
  indexXmlRanges,
  mergeRanges,
} from './dispatch';

describe('mergeRanges', () => {
  it('leaves disjoint ranges alone', () => {
    expect(
      mergeRanges([
        [1, 3],
        [5, 7],
      ])
    ).toEqual([
      [1, 3],
      [5, 7],
    ]);
  });

  it('merges overlapping ranges', () => {
    expect(
      mergeRanges([
        [1, 5],
        [3, 8],
      ])
    ).toEqual([[1, 8]]);
  });

  it('merges adjacent ranges', () => {
    expect(
      mergeRanges([
        [1, 3],
        [4, 6],
      ])
    ).toEqual([[1, 6]]);
  });

  it('handles unsorted input', () => {
    expect(
      mergeRanges([
        [5, 7],
        [1, 3],
      ])
    ).toEqual([
      [1, 3],
      [5, 7],
    ]);
  });
});

describe('indexXmlRanges', () => {
  it('indexes a single node', () => {
    const xml = '<p id="abc123">hello</p>';
    const { byId } = indexXmlRanges(xml);
    expect(byId.get('abc123')).toMatchObject({
      tag: 'p',
      id: 'abc123',
      startLine: 1,
      endLine: 1,
    });
  });

  it('tracks start/end lines for a multiline node', () => {
    const xml = '<ul id="list01">\n<li id="item01">one</li>\n</ul>';
    const { byId } = indexXmlRanges(xml);
    expect(byId.get('list01')).toMatchObject({ startLine: 1, endLine: 3 });
    expect(byId.get('item01')).toMatchObject({ startLine: 2, endLine: 2 });
  });

  it('records ancestors', () => {
    const xml = '<ul id="list01">\n<li id="item01">one</li>\n</ul>';
    const { byId } = indexXmlRanges(xml);
    const item = byId.get('item01')!;
    expect(item.ancestors.map((a) => a.id)).toEqual(['list01']);
  });

  it('ignores nodes without ids', () => {
    const xml = '<p>no id here</p>\n<p id="abc123">has id</p>';
    const { byId } = indexXmlRanges(xml);
    expect(byId.size).toBe(1);
    expect(byId.has('abc123')).toBe(true);
  });
});

describe('computeContextRange', () => {
  const xml =
    '<p id="abc123">first</p>\n<p id="def456">second</p>\n<p id="ghi789">third</p>';

  it('falls back to full document when no ids match', () => {
    const range = computeContextRange(xml, 'rewrite the intro');
    expect(range.source).toBe('full-document');
  });

  it('narrows to the matching node when an id is present', () => {
    const range = computeContextRange(xml, `edit node abc123`);
    expect(range.source).toBe('ids');
    expect(range.ids).toContain('abc123');
  });

  it('spans multiple matched nodes', () => {
    const range = computeContextRange(xml, `abc123 and ghi789`);
    expect(range.startLine).toBe(1);
    expect(range.endLine).toBe(3);
  });
});

const usage: LanguageModelUsage = {
  inputTokens: 10,
  outputTokens: 5,
  totalTokens: 15,
  inputTokenDetails: {
    noCacheTokens: undefined,
    cacheReadTokens: undefined,
    cacheWriteTokens: undefined,
  },
  outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
};
const childModel = { modelId: 'child-model' } as unknown as LanguageModel;
const coderResult = (async () =>
  ({ totalUsage: usage, steps: [] }) as unknown as Awaited<
    ReturnType<typeof coder>
  >)();

function setup() {
  const session = createEditingSession();
  loadMarkdown(session, 'hello world');
  const tracker = new TokenTracker();
  const editTraces: DispatchEditTrace[] = [];
  const tasks: string[] = [];
  // The request each coder received, to verify it reaches every writer.
  const requests: Array<string | undefined> = [];
  const dispatch = createDispatchTool({
    session,
    childModel,
    tracker,
    request: 'make it formal',
    runner: () => [],
    makeWriter: async () => ({
      doc: new Doc(session),
      awarenessSource: mockAwarenessSource(),
      release: () => {},
    }),
    runTask: async (_session, task, _model, deps) => {
      tasks.push(task);
      requests.push(deps.request);
      deps.onRunCode?.();
      return coderResult;
    },
    onEditTrace: (edit) => editTraces.push(edit),
  });
  return { ...dispatch, tracker, editTraces, tasks, requests };
}

const callOptions = { toolCallId: 't1', messages: [] };

describe('dispatch -- writer inputs', () => {
  it('passes the user request to the writer', async () => {
    const { tool, requests } = setup();
    const out = await tool.execute?.(
      { editing_instruction: 'first edit' },
      callOptions
    );
    expect(out).toContain('✓ APPLIED');
    expect(requests).toEqual(['make it formal']);
  });

  it('records runCode timing in the trace', async () => {
    const { tool, editTraces } = setup();
    await tool.execute?.({ editing_instruction: 'one edit' }, callOptions);
    const trace = editTraces[0]!;
    expect(trace.runCodeAt).toHaveLength(1);
    expect(trace.runCodeAt[0]).toBeGreaterThanOrEqual(trace.coderStartedAt);
    expect(trace.coderFinishedAt).toBeGreaterThanOrEqual(trace.runCodeAt[0]!);
  });
});

describe('dispatch -- onInputAvailable early launch', () => {
  it('runs the edit once; execute joins it and marks the trace', async () => {
    const { tool, editTraces, tasks } = setup();
    const edit = { editing_instruction: 'convert the paragraph to a heading' };
    tool.onInputAvailable?.({ input: edit, toolCallId: 't1', messages: [] });
    const out = await tool.execute?.(edit, { toolCallId: 't1', messages: [] });
    expect(out).toContain('✓ APPLIED');
    expect(tasks).toEqual(['convert the paragraph to a heading']);
    const trace = editTraces[0]!;
    expect(trace.streamedAt).toBeGreaterThan(0);
    expect(trace.coderFinishedAt).toBeGreaterThanOrEqual(trace.streamedAt!);
  });

  it('execute starts the coder if onInputAvailable did not fire', async () => {
    const { tool, editTraces, tasks } = setup();
    await tool.execute?.(
      { editing_instruction: 'late edit' },
      { toolCallId: 't1', messages: [] }
    );
    expect(tasks).toEqual(['late edit']);
    expect(editTraces[0]!.streamedAt).toBeUndefined();
  });

  it('keeps calls from different tool call ids separate', async () => {
    const { tool, tasks } = setup();
    tool.onInputAvailable?.({
      input: { editing_instruction: 'other edit' },
      toolCallId: 'other-call',
      messages: [],
    });
    await tool.execute?.(
      { editing_instruction: 'this edit' },
      { toolCallId: 't1', messages: [] }
    );
    expect(tasks.sort()).toEqual(['other edit', 'this edit']);
  });
});
