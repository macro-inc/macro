import type { StepResult, ToolSet } from 'ai';
import type { UsageEntry } from './ai-editing/token-tracker';
import type { CoderRunCode, DispatchEditTrace } from './ai-editing/tools';

/** Raw inputs collected during a run, normalized into a TraceSession. */
export type TraceMeta = {
  sessionId: string;
  documentId: string;
  prompt: string;
  startedAt: Date;
  initialDocument?: string;
  intent?: string;
  /** Wall-clock duration of the interpreter pass, in ms. */
  interpretDurationMs?: number;
  /** Each coder's runCode calls, indexed by dispatch round then edit index. */
  coderCodeBlocks?: CoderRunCode[][][];
  /** Snippet + timing traces, indexed by dispatch round then edit index. */
  dispatchEditTraces?: DispatchEditTrace[][];
  /** Wall-clock duration of each supervisor step, in ms. */
  stepDurationsMs?: number[];
};

type Usage = UsageEntry[];

export type TraceToolCall = {
  toolName: string;
  input: unknown;
  output: unknown;
};

export type TraceStep = {
  text?: string;
  durationMs?: number;
  inputTokens: number;
  outputTokens: number;
  toolCalls: TraceToolCall[];
};

/** Structured, serializable record of an edit session — the stored source of
 * truth. Markdown is rendered from it on demand via renderTraceMarkdown. */
export type TraceSession = {
  version: 1;
  sessionId: string;
  documentId: string;
  prompt: string;
  startedAt: string;
  initialDocument?: string;
  intent?: string;
  interpretDurationMs?: number;
  steps: TraceStep[];
  usage: Usage;
  coderCodeBlocks?: CoderRunCode[][][];
  dispatchEditTraces?: DispatchEditTrace[][];
};

/** Normalize the AI SDK's rich step objects into the serializable session. */
export function buildTraceSession(
  meta: TraceMeta,
  steps: StepResult<ToolSet>[],
  usage: Usage
): TraceSession {
  return {
    version: 1,
    sessionId: meta.sessionId,
    documentId: meta.documentId,
    prompt: meta.prompt,
    startedAt: meta.startedAt.toISOString(),
    initialDocument: meta.initialDocument,
    intent: meta.intent,
    interpretDurationMs: meta.interpretDurationMs,
    steps: steps.map((step, i) => ({
      text: step.text || undefined,
      durationMs: meta.stepDurationsMs?.[i],
      inputTokens: step.usage.inputTokens ?? 0,
      outputTokens: step.usage.outputTokens ?? 0,
      toolCalls: step.toolCalls.map((call, j) => ({
        toolName: call.toolName,
        input: call.input,
        output: (step.toolResults?.[j] as { output?: unknown } | undefined)
          ?.output,
      })),
    })),
    usage,
    coderCodeBlocks: meta.coderCodeBlocks,
    dispatchEditTraces: meta.dispatchEditTraces,
  };
}

type TraceDispatchEdit = {
  editing_instruction: string;
  context?: { start_line: number; end_line: number };
};

/** Render an epoch-ms timestamp relative to the session start, e.g. `t+2.1s`. */
function relTime(ms: number | undefined, t0: number | undefined): string {
  if (ms == null || t0 == null) return '?';
  return `t+${((ms - t0) / 1000).toFixed(1)}s`;
}

function indented(text: string): string {
  return text
    .split('\n')
    .map((l) => `   ${l}`)
    .join('\n');
}

/** Step header timing, e.g. `· 0.9s · t+1.4s` (this step / cumulative). */
function formatTiming(durationMs?: number, elapsedMs?: number): string {
  const parts: string[] = [];
  if (durationMs != null) parts.push(`${(durationMs / 1000).toFixed(1)}s`);
  if (elapsedMs != null) parts.push(`t+${(elapsedMs / 1000).toFixed(1)}s`);
  return parts.length > 0 ? ` · ${parts.join(' · ')}` : '';
}

function formatEditEntry(
  edit: TraceDispatchEdit,
  index: number,
  codes: CoderRunCode[] | undefined,
  trace: DispatchEditTrace | undefined,
  t0: number | undefined
): string {
  const range = edit.context
    ? ` [lines ${edit.context.start_line}-${edit.context.end_line}]`
    : '';
  const parts: string[] = [`${index + 1}. ${edit.editing_instruction}${range}`];

  if (trace) {
    const runCodes = trace.runCodeAt.map((ms) => relTime(ms, t0)).join(', ');
    // `streamed` = the coder launched from the streaming dispatch args,
    // before the supervisor finished writing the batch.
    const streamed = trace.streamedAt != null ? ' · streamed' : '';
    parts.push(
      `   coder ${relTime(trace.coderStartedAt, t0)} → ${relTime(trace.coderFinishedAt, t0)}${streamed}${runCodes ? ` · runCode at ${runCodes}` : ''}`
    );
  }

  if (codes && codes.length > 0) {
    for (const call of codes) {
      parts.push(`\n   \`\`\`js\n${indented(call.code)}\n   \`\`\``);
      for (const [key, value] of Object.entries(call.snippets ?? {})) {
        parts.push(
          `   snippets.${key}:\n   \`\`\`\n${indented(value)}\n   \`\`\``
        );
      }
    }
  }

  return parts.join('\n');
}

