import { type LanguageModel, tool } from 'ai';
import { z } from 'zod';
import type { coder } from '../agents';
import type { snippet } from '../agents/snippet';
import type { LexicalSession } from '../ai-toolkit';
import type { AwarenessSource } from '../awareness';
import type { Doc } from '../doc';
import type { DocumentOpQueueParams } from '../queue';
import type { SnippetSource } from '../runtime';
import type { TokenTracker } from '../token-tracker';
import { numberLines, serializeWithXml } from '../utils';
import type { RunCodeToolOptions } from './run-code';
import {
  launchSnippetSpecs,
  SnippetSpecsSchema,
  type SnippetTraceEntry,
} from './snippets';

export type { UsageEntry } from '../token-tracker';
export { TokenTracker } from '../token-tracker';

type BlockedReport = {
  message: string;
};
type ContextRange = {
  startLine: number;
  endLine: number;
  rootIds: string[];
  ids: string[];
  source: 'ids' | 'full-document';
};

const ID_PATTERN = /[A-Za-z0-9_~-]{6,}/g;
const BLOCK_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'blockquote',
  'li',
  'table',
  'ul',
  'ol',
]);
const CONTAINER_TAGS = new Set(['table', 'ul', 'ol']);

type XmlNodeRange = {
  tag: string;
  id: string;
  startLine: number;
  endLine: number;
  ancestors: XmlNodeRange[];
};

/** Pull a writer'session `reportBlocked` payload out of its run, if it bailed. */
function findBlocked(
  res: Awaited<ReturnType<typeof coder>>
): BlockedReport | null {
  for (const step of res.steps) {
    for (const call of step.toolCalls) {
      if (call.toolName === 'reportBlocked') return call.input as BlockedReport;
    }
  }
  return null;
}

export function mergeRanges(
  ranges: Array<[number, number]>
): Array<[number, number]> {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1] + 1) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
}

export function indexXmlRanges(xml: string): {
  lines: string[];
  byId: Map<string, XmlNodeRange>;
} {
  const lines = xml.split('\n');
  const byId = new Map<string, XmlNodeRange>();
  const stack: XmlNodeRange[] = [];
  const tagPattern = /<\/?([A-Za-z][A-Za-z0-9_-]*)([^>]*)>/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    tagPattern.lastIndex = 0;
    for (
      let match = tagPattern.exec(line);
      match !== null;
      match = tagPattern.exec(line)
    ) {
      const [raw, tag, attrs] = match;
      if (raw.startsWith('</')) {
        for (let j = stack.length - 1; j >= 0; j--) {
          const node = stack[j]!;
          stack.pop();
          node.endLine = i + 1;
          if (node.tag === tag) break;
        }
        continue;
      }

      const id = attrs.match(/\bid="([^"]+)"/)?.[1];
      const selfClosing = raw.endsWith('/>');
      if (!id) continue;

      const node: XmlNodeRange = {
        tag,
        id,
        startLine: i + 1,
        endLine: i + 1,
        ancestors: [...stack],
      };
      byId.set(id, node);
      if (!selfClosing) stack.push(node);
    }
  }

  for (const node of stack) node.endLine = lines.length;
  return { lines, byId };
}

function containingRoot(node: XmlNodeRange): XmlNodeRange {
  const lineage = [...node.ancestors, node];
  for (let i = lineage.length - 1; i >= 0; i--) {
    const current = lineage[i]!;
    if (CONTAINER_TAGS.has(current.tag)) return current;
  }
  for (let i = lineage.length - 1; i >= 0; i--) {
    const current = lineage[i]!;
    if (BLOCK_TAGS.has(current.tag)) return current;
  }
  return node;
}

export function computeContextRange(
  xml: string,
  instruction: string
): ContextRange {
  const { lines, byId } = indexXmlRanges(xml);
  const ids = [...new Set(instruction.match(ID_PATTERN) ?? [])].filter((id) =>
    byId.has(id)
  );
  if (ids.length > 0) {
    const roots = ids.map((id) => containingRoot(byId.get(id)!));
    const ranges = mergeRanges(
      roots.map((root) => [root.startLine, root.endLine])
    );
    return {
      startLine: ranges[0]![0],
      endLine: ranges[ranges.length - 1]![1],
      rootIds: [...new Set(roots.map((root) => root.id))],
      ids,
      source: 'ids',
    };
  }
  return {
    startLine: 1,
    endLine: lines.length,
    rootIds: [],
    ids,
    source: 'full-document',
  };
}

/** Lines of context to show a writer around its target region. Generous on
 *  purpose: a roomy window means the writer rarely has to call `readDocument`. */
const MIN_WINDOW_LINES = 20;

function xmlWindow(
  xml: string,
  range: ContextRange,
  padding = 2,
  minLines = MIN_WINDOW_LINES
): string {
  const numbered = numberLines(xml).split('\n');
  let lo = Math.max(0, range.startLine - 1 - padding);
  let hi = Math.min(numbered.length - 1, range.endLine - 1 + padding);
  // Grow symmetrically until we show at least `minLines` (or hit the doc edges).
  while (hi - lo + 1 < minLines && (lo > 0 || hi < numbered.length - 1)) {
    if (lo > 0) lo--;
    if (hi < numbered.length - 1) hi++;
  }
  return numbered.slice(lo, hi + 1).join('\n');
}

