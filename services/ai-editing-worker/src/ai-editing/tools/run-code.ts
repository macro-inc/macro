import { type Span, Telemetry } from '@macro-inc/observability';
import { tool } from 'ai';
import { z } from 'zod';
import type { LexicalSession } from '../ai-toolkit';
import type { AwarenessSource } from '../awareness';
import type { Doc } from '../doc';
import type { DocumentOp } from '../editor';
import type { DocumentOpQueueParams } from '../queue';
import { type CodeRunner, runEditorCode } from '../runtime';

export type RunCodeToolOptions = {
  session: LexicalSession;
  doc: Doc;
  awarenessSource: AwarenessSource;
  runner: CodeRunner;
  params?: DocumentOpQueueParams;
  typingAnimations?: boolean;
  sleep?: (ms: number) => Promise<void>;
  onOps?: (ops: DocumentOp[]) => void;
  /** Called when a runCode call begins executing. */
  onRunCode?: (snippets?: Record<string, string>) => void;
  /** Parent for the per-call `edit.run_code` span (the dispatch span). */
  span?: Span;
  /** Called with the reply the coder receives. Recorded in the trace so a run
   *  can be diagnosed after the fact: without it, the trace shows the code a
   *  coder wrote but not what it was told, which is precisely the signal needed
   *  to explain why it retried. */
  onRunCodeResult?: (result: string) => void;
};

/** Collapse array snippet values to newline-joined text.
 *
 *  The sandbox exposes `snippets` as a plain object of strings, and every
 *  editor primitive takes text, so joining is what the coder wanted anyway when
 *  it passed a list. */
function flattenSnippets(
  snippets: Record<string, string | string[]> | undefined
): Record<string, string> | undefined {
  if (!snippets) return undefined;
  return Object.fromEntries(
    Object.entries(snippets).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.join('\n') : value,
    ])
  );
}

/** The writer's one tool: run a JS snippet against `editor`, returning compact
 *  success or error output. The snippet's only scope is
 *  `editor` and `snippets`; the system animates + applies the resulting ops live. */
export function createRunCodeTool(opts: RunCodeToolOptions) {
  return tool({
    description:
      "Run JS statements against `editor` (the ONLY in-scope value besides `snippets`) to edit the document — e.g. `editor.convertToHeading('b3', 2); editor.bold('b5', 'word')`. Returns `ok`, or an error naming a bad id so you can retry.",
    inputSchema: z.object({
      code: z.string(),
      snippets: z
        .record(
          z.string(),
          // Coders routinely send an array when composing a list. A strict
          // string-only record rejected those calls, and the coder's only
          // recourse was to retry the whole step — 45 such retries across the
          // prod corpus. Accept the shape it actually produces.
          z.union([z.string(), z.array(z.string())])
        )
        .optional()
        .describe(
          'all text content your code inserts: key -> exact content. reference each as `snippets.KEY` in `code` instead of embedding it as a string literal (avoids escaping errors). a value may be an array of strings for list content.'
        ),
    }),
    execute: async ({ code, snippets }) => {
      const flattened = flattenSnippets(snippets);
      opts.onRunCode?.(flattened);
      const span = opts.span
        ? opts.span.span('edit.run_code')
        : Telemetry.span('edit.run_code');
      span.setAttr('code.bytes', code.length);
      span.setAttr('snippets.count', Object.keys(snippets ?? {}).length);
      try {
        const result = await runEditorCode({
          session: opts.session,
          doc: opts.doc,
          code,
          awarenessSource: opts.awarenessSource,
          snippets: flattened,
          params: opts.params,
          typingAnimations: opts.typingAnimations,
          sleep: opts.sleep,
          runner: opts.runner,
          onOps: opts.onOps,
          span,
        });
        opts.onRunCodeResult?.(result);
        span.setAttr('result', result.startsWith('error:') ? 'error' : 'ok');
        return result;
      } catch (e) {
        span.error(e);
        throw e;
      } finally {
        span.end();
      }
    },
  });
}
