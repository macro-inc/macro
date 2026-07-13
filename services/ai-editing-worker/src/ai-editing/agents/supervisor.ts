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
import { interpreter } from './interpreter';
import { EDIT_PROVIDER_OPTIONS } from './model-options';
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
    const interpretation = await interpreter(
      docContext,
      request,
      models.interpret,
      INTERPRET_SYSTEM
    );
    interpretDurationMs = Date.now() - interpretStartedAt;
    tracker.add(
      models.interpret as { modelId: string },
      interpretation.totalUsage
    );
    intent = interpretation.text;
  }

  const dispatch = createDispatchTool({
    session,
    makeChildModel: models.coding,
    tracker,
    request: intent ? `${request}\n\n<intent>\n${intent}\n</intent>` : request,
    params: opts.params,
    typingAnimations: opts.typingAnimations,
    sleep: opts.sleep,
    signal: opts.signal,
    makeWriter: opts.borrowWriter,
    runTask: coder,
    serialize,
    runner: opts.runner,
    onOps: opts.onOps,
    onCoderResult: opts.onCoderResult,
    onEditTrace: opts.onEditTrace,
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
    prompt,
    tools,
    providerOptions: EDIT_PROVIDER_OPTIONS,
    abortSignal: opts.signal,
    prepareStep: ({ stepNumber }) =>
      // require that the very first thing it does is a tool call
      stepNumber === 0 ? { toolChoice: 'required' } : undefined,
    onStepFinish: () => {
      const now = Date.now();
      stepDurationsMs.push(now - lastStepAt);
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

  return {
    text: text || 'Applied edits.',
    totalUsage: tracker,
    steps,
    stepDurationsMs,
    intent,
    interpretDurationMs,
    clarification,
  };
}
