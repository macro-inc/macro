import { tool } from 'ai';
import { z } from 'zod';
import type { LexicalSession } from '../ai-toolkit';
import type { AwarenessSource } from '../awareness';
import type { Doc } from '../doc';
import type { DocumentOp } from '../editor';
import type { DocumentOpQueueParams } from '../queue';
import { type CodeRunner, runEditorCode, type SnippetSource } from '../runtime';

export type RunCodeToolOptions = {
  session: LexicalSession;
  doc: Doc;
  awarenessSource: AwarenessSource;
  runner: CodeRunner;
  snippets?: SnippetSource;
  params?: DocumentOpQueueParams;
  typingAnimations?: boolean;
  sleep?: (ms: number) => Promise<void>;
  onOps?: (ops: DocumentOp[]) => void;
  /** Called when a runCode call begins executing (before snippets settle). */
  onRunCode?: () => void;
};

/** The writer's one tool: run a JS snippet against `editor`, returning compact
 *  success or error output. The snippet's only scope is
 *  `editor`; the system animates + applies the resulting ops live. */
export function createRunCodeTool(opts: RunCodeToolOptions) {
  return tool({
    description:
      "Run JS statements against `editor` (the ONLY in-scope value) to edit the document — e.g. `editor.convertToHeading('b3', 2); editor.bold('b5', 'word')`. Returns `ok`, or an error naming a bad id so you can retry.",
    inputSchema: z.object({ code: z.string() }),
    execute: async ({ code }) => {
      opts.onRunCode?.();
      const result = await runEditorCode({
        session: opts.session,
        doc: opts.doc,
        code,
        awarenessSource: opts.awarenessSource,
        snippets: opts.snippets,
        params: opts.params,
        typingAnimations: opts.typingAnimations,
        sleep: opts.sleep,
        runner: opts.runner,
        onOps: opts.onOps,
      });
      return result;
    },
  });
}
