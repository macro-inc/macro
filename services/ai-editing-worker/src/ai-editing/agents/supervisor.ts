import { type Span, Telemetry } from '@macro-inc/observability';
import { hasToolCall, stepCountIs, streamText } from 'ai';
import type { ResolvedModels } from '../../run-edit';
import type { LexicalSession } from '../ai-toolkit';
import API_COMPACT from '../prompts/API_COMPACT.md';
import INTERPRET from '../prompts/INTERPRET.md';
import SHARED from '../prompts/SHARED.md';
import SUPERVISOR from '../prompts/SUPERVISOR.md';
import { TokenTracker } from '../token-tracker';
import { createDispatchTool, createImBlockedTool } from '../tools';
import { numberLines, serializeWithXml } from '../utils';
import { coder } from './coder';
import { compactDocumentHistory } from './compact';
import { interpreter } from './interpreter';
import { cachedPrompt, EDIT_PROVIDER_OPTIONS } from './model-options';
import type { RunAgentOptions } from './types';

export type { RunAgentOptions } from './types';

// TODO(wolf): figure out if we want this. Leaving it off for now.
const USE_COMPACT = false;

const MASTER_SYSTEM = `${SHARED}\n${SUPERVISOR}${USE_COMPACT ? `\n${API_COMPACT}` : ''}`;
const INTERPRET_SYSTEM = `${SHARED}\n${INTERPRET}`;

export async function supervisor(
  session: LexicalSession,
  request: string,
  models: ResolvedModels,
  opts: RunAgentOptions
) {
  const serialize = (sess: LexicalSession) =>
    numberLines(serializeWithXml(sess));
  const tracker = new TokenTracker();

  const initialText = serialize(session);
  const docContext = `<document>\n${initialText}\n</document>`;

  let intent = '';
  let interpretDurationMs: number | undefined;
  if (opts.interpret) {
    const interpretStartedAt = Date.now();
    const interpretation = await Telemetry.span(
      'edit.interpret',
      async (span) => {
        const result = await interpreter(
          docContext,
          request,
          models.interpret,
          INTERPRET_SYSTEM
        );
        span.setAttr(
          'gen_ai.request.model',
          (models.interpret as { modelId: string }).modelId
        );
        span.setAttr('intent.chars', result.text.length);
        return result;
      }
    );
    interpretDurationMs = Date.now() - interpretStartedAt;
    tracker.add(
      models.interpret as { modelId: string },
      interpretation.totalUsage
    );
    intent = interpretation.text;
  }

  // Manual span: dispatched coders launch from AI SDK stream callbacks where
  // the ambient context is unreliable, so they parent off this span explicitly.
  const superviseSpan = Telemetry.span('edit.supervise');
  // Open in `prepareStep`, closed in `onStepFinish`. Coders dispatched during a
  // turn parent off it, so the trace shows which turn spawned which edits.
  let turnSpan: Span | undefined;
  const endTurn = () => {
    turnSpan?.end();
    turnSpan = undefined;
  };
  try {
    const dispatch = createDispatchTool({
      session,
      makeChildModel: models.coding,
      tracker,
      request: intent
        ? `${request}\n\n<intent>\n${intent}\n</intent>`
        : request,
      params: opts.params,
      typingAnimations: opts.typingAnimations,
      sleep: opts.sleep,
      signal: opts.signal,
      makeWriter: opts.borrowWriter,
      maxCoderSteps: opts.maxCoderSteps,
      runTask: coder,
      serialize,
      runner: opts.runner,
      onOps: opts.onOps,
      onCoderResult: opts.onCoderResult,
      onEditTrace: opts.onEditTrace,
      parentSpan: () => turnSpan ?? superviseSpan,
    });

    const tools = {
      reportBlocked: createImBlockedTool(
        'Call this when you cannot proceed without more information or when the task is impossible.',
        true
      ),
      dispatch: dispatch.tool,
    };

    const intentBlock = intent ? `<intent>\n${intent}\n</intent>\n\n` : '';
    const prompt = `Request: ${request}\n\n${intentBlock}${docContext}`;

    // Wall-clock duration of each supervisor step, measured between step
    // boundaries. Best-effort, but since between model calls it's probably good
    // enough.
    const stepDurationsMs: number[] = [];
    let lastStepAt = Date.now();
    const result = streamText({
      model: models.supervisor,
      stopWhen: [stepCountIs(7), hasToolCall('reportBlocked')],
      system: MASTER_SYSTEM,
      messages: cachedPrompt(prompt),
      tools,
      providerOptions: EDIT_PROVIDER_OPTIONS,
      abortSignal: opts.signal,
      prepareStep: ({ stepNumber, messages }) => {
        // A step that throws mid-flight never reaches onStepFinish; close any
        // straggler so turns stay one-to-one with spans.
        endTurn();
        turnSpan = superviseSpan.span('edit.supervise.turn');
        turnSpan.setAttr('turn.index', stepNumber);
        turnSpan.setAttr('gen_ai.operation.name', 'chat');
        // require that the very first thing it does is a tool call
        return {
          ...(stepNumber === 0 ? { toolChoice: 'required' as const } : {}),
          // Only the newest dispatch result describes the live document; older
          // copies are stale and would be re-billed on every remaining step.
          messages: compactDocumentHistory(messages),
        };
      },
      onStepFinish: (step) => {
        const now = Date.now();
        stepDurationsMs.push(now - lastStepAt);
        turnSpan?.setAttr('turn.tool_calls', step.toolCalls.length);
        turnSpan?.setAttr('turn.finish_reason', step.finishReason);
        endTurn();
        lastStepAt = now;
      },
    });

    for await (const part of result.fullStream) {
      if (part.type === 'error') throw part.error;
      if (part.type === 'abort')
        throw opts.signal?.reason ?? new Error('edit session aborted');
    }

    const [steps, totalUsage, text] = await Promise.all([
      result.steps,
      result.totalUsage,
      result.text,
    ]);
    tracker.add(models.supervisor as { modelId: string }, totalUsage);

    const blocked = steps
      .flatMap((s) => s.toolCalls)
      .find((c) => c.toolName === 'reportBlocked');
    const clarification = (blocked?.input as { message: string } | undefined)
      ?.message;

    superviseSpan.setAttr(
      'gen_ai.request.model',
      (models.supervisor as { modelId: string }).modelId
    );
    superviseSpan.setAttr('steps.count', steps.length);
    superviseSpan.setAttr('edit.blocked', blocked !== undefined);
    if (clarification !== undefined)
      superviseSpan.setAttr('clarification.chars', clarification.length);

    return {
      text: text || 'Applied edits.',
      totalUsage: tracker,
      steps,
      stepDurationsMs,
      intent,
      interpretDurationMs,
      clarification,
    };
  } catch (e) {
    // A turn is still open when the failure happened mid-step; blame it there
    // too so the trace points at the turn, not just the whole supervisor run.
    turnSpan?.error(e);
    superviseSpan.error(e);
    throw e;
  } finally {
    endTurn();
    superviseSpan.end();
  }
}