function formatDispatchInput(
  args: { edits: TraceDispatchEdit[] },
  codesPerEdit: CoderRunCode[][] | undefined,
  editTraces: DispatchEditTrace[] | undefined,
  t0: number | undefined
): string {
  // A malformed supervisor tool call can land `edits` as a raw string (the model
  // emitting `<parameter …>` markup instead of a JSON array). Render it verbatim
  // rather than crashing the whole trace.
  if (!Array.isArray(args.edits)) {
    return indented(
      `⚠ malformed dispatch args (edits is ${typeof args.edits}, not an array):\n${String(args.edits)}`
    );
  }
  return args.edits
    .map((e, i) =>
      formatEditEntry(e, i, codesPerEdit?.[i], editTraces?.[i], t0)
    )
    .join('\n');
}

function formatDispatchOutput(output: unknown): string[] {
  const res = String(output);
  const docStart = res.indexOf('<document>');
  const docEnd = res.indexOf('</document>');
  const lines: string[] = [];

  const summary = docStart !== -1 ? res.slice(0, docStart).trim() : res.trim();
  if (summary) lines.push('', '**result:**', summary);

  if (docStart !== -1 && docEnd !== -1) {
    lines.push(
      '',
      '**document after:**',
      '```xml',
      res.slice(docStart + '<document>'.length, docEnd).trim(),
      '```'
    );
  }

  return lines;
}

function formatToolCall(
  call: TraceToolCall,
  codesPerEdit?: CoderRunCode[][],
  editTraces?: DispatchEditTrace[],
  t0?: number
): string {
  const { output } = call;
  const lines: string[] = [];

  if (call.toolName === 'dispatch') {
    const { edits } = call.input as { edits: TraceDispatchEdit[] };
    lines.push(
      `**dispatch** — ${Array.isArray(edits) ? `${edits.length} edit(s)` : '⚠ malformed'}`
    );
    lines.push(
      '',
      formatDispatchInput({ edits }, codesPerEdit, editTraces, t0)
    );
    if (output != null) lines.push(...formatDispatchOutput(output));
  } else if (call.toolName === 'readDocument') {
    lines.push('**readDocument**');
    if (output != null) lines.push('', '```xml', String(output).trim(), '```');
  } else {
    lines.push(
      `**${call.toolName}**`,
      '```json',
      JSON.stringify(call.input, null, 2),
      '```'
    );
    if (output != null)
      lines.push('', '**result:**', String(output).slice(0, 400));
  }

  return lines.join('\n');
}

function formatStep(
  step: TraceStep,
  index: number,
  elapsedMs: number | undefined,
  dispatchRound: number,
  coderCodeBlocks: CoderRunCode[][][] | undefined,
  dispatchEditTraces: DispatchEditTrace[][] | undefined,
  t0: number | undefined
): { rendered: string; nextDispatchRound: number } {
  const lines: string[] = [
    `### Step ${index + 1}${formatTiming(step.durationMs, elapsedMs)}`,
  ];

  if (step.text) lines.push('', step.text.trim());

  let round = dispatchRound;
  for (const call of step.toolCalls) {
    const callRound = call.toolName === 'dispatch' ? round++ : undefined;
    lines.push(
      '',
      formatToolCall(
        call,
        callRound == null ? undefined : coderCodeBlocks?.[callRound],
        callRound == null ? undefined : dispatchEditTraces?.[callRound],
        t0
      )
    );
  }

  lines.push(
    '',
    `*${step.inputTokens.toLocaleString()} in / ${step.outputTokens.toLocaleString()} out*`
  );

  return { rendered: lines.join('\n'), nextDispatchRound: round };
}

/** Render the stored session into the human-readable markdown trace. */
export function renderTraceMarkdown(session: TraceSession): string {
  const sections: string[] = [
    '# AI Edit Trace',
    `- **document:** ${session.documentId}`,
    `- **timestamp:** ${session.startedAt}`,
    `- **prompt:** ${session.prompt}`,
  ];

  if (session.initialDocument) {
    sections.push(
      '',
      '**document before:**',
      '```xml',
      session.initialDocument,
      '```'
    );
  }

  if (session.intent) {
    sections.push(
      '',
      '---',
      '',
      `## Interpreter${formatTiming(session.interpretDurationMs)}`,
      '',
      session.intent
    );
  }

  sections.push('', '---', '', '## Supervisor');

  const t0 = Date.parse(session.startedAt);
  const t0OrUndefined = Number.isNaN(t0) ? undefined : t0;
  let elapsedMs = 0;
  let sawDuration = false;
  let dispatchRound = 0;
  for (let i = 0; i < session.steps.length; i++) {
    const step = session.steps[i]!;
    if (step.durationMs != null) {
      elapsedMs += step.durationMs;
      sawDuration = true;
    }
    const { rendered, nextDispatchRound } = formatStep(
      step,
      i,
      sawDuration ? elapsedMs : undefined,
      dispatchRound,
      session.coderCodeBlocks,
      session.dispatchEditTraces,
      t0OrUndefined
    );
    sections.push('', rendered);
    dispatchRound = nextDispatchRound;
  }

  sections.push(
    '',
    '---',
    '',
    '## Usage',
    '| model | input | output |',
    '|---|---|---|'
  );
  for (const u of session.usage) {
    sections.push(
      `| ${u.model} | ${u.inputTokens.toLocaleString()} | ${u.outputTokens.toLocaleString()} |`
    );
  }

  return sections.join('\n');
}
