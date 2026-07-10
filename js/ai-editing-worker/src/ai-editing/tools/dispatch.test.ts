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
  const editTraces: DispatchEditTrace[][] = [];
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
    onEditTrace: (edits) => editTraces.push(edits),
  });
  return { ...dispatch, tracker, editTraces, tasks, requests };
}

const callOptions = { toolCallId: 't1', messages: [] };

describe('dispatch -- writer inputs', () => {
  it('passes the user request to every writer', async () => {
    const { tool, requests } = setup();
    const out = await tool.execute?.(
      {
        edits: [
          { editing_instruction: 'first edit' },
          { editing_instruction: 'second edit' },
        ],
      },
      callOptions
    );
    expect(out).toContain('1. ✓ APPLIED');
    expect(out).toContain('2. ✓ APPLIED');
    expect(requests).toEqual(['make it formal', 'make it formal']);
  });

  it('records runCode timing in the per-edit trace', async () => {
    const { tool, editTraces } = setup();
    await tool.execute?.(
      { edits: [{ editing_instruction: 'one edit' }] },
      callOptions
    );
    const [trace] = editTraces[0]!;
    expect(trace!.runCodeAt).toHaveLength(1);
    expect(trace!.runCodeAt[0]).toBeGreaterThanOrEqual(trace!.coderStartedAt);
    expect(trace!.coderFinishedAt).toBeGreaterThanOrEqual(trace!.runCodeAt[0]!);
  });
});

describe('dispatch -- streamed launch', () => {
  it('runs a streamed edit once; execute joins it and marks the trace', async () => {
    const { tool, launch, editTraces, tasks } = setup();
    const edit = { editing_instruction: 'convert the paragraph to a heading' };
    launch('t1', edit, 0);
    const out = await tool.execute?.(
      { edits: [edit] },
      { toolCallId: 't1', messages: [] }
    );
    expect(out).toContain('1. ✓ APPLIED');
    expect(tasks).toEqual(['convert the paragraph to a heading']);
    const [trace] = editTraces[0]!;
    expect(trace!.streamedAt).toBeGreaterThan(0);
    expect(trace!.coderFinishedAt).toBeGreaterThanOrEqual(trace!.streamedAt!);
  });

  it('launches only streamed indexes early; execute starts the rest unmarked', async () => {
    const { tool, launch, editTraces, tasks } = setup();
    const first = { editing_instruction: 'first edit' };
    const second = { editing_instruction: 'second edit' };
    launch('t1', first, 0);
    await tool.execute?.(
      { edits: [first, second] },
      { toolCallId: 't1', messages: [] }
    );
    expect(tasks).toEqual(['first edit', 'second edit']);
    const [a, b] = editTraces[0]!;
    expect(a!.streamedAt).toBeGreaterThan(0);
    expect(b!.streamedAt).toBeUndefined();
  });

  it('launches a streamed element that was not yet launched at execute time', async () => {
    const { tool, launch, tasks } = setup();
    launch('t1', { editing_instruction: 'streamed edit' }, 0);
    await tool.execute?.(
      { edits: [{ editing_instruction: 'streamed edit' }] },
      { toolCallId: 't1', messages: [] }
    );
    expect(tasks).toEqual(['streamed edit']);
  });

  it('keeps launches from different tool calls separate', async () => {
    const { tool, launch, tasks } = setup();
    launch('other-call', { editing_instruction: 'other batch edit' }, 0);
    await tool.execute?.(
      { edits: [{ editing_instruction: 'this batch edit' }] },
      { toolCallId: 't1', messages: [] }
    );
    // both ran, but execute('t1') did not join or duplicate the other call's run
    expect(tasks.sort()).toEqual(['other batch edit', 'this batch edit']);
  });
});
