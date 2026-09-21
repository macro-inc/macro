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

/**
 * One snippet as the model sends it. Snippets are a LIST of pairs rather than a
 * `{ KEY: text }` object because Gemini's function declarations are an OpenAPI
 * subset with no `additionalProperties`, and the AI SDK's Google provider drops
 * that field when converting the schema — a record reaches Gemini as an object
 * with no fields, and it sends `{}` while its code references `snippets.KEY`.
 * Pairs survive the conversion on every provider we use, so there is one shape
 * for every agent; the sandbox still sees the record the code indexes into.
 *
 * `text` also accepts a list of strings: coders routinely send an array when
 * composing list content, and a strict string schema rejected 45 such calls
 * across the prod corpus, each costing the coder its whole step.
 */
const SnippetPairSchema = z.object({
  key: z.string().describe('the name referenced as `snippets.KEY` in code'),
  text: z
    .union([z.string(), z.array(z.string())])
    .describe('the exact text, unescaped; a list of strings for list content'),
});
export type SnippetPair = z.infer<typeof SnippetPairSchema>;

const SnippetsSchema = z
  .array(SnippetPairSchema)
  .optional()
  .describe(
    'all text content your code inserts, as a list of { key, text } pairs. reference each as `snippets.KEY` in `code` instead of embedding it as a string literal (avoids escaping errors).'
  );

/** The record the sandbox exposes as `snippets`; list values join with newlines
 *  since every editor primitive takes text, which is what the coder meant. */
export function snippetsToRecord(
  snippets: SnippetPair[] | undefined
): Record<string, string> | undefined {
  if (!snippets) return undefined;
  return Object.fromEntries(
    snippets.map(({ key, text }) => [
      key,
      Array.isArray(text) ? text.join('\n') : (text ?? ''),
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
      snippets: SnippetsSchema,
    }),
    execute: async ({ code, snippets }) => {
      const flattened = snippetsToRecord(snippets);
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
