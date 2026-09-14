import type {
  LanguageModelV3CallOptions,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';
import { MockLanguageModelV3 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { createEditingSession, loadMarkdown } from '../ai-toolkit/session';
import { mockAwarenessSource } from '../awareness/awareness-source';
import { Doc } from '../doc/doc';
import type { DocumentOp } from '../editor';
import type { CoderRunCode, DispatchEditTrace } from '../tools';
import { serializeWithXml } from '../utils';
import { fastEditor } from './fast';

const usage: LanguageModelV3Usage = {
  inputTokens: {
    total: 10,
    noCache: undefined,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

const finish = { unified: 'stop' as const, raw: undefined };

/** The fast path declares snippets as pairs (see SnippetShape). */
function runCodeCall(id: string, input: CoderRunCode) {
  const snippets = Object.entries(input.snippets ?? {}).map(([key, text]) => ({
    key,
    text,
  }));
  return {
    type: 'tool-call' as const,
    toolCallId: id,
    toolName: 'runCode',
    input: JSON.stringify({ code: input.code, snippets }),
  };
}

/** A runner that plays back canned ops, as if the sandbox produced them. */
const replay = (opsByCall: DocumentOp[][]) => (): DocumentOp[] =>
  opsByCall.shift() ?? [];

describe('fastEditor', () => {
  it('edits in one runCode call, stops on the clean effect report, and records the code', async () => {
    const session = createEditingSession();
    loadMarkdown(session, 'hello world');
    const paragraphId = serializeWithXml(session).match(/<p id="([^"]+)"/)![1]!;

    const calls: LanguageModelV3CallOptions[] = [];
    let step = 0;
    const model = new MockLanguageModelV3({
      modelId: 'fast-mock',
      doGenerate: async (options) => {
        calls.push(options);
        return step++ === 0
          ? {
              content: [
                runCodeCall('call-1', {
                  code: `editor.setText('${paragraphId}', snippets.text)`,
                  snippets: { text: 'goodbye world' },
                }),
              ],
              finishReason: { unified: 'tool-calls' as const, raw: undefined },
              usage,
              warnings: [],
            }
          : {
              content: [{ type: 'text' as const, text: 'Replaced the text.' }],
              finishReason: finish,
              usage,
              warnings: [],
            };
      },
    });

    const codes: CoderRunCode[][] = [];
    const traces: DispatchEditTrace[] = [];
    const ops: DocumentOp[] = [];
    const result = await fastEditor(session, 'say goodbye', model, {
      borrowWriter: async () => ({
        doc: new Doc(session),
        awarenessSource: mockAwarenessSource(),
        release: () => {},
      }),
      runner: replay([
        [{ kind: 'setText', node: paragraphId, text: 'goodbye world' }],
      ]),
      typingAnimations: false,
      sleep: async () => {},
      onOps: (batch) => ops.push(...batch),
      onCoderResult: (batch) => codes.push(batch),
      onEditTrace: (trace) => traces.push(trace),
    });

    // The whole document went in the opening prompt.
    const firstPrompt = calls[0]!.prompt;
    const openingUser = JSON.stringify(firstPrompt);
    expect(openingUser).toContain(paragraphId);
    expect(openingUser).toContain('Request: say goodbye');
    // The first step must be a tool call.
    expect(calls[0]!.toolChoice).toEqual({ type: 'required' });

    expect(serializeWithXml(session)).toContain('goodbye world');
    expect(ops).toHaveLength(1);
    // A clean CHANGED report ends the run; no summary round trip.
    expect(calls).toHaveLength(1);
    expect(result.steps).toHaveLength(1);
    expect(result.text).toBe('Applied edits.');
    expect(result.clarification).toBeUndefined();

    expect(codes).toEqual([
      [
        {
          code: `editor.setText('${paragraphId}', snippets.text)`,
          snippets: { text: 'goodbye world' },
          result: expect.stringContaining('CHANGED'),
        },
      ],
    ]);
    expect(traces).toHaveLength(1);
    expect(traces[0]!.runCodeAt).toHaveLength(1);
    expect(traces[0]!.coderFinishedAt).toBeGreaterThan(0);
  });

  it('retries after an error reply instead of stopping', async () => {
    const session = createEditingSession();
    loadMarkdown(session, 'hello world');
    const paragraphId = serializeWithXml(session).match(/<p id="([^"]+)"/)![1]!;
    const code = `editor.setText('${paragraphId}', snippets.text)`;
    let step = 0;
    const model = new MockLanguageModelV3({
      modelId: 'fast-mock',
      doGenerate: async () =>
        step++ === 0
          ? {
              // Missing snippet: the runtime rejects it before the sandbox.
              content: [runCodeCall('call-1', { code, snippets: {} })],
              finishReason: { unified: 'tool-calls' as const, raw: undefined },
              usage,
              warnings: [],
            }
          : {
              content: [
                runCodeCall('call-2', { code, snippets: { text: 'fixed' } }),
              ],
              finishReason: { unified: 'tool-calls' as const, raw: undefined },
              usage,
              warnings: [],
            },
    });

    const codes: CoderRunCode[][] = [];
    const result = await fastEditor(session, 'fix it', model, {
      borrowWriter: async () => ({
        doc: new Doc(session),
        awarenessSource: mockAwarenessSource(),
        release: () => {},
      }),
      // The first call fails validation before the runner; only the retry runs.
      runner: replay([[{ kind: 'setText', node: paragraphId, text: 'fixed' }]]),
      typingAnimations: false,
      sleep: async () => {},
      onCoderResult: (batch) => codes.push(batch),
    });

    expect(result.steps).toHaveLength(2);
    expect(codes[0]).toHaveLength(2);
    expect(codes[0]![0]!.result).toMatch(/^error:/);
    expect(codes[0]![0]!.snippets).toEqual({});
    expect(codes[0]![1]!.snippets).toEqual({ text: 'fixed' });
    expect(serializeWithXml(session)).toContain('fixed');
  });

  it('fails loudly when the step cap is hit without a successful edit', async () => {
    const session = createEditingSession();
    loadMarkdown(session, 'hello world');
    // Every call references a snippet it never supplies, so every reply is an
    // error and no step ever reports CHANGED.
    const model = new MockLanguageModelV3({
      modelId: 'fast-mock',
      doGenerate: async () => ({
        content: [
          runCodeCall('call', {
            code: "editor.setText('nope', snippets.text)",
            snippets: {},
          }),
        ],
        finishReason: { unified: 'tool-calls' as const, raw: undefined },
        usage,
        warnings: [],
      }),
    });

    await expect(
      fastEditor(session, 'fix it', model, {
        borrowWriter: async () => ({
          doc: new Doc(session),
          awarenessSource: mockAwarenessSource(),
          release: () => {},
        }),
        runner: () => [],
        maxSteps: 2,
        sleep: async () => {},
      })
    ).rejects.toThrow(/made no change in 2 step\(s\)/);
  });

  it('surfaces reportBlocked as a clarification and stops', async () => {
    const session = createEditingSession();
    loadMarkdown(session, 'hello world');
    let generateCount = 0;
    const model = new MockLanguageModelV3({
      modelId: 'fast-mock',
      doGenerate: async () => {
        generateCount++;
        return {
          content: [
            {
              type: 'tool-call' as const,
              toolCallId: 'call-1',
              toolName: 'reportBlocked',
              input: JSON.stringify({ message: 'Which paragraph?' }),
            },
          ],
          finishReason: { unified: 'tool-calls' as const, raw: undefined },
          usage,
          warnings: [],
        };
      },
    });

    const result = await fastEditor(session, 'fix it', model, {
      borrowWriter: async () => ({
        doc: new Doc(session),
        awarenessSource: mockAwarenessSource(),
        release: () => {},
      }),
      runner: () => [],
      sleep: async () => {},
    });

    expect(generateCount).toBe(1);
    expect(result.clarification).toBe('Which paragraph?');
    expect(serializeWithXml(session)).toContain('hello world');
  });
});
