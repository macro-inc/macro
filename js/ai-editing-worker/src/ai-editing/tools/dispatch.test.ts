import type { LanguageModel, LanguageModelUsage } from 'ai';
import { describe, expect, it } from 'vitest';
import type { coder } from '../agents';
import type { snippet } from '../agents/snippet';
import { createEditingSession, loadMarkdown } from '../ai-toolkit/session';
import { mockAwarenessSource } from '../awareness/awareness-source';
import { Doc } from '../doc/doc';
import { type SnippetSource, settleSnippets } from '../runtime';
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

describe('dispatch — snippet_specs', () => {
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
  const snippetModel = { modelId: 'snip-model' } as unknown as LanguageModel;
  const snippetHighModel = {
    modelId: 'snip-high-model',
  } as unknown as LanguageModel;
  const childModel = { modelId: 'child-model' } as unknown as LanguageModel;
  const coderResult = (async () =>
    ({ totalUsage: usage, steps: [] }) as unknown as Awaited<
      ReturnType<typeof coder>
    >)();

  function setup(opts: {
    runSnippet: typeof snippet;
    onSnippets?: (s: SnippetSource | undefined) => void;
  }) {
    const session = createEditingSession();
    loadMarkdown(session, 'hello world');
    const tracker = new TokenTracker();
    const editTraces: DispatchEditTrace[][] = [];
    const dispatchTool = createDispatchTool({
      session,
      childModel,
      snippetModel,
      snippetHighModel,
      tracker,
      runSnippet: opts.runSnippet,
      runner: () => [],
      makeWriter: async () => ({
        doc: new Doc(session),
        awarenessSource: mockAwarenessSource(),
        release: () => {},
      }),
      runTask: async (_session, _task, _model, deps) => {
        opts.onSnippets?.(deps.snippets);
        deps.onRunCode?.();
        return coderResult;
      },
      onEditTrace: (edits) => editTraces.push(edits),
    });
    return { dispatchTool, tracker, editTraces };
  }

  const callOptions = { toolCallId: 't1', messages: [] };

  it('launches one agent per spec, merges pending values, and tracks usage', async () => {
    const briefs: string[] = [];
    let seen: SnippetSource | undefined;
    const { dispatchTool, tracker, editTraces } = setup({
      runSnippet: async (brief) => {
        briefs.push(brief);
        return { text: `composed: ${brief}`, totalUsage: usage };
      },
      onSnippets: (s) => {
        seen = s;
      },
    });
    await dispatchTool.execute?.(
      {
        edits: [
          {
            editing_instruction: 'insert snippets.intro after the paragraph',
            snippets: { exact: 'as-is' },
            snippet_specs: { intro: 'one paragraph about intros' },
          },
        ],
      },
      callOptions
    );
    expect(briefs).toEqual(['one paragraph about intros']);
    expect(await settleSnippets(seen)).toEqual({
      exact: 'as-is',
      intro: 'composed: one paragraph about intros',
    });
    expect(tracker.toEntries()).toContainEqual({
      model: 'snip-model',
      inputTokens: 10,
      outputTokens: 5,
    });

    expect(editTraces).toHaveLength(1);
    const [trace] = editTraces[0]!;
    expect(trace!.snippets).toMatchObject([
      {
        key: 'intro',
        brief: 'one paragraph about intros',
        text: 'composed: one paragraph about intros',
      },
    ]);
    expect(trace!.snippets[0]!.resolvedAt).toBeGreaterThanOrEqual(
      trace!.snippets[0]!.startedAt
    );
    expect(trace!.runCodeAt).toHaveLength(1);
    expect(trace!.runCodeAt[0]).toBeGreaterThanOrEqual(trace!.coderStartedAt);
    expect(trace!.coderFinishedAt).toBeGreaterThanOrEqual(trace!.runCodeAt[0]!);
  });

  it('routes effort:high specs to the high model and low/string specs to the default', async () => {
    const modelsByBrief: Record<string, string> = {};
    const { dispatchTool, tracker, editTraces } = setup({
      runSnippet: async (brief, _context, model) => {
        modelsByBrief[brief] = (model as { modelId: string }).modelId;
        return { text: `composed: ${brief}`, totalUsage: usage };
      },
    });
    await dispatchTool.execute?.(
      {
        edits: [
          {
            editing_instruction: 'insert snippets.plain and snippets.fancy',
            snippet_specs: {
              plain: 'a one-line caption',
              fancy: { brief: 'a long poem', effort: 'high' },
            },
          },
        ],
      },
      callOptions
    );
    expect(modelsByBrief).toEqual({
      'a one-line caption': 'snip-model',
      'a long poem': 'snip-high-model',
    });
    expect(tracker.toEntries()).toContainEqual({
      model: 'snip-high-model',
      inputTokens: 10,
      outputTokens: 5,
    });
    expect(editTraces[0]![0]!.snippets).toMatchObject([
      { key: 'plain', effort: 'low' },
      { key: 'fancy', effort: 'high' },
    ]);
  });

  it('survives a rejecting spec the writer never awaits and traces the error', async () => {
    const { dispatchTool, editTraces } = setup({
      runSnippet: async () => {
        throw new Error('model unavailable');
      },
    });
    const out = await dispatchTool.execute?.(
      {
        edits: [
          {
            editing_instruction: 'do something else entirely',
            snippet_specs: { unused: 'never referenced' },
          },
        ],
      },
      callOptions
    );
    expect(out).toContain('APPLIED');
    // the trace tap runs on a microtask after the batch resolves
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(editTraces[0]![0]!.snippets[0]).toMatchObject({
      key: 'unused',
      error: 'model unavailable',
    });
  });
});
