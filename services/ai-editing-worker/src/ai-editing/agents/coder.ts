import { generateText, hasToolCall, type LanguageModel, stepCountIs } from 'ai';
import type { LexicalSession } from '../ai-toolkit';
import API_COMPLETE from '../prompts/API_COMPLETE.md';
import CODER from '../prompts/CODER.md';
import SHARED from '../prompts/SHARED.md';
import {
  createImBlockedTool,
  createReadDocumentTool,
  createRunCodeTool,
} from '../tools';
import { buildPrompt } from './coder-prompt';
import { cachedPrompt, EDIT_PROVIDER_OPTIONS } from './model-options';
import type { RunTaskDeps } from './types';

export type { RunTaskDeps } from './types';

export const CHILD_SYSTEM = `${SHARED}\n${CODER}\n${API_COMPLETE}`;

/**
 * Default per-coder step cap.
 *
 * Lowering this to 3 was tried and reverted. It did cut runCode calls (139 -> 118
 * over 40 cases) but the work simply moved up a level: dispatch rounds rose
 * 79 -> 89 as the supervisor re-dispatched coders it had cut off, cost rose, and
 * quality fell hard — purpose met 35/40 -> 31/40, fully correct 34/40 -> 28/40.
 * A coder that needs a fourth step is better served finishing than being
 * truncated into a fresh dispatch.
 */
export const DEFAULT_MAX_CODER_STEPS = 7;

/** One writer: carry out a single edit instruction via the `editor` surface. */
export async function coder(
  session: LexicalSession,
  task: string,
  model: LanguageModel,
  deps: RunTaskDeps
) {
  return generateText({
    model,
    // Stop on the step cap OR the moment the writer declares itself blocked.
    stopWhen: [
      stepCountIs(deps.maxSteps ?? DEFAULT_MAX_CODER_STEPS),
      hasToolCall('reportBlocked'),
    ],
    system: CHILD_SYSTEM,
    // System, tools, and task/context are fixed for this coder's whole run;
    // one cache breakpoint on the opening message covers all of them.
    messages: cachedPrompt(buildPrompt(task, deps.context, deps.request)),
    tools: {
      runCode: createRunCodeTool({
        session: session,
        doc: deps.doc,
        awarenessSource: deps.awarenessSource,
        params: deps.params,
        typingAnimations: deps.typingAnimations,
        sleep: deps.sleep,
        runner: deps.runner,
        onOps: deps.onOps,
        onRunCode: deps.onRunCode,
        span: deps.span,
        onRunCodeResult: deps.onRunCodeResult,
      }),
      // Always available, even when the coder's window already is the whole
      // document. Withholding it looked like free savings — the call can only
      // return what the coder was handed — but the bench says otherwise:
      // removing it drove coder input tokens +37%, runCode calls 129 -> 168 and
      // retries 22 -> 28. The re-read is not redundant, it is the coder's only
      // way to see the document AFTER its own edits, and without that feedback
      // it makes more blind attempts than the re-read ever cost.
      readDocument: createReadDocumentTool({ session }),
      reportBlocked: createImBlockedTool(
        'Call this instead of guessing when you cannot do the edit -- but only after `readDocument` failed to surface what you need.',
        false
      ),
    },
    providerOptions: EDIT_PROVIDER_OPTIONS,
    abortSignal: deps.signal,
  });
}