export type Writer = {
  doc: Doc;
  awarenessSource: AwarenessSource;
  release: () => void;
};

/** Per-edit timing recorded by dispatch: the snippet windows, the writer's
 *  window, and when each of its `runCode` calls executed. Comparing a
 *  snippet's `resolvedAt` with the first `runCodeAt` shows whether the settle
 *  point actually waited or generation was fully masked by codegen. */
export type DispatchEditTrace = {
  snippets: SnippetTraceEntry[];
  coderStartedAt: number;
  coderFinishedAt: number;
  runCodeAt: number[];
};

export type DispatchToolOptions = {
  session: LexicalSession;
  childModel: LanguageModel;
  snippetModel: LanguageModel;
  /** Stronger composition model used for `effort: "high"` snippet specs. */
  snippetHighModel: LanguageModel;
  tracker: TokenTracker;
  runSnippet: typeof snippet;
  runner: RunCodeToolOptions['runner'];
  params?: DocumentOpQueueParams;
  typingAnimations?: boolean;
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
  makeWriter: () => Promise<Writer>;
  runTask: typeof coder;
  serialize?: (session: LexicalSession) => string;
  onOps?: RunCodeToolOptions['onOps'];
  /** Called after each dispatch batch with the JS code blocks run by each coder. */
  onCoderResult?: (codes: string[][]) => void;
  /** Called after each dispatch batch with per-edit snippet + timing traces. */
  onEditTrace?: (edits: DispatchEditTrace[]) => void;
};

export function createDispatchTool(opts: DispatchToolOptions) {
  const {
    session,
    childModel,
    snippetModel,
    snippetHighModel,
    tracker,
    runSnippet,
    params,
    typingAnimations,
    sleep,
    signal,
    makeWriter,
    runTask,
    runner,
    onOps,
    onCoderResult,
    onEditTrace,
  } = opts;
  const serialize = opts.serialize ?? serializeWithXml;
  return tool({
    description:
      'spawn a writer to carry out an edit instruction on the document',
    inputSchema: z.object({
      edits: z
        .array(
          z.object({
            editing_instruction: z
              .string()
              .describe('mechanical changes you want applied to the document'),
            snippets: z
              .record(z.string(), z.string())
              .optional()
              .describe(
                'verbatim text values injected as a `snippets` JS object the coder can use directly. all verbatim text goes here, so that the writer can paste it in'
              ),
            snippet_specs: SnippetSpecsSchema.optional().describe(
              'content to be composed by a snippet writer while your writer works: key → brief (what to write, tone, expected shape/length), or `{ brief, effort: "high" }` to route to the stronger composition model. the writer references it as `snippets.KEY` like any verbatim snippet'
            ),
          })
        )
        .describe('edit instructions to run as one parallel batch'),
    }),
    execute: async ({ edits }) => {
      const xml = serializeWithXml(session);
      const contexts = edits.map((e) =>
        computeContextRange(xml, e.editing_instruction)
      );
      const editTraces: DispatchEditTrace[] = [];
      // Writers run concurrently (distinct cursors); each applies its own ops
      // serially via editor.update, so the shared session never tears.
      const results = await Promise.all(
        edits.map(
          async ({ editing_instruction, snippets, snippet_specs }, i) => {
            const context = xmlWindow(xml, contexts[i]!);
            const { pending, traces: snippetTraces } = launchSnippetSpecs({
              specs: snippet_specs,
              context,
              snippetModel,
              snippetHighModel,
              tracker,
              runSnippet,
              signal,
            });
            const merged: SnippetSource = { ...snippets, ...pending };
            const trace: DispatchEditTrace = {
              snippets: snippetTraces,
              coderStartedAt: Date.now(),
              coderFinishedAt: 0,
              runCodeAt: [],
            };
            editTraces[i] = trace;
            const writer = await makeWriter();
            const { doc, awarenessSource } = writer;
            try {
              return await runTask(session, editing_instruction, childModel, {
                doc,
                awarenessSource,
                context,
                snippets: merged,
                params,
                typingAnimations,
                sleep,
                signal,
                runner,
                onOps,
                onRunCode: () => trace.runCodeAt.push(Date.now()),
              });
            } finally {
              trace.coderFinishedAt = Date.now();
              writer.release();
            }
          }
        )
      );
      onEditTrace?.(editTraces);
      const summaries = results.map((res, i) => {
        tracker.add(childModel as { modelId: string }, res.totalUsage);
        const blocked = findBlocked(res);
        if (blocked) {
          return `${i + 1}. ⚠ BLOCKED -- ${blocked.message}.`;
        }
        return `${i + 1}. ✓ APPLIED`;
      });
      if (onCoderResult) {
        const codes = results.map((res) =>
          res.steps
            .flatMap((step) => step.toolCalls)
            .filter((call) => call.toolName === 'runCode')
            .map((call) => (call.input as { code: string }).code)
        );
        onCoderResult(codes);
      }
      return `${summaries.join('\n')}\n\n<document>\n${serialize(session)}\n</document>`;
    },
  });
}
