import { tool } from 'ai';
import { z } from 'zod';
import type { Session } from '../ai-toolkit';
import type { AwarenessSource } from '../awareness/awareness-source';
import type { Doc } from '../doc/doc';
import type { DocumentOpQueueParams } from '../queue/document-op-queue';
import { type CodeRunner, runEditorCode } from '../runtime';
import type { DocumentOp } from '../editor/ops';

export type RunCodeToolOptions = {
  session: Session;
  doc: Doc;
  awarenessSource: AwarenessSource;
  params?: DocumentOpQueueParams;
  runner?: CodeRunner;
  onOps?: (ops: DocumentOp[]) => void;
};

/** The writer's one tool: run a JS snippet against `editor`, returning a per-op
 *  summary (or an error to self-correct from). The snippet's only scope is
 *  `editor`; the system animates + applies the resulting ops live. */
export function createRunCodeTool(opts: RunCodeToolOptions) {
  return tool({
    description:
      'Run JS statements against `editor` (the ONLY in-scope value) to edit the document — e.g. `editor.makeHeading(\'b3\', 2); editor.bold(\'b5\', \'word\')`. Returns a per-edit summary, or an error naming a bad id so you can retry.',
    inputSchema: z.object({ code: z.string() }),
    execute: async ({ code }) => {
      const result = await runEditorCode({
        session: opts.session,
        doc: opts.doc,
        code,
        awarenessSource: opts.awarenessSource,
        params: opts.params,
        runner: opts.runner,
        onOps: opts.onOps,
      });
      if (result.startsWith('error:')) console.log(`[runCode error] ${result}`);
      return result;
    },
  });
}
