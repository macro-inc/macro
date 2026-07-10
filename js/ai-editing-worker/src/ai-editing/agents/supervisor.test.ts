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

const EDIT_1 = { editing_instruction: 'first edit: bold the paragraph' };
const EDIT_2 = { editing_instruction: 'second edit: italicize the paragraph' };

/** Supervisor step 1: two parallel dispatch calls. Pauses between them and
 *  awaits `onBetweenCalls` so the test can assert coder-1 started before
 *  call-2 is dispatched, then lets the stream proceed. */
function dispatchStepStream(
  onBetweenCalls: () => Promise<void>
): ReadableStream<LanguageModelV3StreamPart> {
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
        delta: JSON.stringify(EDIT_1),
      });
      controller.enqueue({ type: 'tool-input-end', id: 'call-1' });
      controller.enqueue({
        type: 'tool-call',
        toolCallId: 'call-1',
        toolName: 'dispatch',
        input: JSON.stringify(EDIT_1),
      });
      await onBetweenCalls();
      controller.enqueue({
        type: 'tool-input-start',
        id: 'call-2',
        toolName: 'dispatch',
      });
      controller.enqueue({
        type: 'tool-input-delta',
        id: 'call-2',
        delta: JSON.stringify(EDIT_2),
      });
      controller.enqueue({ type: 'tool-input-end', id: 'call-2' });
      controller.enqueue({
        type: 'tool-call',
        toolCallId: 'call-2',
        toolName: 'dispatch',
        input: JSON.stringify(EDIT_2),
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
    const coderStartCount = { value: 0 };
    const { promise: coder1Started, resolve: resolveCoder1 } =
      Promise.withResolvers<void>();
    let step = 0;
    // Coders run against this; no tool calls, so each finishes in one step.
    const codingModel = new MockLanguageModelV3({
      modelId: 'coder-mock',
      doGenerate: async () => {
        coderStartCount.value++;
        resolveCoder1();
        return {
          content: [{ type: 'text' as const, text: 'done' }],
          finishReason: { unified: 'stop' as const, raw: undefined },
          usage,
          warnings: [],
        };
      },
    });
    const supervisorModel = new MockLanguageModelV3({
      modelId: 'supervisor-mock',
      doStream: async () => ({
        stream:
          step++ === 0
            ? dispatchStepStream(async () => {
                // coder1 should start and complete before the supervisor is done
                await coder1Started;
                expect(coderStartCount.value).toBe(1);
              })
            : textStepStream(),
      }),
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
    const editTraces: DispatchEditTrace[] = [];

    const result = await supervisor(session, 'make both edits', models, {
      borrowWriter: async () => ({
        doc: new Doc(session),
        awarenessSource: mockAwarenessSource(),
        release: () => {},
      }),
      runner: () => [],
      interpret: false,
      sleep: async () => {},
      onEditTrace: (edit) => editTraces.push(edit),
    });

    // Both coders ran exactly once (execute joined the onInputAvailable run).
    expect(coderStartCount.value).toBe(2);

    // The streamed launch is stamped into both traces.
    expect(editTraces).toHaveLength(2);
    expect(editTraces[0]!.streamedAt).toBeGreaterThan(0);
    expect(editTraces[1]!.streamedAt).toBeGreaterThan(0);

    expect(result.text).toBe('All edits applied.');
    expect(result.steps).toHaveLength(2);
  });
});
