import { generateText, hasToolCall, stepCountIs } from 'ai';
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

const MASTER_SYSTEM = `${SHARED}\n${SUPERVISOR}\n${API_COMPACT}`;
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
  if (opts.interpret) {
    const interpretation = await interpreter(
      docContext,
      request,
      models.interpret,
      INTERPRET_SYSTEM
    );
    tracker.add(
      models.interpret as { modelId: string },
      interpretation.totalUsage
    );
    intent = interpretation.text;
  }

  const tools = {
    reportBlocked: createImBlockedTool(
      'Call this when you cannot proceed without more information or when the task is impossible.',
      true
    ),
    dispatch: createDispatchTool({
      session,
      childModel: models.coding,
      tracker,
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
    }),
  };

  const intentBlock = intent ? `<intent>\n${intent}\n</intent>\n\n` : '';
  const prompt = `Request: ${request}\n\n${intentBlock}${docContext}`;

  // Wall-clock duration of each supervisor step, measured between step
  // boundaries. In Workers `Date.now()` only advances across I/O, which every
  // step has (the model call), so these deltas are real.
  const stepDurationsMs: number[] = [];
  let lastStepAt = Date.now();
  const result = await generateText({
    model: models.supervisor,
    stopWhen: [stepCountIs(6), hasToolCall('reportBlocked')],
    system: MASTER_SYSTEM,
    prompt,
    tools,
    providerOptions: EDIT_PROVIDER_OPTIONS,
    abortSignal: opts.signal,
    onStepFinish: () => {
      const now = Date.now();
      stepDurationsMs.push(now - lastStepAt);
      lastStepAt = now;
    },
  });
  tracker.add(models.supervisor as { modelId: string }, result.totalUsage);

  const blocked = result.steps
    .flatMap((s) => s.toolCalls)
    .find((c) => c.toolName === 'reportBlocked');
  const clarification = (blocked?.input as { message: string } | undefined)
    ?.message;

  return {
    text: result.text || 'Applied edits.',
    totalUsage: tracker,
    steps: result.steps,
    stepDurationsMs,
    intent,
    clarification,
  };
}
