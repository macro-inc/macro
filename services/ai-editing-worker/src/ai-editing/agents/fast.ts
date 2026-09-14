import { Telemetry } from '@macro-inc/observability';
import { generateText, hasToolCall, type LanguageModel, stepCountIs } from 'ai';
import type { LexicalSession } from '../ai-toolkit';
import type { DocumentOp } from '../editor';
import { FAST_SYSTEM } from '../prompts';
import type { DocumentOpQueueParams } from '../queue';
import type { CodeRunner } from '../runtime';
import { TokenTracker } from '../token-tracker';
import {
  type CoderRunCode,
  createImBlockedTool,
  createReadDocumentTool,
  createRunCodeTool,
  type DispatchEditTrace,
  type SnippetPair,
  snippetsToRecord,
  type Writer,
} from '../tools';
import { numberLines, serializeWithXml } from '../utils';
import { cachedPrompt, EDIT_PROVIDER_OPTIONS } from './model-options';

/**
 * Step cap for the fast editor: one `runCode` that does the whole request,
 * plus room to read the effect report and correct it. The whole point of the
 * mode is a single model on the hot path, so this stays well under the
 * supervised pipeline's 7-turn × 7-step envelope.
 */
export const DEFAULT_MAX_FAST_STEPS = 4;

export type FastEditorOptions = {
  borrowWriter: () => Promise<Writer>;
  runner: CodeRunner;
  maxSteps?: number;
  params?: DocumentOpQueueParams;
  typingAnimations?: boolean;
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
  onOps?: (ops: DocumentOp[]) => void;
  onCoderResult?: (codes: CoderRunCode[]) => void;
  onEditTrace?: (edit: DispatchEditTrace) => void;
};

/**
 * Stop once a step's `runCode` calls all came back `ok` with a `CHANGED`
 * report. The model would otherwise spend a full round trip — measured at
 * 4.3 s on a 10k-token context — writing a one-line summary nobody reads.
 * Errors and `NO CHANGE` replies don't match, so the model still gets its
 * retry; a wrong-but-successful edit is the trade for that round trip.
 */
type StepLike = {
  toolResults: ReadonlyArray<{ toolName: string; output: unknown }>;
};

/** Every `runCode` in this step came back `ok` with a `CHANGED` report. */
export function stepHasCleanEdit(step: StepLike): boolean {
  const results = step.toolResults.filter((r) => r.toolName === 'runCode');
  return (
    results.length > 0 &&
    results.every(
      (r) =>
        typeof r.output === 'string' &&
        r.output.startsWith('ok') &&
        r.output.includes('CHANGED')
    )
  );
}

export const hasCleanEdit = ({
  steps,
}: {
  steps: ReadonlyArray<StepLike>;
}): boolean => {
  const last = steps.at(-1);
  return last !== undefined && stepHasCleanEdit(last);
};

export function buildFastPrompt(request: string, document: string): string {
  return `Request: ${request}\n\n<document>\n${document}\n</document>`;
}

/**
 * The hot path: no interpreter, no supervisor, no dispatch. One model gets the
 * user's request and the whole document and edits it directly through
 * `runCode`, seeing each call's effect report so it can correct itself.
 * Everything below `runCode` (sandbox, ops, animation queue, `Doc.apply`,
 * propagation) is the same machinery the supervised pipeline uses.
 */
export async function fastEditor(
  session: LexicalSession,
  request: string,
  model: LanguageModel,
  opts: FastEditorOptions
) {
  const tracker = new TokenTracker();
  const span = Telemetry.span('edit.fast');
  const trace: DispatchEditTrace = {
    coderStartedAt: Date.now(),
    coderFinishedAt: 0,
    runCodeAt: [],
    runCodeResults: [],
  };
  const stepDurationsMs: number[] = [];
  let lastStepAt = Date.now();

  const writer = await opts.borrowWriter();
  try {
    const document = numberLines(serializeWithXml(session));
    span.setAttr('document.chars', document.length);
    span.setAttr(
      'gen_ai.request.model',
      (model as { modelId: string }).modelId
    );

    const result = await generateText({
      model,
      stopWhen: [
        stepCountIs(opts.maxSteps ?? DEFAULT_MAX_FAST_STEPS),
        hasToolCall('reportBlocked'),
        hasCleanEdit,
      ],
      system: FAST_SYSTEM,
      messages: cachedPrompt(buildFastPrompt(request, document)),
      tools: {
        runCode: createRunCodeTool({
          session,
          doc: writer.doc,
          awarenessSource: writer.awarenessSource,
          params: opts.params,
          typingAnimations: opts.typingAnimations,
          sleep: opts.sleep,
          runner: opts.runner,
          onOps: opts.onOps,
          onRunCode: () => trace.runCodeAt.push(Date.now()),
          onRunCodeResult: (reply) => trace.runCodeResults.push(reply),
          span,
        }),
        readDocument: createReadDocumentTool({ session }),
        reportBlocked: createImBlockedTool(
          'Call this when the request cannot be carried out, or needs information only the user can supply.',
          true
        ),
      },
      providerOptions: EDIT_PROVIDER_OPTIONS,
      abortSignal: opts.signal,
      // The first thing out of the model must be an edit, not a plan.
      prepareStep: ({ stepNumber }) =>
        stepNumber === 0 ? { toolChoice: 'required' as const } : {},
      onStepFinish: () => {
        const now = Date.now();
        stepDurationsMs.push(now - lastStepAt);
        lastStepAt = now;
      },
    });

    tracker.add(model as { modelId: string }, result.totalUsage);
    // A call the schema rejected never executed and has no result to pair
    // with; its raw input is whatever the model sent, not our shape.
    const toolCalls = result.steps
      .flatMap((step) => step.toolCalls)
      .filter((call) => !call.invalid);
    const blocked = toolCalls.find((call) => call.toolName === 'reportBlocked');
    const clarification = (blocked?.input as { message: string } | undefined)
      ?.message;

    const codes: CoderRunCode[] = toolCalls
      .filter((call) => call.toolName === 'runCode')
      .map((call, i) => {
        const input = call.input as { code: string; snippets?: SnippetPair[] };
        return {
          code: input.code,
          snippets: snippetsToRecord(input.snippets),
          result: trace.runCodeResults[i],
        };
      });
    opts.onCoderResult?.(codes);
    trace.coderFinishedAt = Date.now();
    opts.onEditTrace?.(trace);

    span.setAttr('steps.count', result.steps.length);
    span.setAttr('run_code.count', codes.length);
    span.setAttr('edit.blocked', blocked !== undefined);

    // Hitting the step cap with nothing but errors or NO CHANGE replies is a
    // failed edit, not a quiet success; say so rather than returning no ops.
    if (blocked === undefined && !result.steps.some(stepHasCleanEdit)) {
      throw new Error(
        `fast edit made no change in ${result.steps.length} step(s): ${
          trace.runCodeResults.at(-1)?.split('\n')[0] ?? 'no runCode call'
        }`
      );
    }

    return {
      text: result.text || 'Applied edits.',
      totalUsage: tracker,
      steps: result.steps,
      stepDurationsMs,
      clarification,
    };
  } catch (e) {
    span.error(e);
    throw e;
  } finally {
    writer.release();
    span.end();
  }
}
