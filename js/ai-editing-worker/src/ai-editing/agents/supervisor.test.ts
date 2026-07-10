import type {
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';
import { MockLanguageModelV3 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import type { ResolvedModels } from '../../run-edit';
import { createEditingSession, loadMarkdown } from '../ai-toolkit/session';
import { mockAwarenessSource } from '../awareness/awareness-source';
import { Doc } from '../doc/doc';
import type { DispatchEditTrace } from '../tools';
import { supervisor } from './supervisor';

const usage: LanguageModelV3Usage = {
  inputTokens: {
    total: 10,
    noCache: undefined,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

const EDITS = [
  { editing_instruction: 'first edit: bold the paragraph' },
  { editing_instruction: 'second edit: italicize the paragraph' },
];
const EDITS_JSON = JSON.stringify({ edits: EDITS });

/** Supervisor step 1: a dispatch call streamed in deltas, paced so the first
 *  `edits` element is complete (and the second begun) well before the call
 *  finishes. `events` records enqueue order to compare against coder starts. */
function dispatchStepStream(
  events: string[]
): ReadableStream<LanguageModelV3StreamPart> {
  // Split mid-array: everything through `edits[0]` plus the opening of
  // `edits[1]`, then the rest after a pause.
  const splitAt = EDITS_JSON.indexOf('"second');
  const head = EDITS_JSON.slice(0, splitAt);
  const tail = EDITS_JSON.slice(splitAt);
  return new ReadableStream({
    async start(controller) {
      controller.enqueue({ type: 'stream-start', warnings: [] });
      controller.enqueue({
        type: 'tool-input-start',
        id: 'call-1',
        toolName: 'dispatch',
      });
      controller.enqueue({
        type: 'tool-input-delta',
        id: 'call-1',
        delta: head,
      });
      // Yield long enough for the router to parse and launch edit 0.
      await new Promise((resolve) => setTimeout(resolve, 50));
      events.push('final-deltas-enqueued');
      controller.enqueue({
        type: 'tool-input-delta',
        id: 'call-1',
        delta: tail,
      });
      controller.enqueue({ type: 'tool-input-end', id: 'call-1' });
      controller.enqueue({
        type: 'tool-call',
        toolCallId: 'call-1',
        toolName: 'dispatch',
        input: EDITS_JSON,
      });
      controller.enqueue({
        type: 'finish',
        finishReason: { unified: 'tool-calls', raw: undefined },
        usage,
      });
      controller.close();
    },
  });
}

/** Supervisor step 2: plain text wrap-up after the tool result. */
function textStepStream(): ReadableStream<LanguageModelV3StreamPart> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue({ type: 'stream-start', warnings: [] });
      controller.enqueue({ type: 'text-start', id: 't1' });
      controller.enqueue({
        type: 'text-delta',
        id: 't1',
        delta: 'All edits applied.',
      });
      controller.enqueue({ type: 'text-end', id: 't1' });
      controller.enqueue({
        type: 'finish',
        finishReason: { unified: 'stop', raw: undefined },
        usage,
      });
      controller.close();
    },
  });
}

describe('supervisor — streamed dispatch', () => {
  it('launches coders from streaming args before the dispatch call completes', async () => {
    const events: string[] = [];
    let step = 0;
    const supervisorModel = new MockLanguageModelV3({
      modelId: 'supervisor-mock',
      doStream: async () => ({
        stream: step++ === 0 ? dispatchStepStream(events) : textStepStream(),
      }),
    });
    // Coders run against this; no tool calls, so each finishes in one step.
    const codingModel = new MockLanguageModelV3({
      modelId: 'coder-mock',
      doGenerate: async () => {
        events.push('coder-started');
        return {
          content: [{ type: 'text' as const, text: 'done' }],
          finishReason: { unified: 'stop' as const, raw: undefined },
          usage,
          warnings: [],
        };
      },
    });
    const models = {
      supervisor: supervisorModel,
      interpret: codingModel,
      coding: codingModel,
      snippet: codingModel,
      snippetHigh: codingModel,
    } as unknown as ResolvedModels;

    const session = createEditingSession();
    loadMarkdown(session, 'hello world');
    const editTraces: DispatchEditTrace[][] = [];

    const result = await supervisor(session, 'make both edits', models, {
      borrowWriter: async () => ({
        doc: new Doc(session),
        awarenessSource: mockAwarenessSource(),
        release: () => {},
      }),
      runner: () => [],
      interpret: false,
      sleep: async () => {},
      onEditTrace: (edits) => editTraces.push(edits),
    });

    // Edit 0's coder started while the dispatch args were still streaming.
    const firstCoder = events.indexOf('coder-started');
    const finalDeltas = events.indexOf('final-deltas-enqueued');
    expect(firstCoder).toBeGreaterThanOrEqual(0);
    expect(firstCoder).toBeLessThan(finalDeltas);

    // Both coders ran exactly once (execute joined the streamed run).
    expect(events.filter((e) => e === 'coder-started')).toHaveLength(2);

    // The streamed launch is stamped into the per-edit trace.
    expect(editTraces).toHaveLength(1);
    const [first, second] = editTraces[0]!;
    expect(first!.streamedAt).toBeGreaterThan(0);
    expect(second).toBeDefined();

    expect(result.text).toBe('All edits applied.');
    expect(result.steps).toHaveLength(2);
  });
});
