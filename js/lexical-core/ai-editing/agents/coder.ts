import SHARED from '../prompts/SHARED.md';
import CODER from '../prompts/CODER.md';
import API from '../prompts/API.md';
import { type LanguageModel, generateText, stepCountIs } from 'ai';
import { type Session } from '../ai-toolkit';
import type { AwarenessSource } from '../awareness/awareness-source';
import type { Doc } from '../doc/doc';
import type { DocumentOpQueueParams } from '../queue/document-op-queue';
import { serializeWithXml } from '../utils';
import { createRunCodeTool, type RunCodeToolOptions } from '../tools/run-code';

export const CHILD_SYSTEM = `${SHARED}\n${CODER}\n${API}`;

export type RunTaskDeps = {
  /** Shared document writer/reader (one per session). */
  doc: Doc;
  /** This writer's own cursor identity. */
  awarenessSource: AwarenessSource;
  params?: DocumentOpQueueParams;
  signal?: AbortSignal;
  runner?: RunCodeToolOptions['runner'];
  onOps?: RunCodeToolOptions['onOps'];
};

/** One writer: carry out a single edit instruction via the `editor` surface. */
export async function runTask(s: Session, task: string, model: LanguageModel, deps: RunTaskDeps) {
  const context = `\n\n<document>\n${serializeWithXml(s)}\n</document>`;
  return generateText({
    model,
    stopWhen: stepCountIs(5),
    system: CHILD_SYSTEM,
    prompt: `Make this single edit:\n${task}${context}`,
    tools: {
      runCode: createRunCodeTool({
        session: s,
        doc: deps.doc,
        awarenessSource: deps.awarenessSource,
        params: deps.params,
        runner: deps.runner,
        onOps: deps.onOps,
      }),
    },
    abortSignal: deps.signal,
  });
}
