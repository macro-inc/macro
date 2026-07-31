import type {
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';
import { type Span, Telemetry } from '@macro-inc/observability';
import { MockLanguageModelV3 } from 'ai/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

/** One recorded span, so tests can assert the shape of the emitted tree. */
type SpanNode = {
  name: string;
  attrs: Record<string, unknown>;
  children: SpanNode[];
  ended: boolean;
};

/** Replace `Telemetry.span` with a recorder that builds the parent/child tree
 *  the supervisor produces. Returns the roots it collected. */
function recordSpans(): SpanNode[] {
  const roots: SpanNode[] = [];

  const make = (name: string, siblings: SpanNode[]): Span => {
    const node: SpanNode = { name, attrs: {}, children: [], ended: false };
    siblings.push(node);
    const span: Span = {
      span: ((childName: string, operation?: (s: Span) => Promise<unknown>) => {
        const child = make(childName, node.children);
        return operation ? operation(child) : child;
      }) as Span['span'],
      run: (operation) => operation(),
      setAttr: (name, value) => {
        node.attrs[name] = value;
      },
      event: () => {},
      error: () => {},
      traceparent: () => undefined,
      injectTraceHeaders: () => {},
      end: () => {
        node.ended = true;
      },
    };
    return span;
  };

  vi.spyOn(Telemetry, 'span').mockImplementation(((
    name: string,
    operation?: (span: Span) => Promise<unknown>
  ) => {
    const span = make(name, roots);
    return operation ? operation(span) : span;
  }) as typeof Telemetry.span);

  return roots;
}

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
      coding: () => codingModel,
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

describe('supervisor — turn spans', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('nests each turn under the supervisor, and its coders under the turn', async () => {
    const roots = recordSpans();

    let step = 0;
    const codingModel = new MockLanguageModelV3({
      modelId: 'coder-mock',
      doGenerate: async () => ({
        content: [{ type: 'text' as const, text: 'done' }],
        finishReason: { unified: 'stop' as const, raw: undefined },
        usage,
        warnings: [],
      }),
    });
    const supervisorModel = new MockLanguageModelV3({
      modelId: 'supervisor-mock',
      doStream: async () => ({
        stream:
          step++ === 0 ? dispatchStepStream(async () => {}) : textStepStream(),
      }),
    });
    const models = {
      supervisor: supervisorModel,
      interpret: codingModel,
      coding: () => codingModel,
    } as unknown as ResolvedModels;

    const session = createEditingSession();
    loadMarkdown(session, 'hello world');

    await supervisor(session, 'make both edits', models, {
      borrowWriter: async () => ({
        doc: new Doc(session),
        awarenessSource: mockAwarenessSource(),
        release: () => {},
      }),
      runner: () => [],
      interpret: false,
      sleep: async () => {},
    });

    const supervise = roots.find((node) => node.name === 'edit.supervise');
    expect(supervise).toBeDefined();

    // One turn span per supervisor step, in order, all closed.
    const turns = supervise!.children.filter(
      (node) => node.name === 'edit.supervise.turn'
    );
    expect(turns).toHaveLength(2);
    expect(turns.map((turn) => turn.attrs['turn.index'])).toEqual([0, 1]);
    expect(turns.every((turn) => turn.ended)).toBe(true);

    // Both coders hang off the turn that dispatched them, not the root.
    expect(turns[0]!.children.map((node) => node.name)).toEqual([
      'edit.dispatch',
      'edit.dispatch',
    ]);
    expect(turns[1]!.children).toHaveLength(0);
    expect(
      supervise!.children.filter((node) => node.name === 'edit.dispatch')
    ).toHaveLength(0);

    // Per-turn usage is recorded, not just the run-level aggregate.
    expect(turns[0]!.attrs).toMatchObject({
      'gen_ai.operation.name': 'chat',
      'gen_ai.usage.input_tokens': 10,
      'gen_ai.usage.output_tokens': 5,
      'turn.tool_calls': 2,
      'turn.finish_reason': 'tool-calls',
    });
    expect(turns[1]!.attrs).toMatchObject({
      'turn.tool_calls': 0,
      'turn.finish_reason': 'stop',
    });
  });
});
