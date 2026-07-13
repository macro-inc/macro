import { type LanguageModel, tool } from 'ai';
import { z } from 'zod';
import type { coder } from '../agents';
import type { LexicalSession } from '../ai-toolkit';
import type { AwarenessSource } from '../awareness';
import type { Doc } from '../doc';
import type { DocumentOpQueueParams } from '../queue';
import type { TokenTracker } from '../token-tracker';
import { numberLines, serializeWithXml } from '../utils';
import type { RunCodeToolOptions } from './run-code';

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

/** Per-edit timing recorded by dispatch: the writer's window and when each of
 *  its `runCode` calls executed. */
export type DispatchEditTrace = {
  /** Set when this edit was launched from onInputAvailable, before execute ran.
   *  Epoch ms. */
  streamedAt?: number;
  coderStartedAt: number;
  coderFinishedAt: number;
  runCodeAt: number[];
};

/** One runCode invocation as recorded for the trace: the code plus any content
 *  the writer composed and passed alongside it. */
export type CoderRunCode = { code: string; snippets?: Record<string, string> };

export type DispatchToolOptions = {
  session: LexicalSession;
  /** Called once per dispatched coder so each gets its own model with private
   *  fallback state, instead of racing a shared instance. */
  makeChildModel: () => LanguageModel;
  tracker: TokenTracker;
  /** The user's original edit request, shown to every writer for tone/intent. */
  request?: string;
  runner: RunCodeToolOptions['runner'];
  params?: DocumentOpQueueParams;
  typingAnimations?: boolean;
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
  makeWriter: () => Promise<Writer>;
  runTask: typeof coder;
  serialize?: (session: LexicalSession) => string;
  onOps?: RunCodeToolOptions['onOps'];
  /** Called after each dispatch call with the coder's runCode calls. */
  onCoderResult?: (codes: CoderRunCode[]) => void;
  /** Called after each dispatch call with the edit's timing trace. */
  onEditTrace?: (edit: DispatchEditTrace) => void;
};

export const DispatchEditSchema = z.object({
  editing_instruction: z
    .string()
    .describe(
      'the changes you want applied to the document. writers see the user request and compose content themselves — describe the structural change and any shape/length constraints; include exact strings (quotes, ids, user-supplied text) verbatim when the writer must use them character-for-character'
    ),
});

export type DispatchEdit = z.infer<typeof DispatchEditSchema>;

export function createDispatchTool(opts: DispatchToolOptions) {
  const {
    session,
    makeChildModel,
    tracker,
    request,
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

  type CoderRun = Awaited<ReturnType<typeof runTask>>;
  type EditRun = {
    run: Promise<CoderRun>;
    trace: DispatchEditTrace;
    /** This coder's own model, kept for usage attribution after it finishes. */
    model: LanguageModel;
  };
  // Coders already started from onInputAvailable, keyed by tool call id.
  const calls = new Map<string, EditRun>();

  async function runEdit(
    edit: DispatchEdit,
    trace: DispatchEditTrace,
    childModel: LanguageModel
  ): Promise<CoderRun> {
    // Serialized at launch time so an edit launched early sees whatever earlier
    // coders have already applied.
    const xml = serializeWithXml(session);
    const context = xmlWindow(
      xml,
      computeContextRange(xml, edit.editing_instruction)
    );
    const writer = await makeWriter();
    const { doc, awarenessSource } = writer;
    try {
      return await runTask(session, edit.editing_instruction, childModel, {
        doc,
        awarenessSource,
        context,
        request,
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

  /** Start the edit if it isn't already running; return its run either way. */
  function ensureLaunched(
    toolCallId: string,
    edit: DispatchEdit,
    streamed: boolean
  ): EditRun {
    const existing = calls.get(toolCallId);
    if (existing) return existing;
    const trace: DispatchEditTrace = {
      streamedAt: streamed ? Date.now() : undefined,
      coderStartedAt: Date.now(),
      coderFinishedAt: 0,
      runCodeAt: [],
    };
    const model = makeChildModel();
    const entry: EditRun = { run: runEdit(edit, trace, model), trace, model };
    // A streamed run can reject before `execute` awaits it; keep that rejection
    // for the join instead of letting it escape as an unhandled rejection.
    entry.run.catch(() => {});
    calls.set(toolCallId, entry);
    return entry;
  }

  return {
    tool: tool({
      description:
        'spawn a writer for one edit instruction; call in parallel for independent edits',
      inputSchema: DispatchEditSchema,
      onInputAvailable: ({ input, toolCallId }) => {
        ensureLaunched(toolCallId, input, true);
      },
      execute: async (edit, { toolCallId }) => {
        const entry = ensureLaunched(toolCallId, edit, false);
        calls.delete(toolCallId);
        const result = await entry.run;
        onEditTrace?.(entry.trace);
        tracker.add(entry.model as { modelId: string }, result.totalUsage);
        const blocked = findBlocked(result);
        const summary = blocked
          ? `⚠ BLOCKED -- ${blocked.message}.`
          : `✓ APPLIED`;
        if (onCoderResult) {
          const codes = result.steps
            .flatMap((step) => step.toolCalls)
            .filter((call) => call.toolName === 'runCode')
            .map((call) => {
              const { code, snippets } = call.input as CoderRunCode;
              return { code, snippets };
            });
          onCoderResult(codes);
        }
        return `${summary}\n\n<document>\n${serialize(session)}\n</document>`;
      },
    }),
  };
}

export type DispatchTool = ReturnType<typeof createDispatchTool>;
