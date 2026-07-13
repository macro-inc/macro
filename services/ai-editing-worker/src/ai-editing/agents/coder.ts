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
import { EDIT_PROVIDER_OPTIONS } from './model-options';
import type { RunTaskDeps } from './types';

export type { RunTaskDeps } from './types';

export const CHILD_SYSTEM = `${SHARED}\n${CODER}\n${API_COMPLETE}`;

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
    // Cap allows headroom for larger multi-part tasks and a few error retries.
    stopWhen: [stepCountIs(7), hasToolCall('reportBlocked')],
    system: CHILD_SYSTEM,
    prompt: buildPrompt(task, deps.context, deps.request),
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
      }),
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
