import {
  generateText,
  hasToolCall,
  type LanguageModel,
  stepCountIs,
  tool,
} from 'ai';
import { z } from 'zod';
import type { Session } from '../ai-toolkit';
import type { AwarenessSource } from '../awareness/awareness-source';
import type { Doc } from '../doc/doc';
import API_COMPLETE from '../prompts/API_COMPLETE.md';
import CODER from '../prompts/CODER.md';
import SHARED from '../prompts/SHARED.md';
import type { DocumentOpQueueParams } from '../queue/types';
import { createRunCodeTool, type RunCodeToolOptions } from '../tools/run-code';

export const CHILD_SYSTEM = `${SHARED}\n${CODER}\n${API_COMPLETE}`;

export type RunTaskDeps = {
  /** Shared document writer/reader (one per session). */
  doc: Doc;
  /** This writer's own cursor identity. */
  awarenessSource: AwarenessSource;
  runner: RunCodeToolOptions['runner'];
  /** Already-windowed document context the writer needs to see. */
  context: string;
  /** Verbatim text values available as `snippets.KEY` in the coder's JS execution context. */
  snippets?: Record<string, string>;
  params?: DocumentOpQueueParams;
  typingAnimations?: boolean;
  signal?: AbortSignal;
  onOps?: RunCodeToolOptions['onOps'];
};

/** One writer: carry out a single edit instruction via the `editor` surface. */
export async function runTask(
  s: Session,
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
    prompt: buildPrompt(task, deps.context, deps.snippets),
    tools: {
      runCode: createRunCodeTool({
        session: s,
        doc: deps.doc,
        awarenessSource: deps.awarenessSource,
        snippets: deps.snippets,
        params: deps.params,
        typingAnimations: deps.typingAnimations,
        runner: deps.runner,
        onOps: deps.onOps,
      }),
      reportBlocked: tool({
        description:
          'Call this instead of guessing when you cannot do the edit -- usually the context window is too narrow to see what you need. Include suggestedContext when you can identify the wider line range needed. Ends your task; do not also call runCode.',
        inputSchema: z.object({
          reason: z.string().describe('what stopped you, in one line'),
          suggestedContext: z
            .object({
              start_line: z
                .number()
                .int()
                .describe('first line of the wider document region needed'),
              end_line: z
                .number()
                .int()
                .describe('last line of the wider document region needed'),
            })
            .optional()
            .describe(
              'line range that would likely contain the missing ids or surrounding structure'
            ),
        }),
        execute: async () => 'acknowledged',
      }),
    },
    abortSignal: deps.signal,
  });
}

function buildPrompt(task: string, context: string, snippets?: Record<string, string>): string {
  const snippetBlock = snippets && Object.keys(snippets).length > 0
    ? [
        '\n\nSnippets (access as `snippets.KEY` in your code -- do NOT re-embed as string literals):',
        '```js',
        `const snippets = \n${JSON.stringify(snippets, null, 2)}`,
        '```',
      ].join('\n')
    : '';
  const contextBlock = `\n\nRelevant region of the document:\n<document>\n${context}\n</document>`;
  return `Carry out this edit task in full:\n${task}${snippetBlock}${contextBlock}`;
}
