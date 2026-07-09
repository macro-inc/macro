import type { StepResult, ToolSet } from 'ai';
import type { UsageEntry } from './ai-editing/token-tracker';
import type { DispatchEditTrace } from './ai-editing/tools';

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
  /** JS code blocks run by each coder, indexed by dispatch round then edit index. */
  coderCodeBlocks?: string[][][];
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
  coderCodeBlocks?: string[][][];
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
  snippets?: Record<string, string>;
  snippet_specs?: Record<string, string | { brief: string; effort?: string }>;
};

/** Render an epoch-ms timestamp relative to the session start, e.g. `t+2.1s`. */
function relTime(ms: number | undefined, t0: number | undefined): string {
  if (ms == null || t0 == null) return '?';
  return `t+${((ms - t0) / 1000).toFixed(1)}s`;
}

function formatDispatchArgs(
  args: { edits: TraceDispatchEdit[] },
  codesPerEdit?: string[][],
  editTraces?: DispatchEditTrace[],
  t0?: number
): string {
  return args.edits
    .map((e, i) => {
      const range = e.context
        ? ` [lines ${e.context.start_line}-${e.context.end_line}]`
        : '';
      let out = `${i + 1}. ${e.editing_instruction}${range}`;
      if (e.snippets && Object.keys(e.snippets).length > 0) {
        for (const [key, value] of Object.entries(e.snippets)) {
          const text =
            typeof value === 'string' ? value : JSON.stringify(value, null, 2);
          out += `\n   snippets.${key}:\n   \`\`\`\n${text
            .split('\n')
            .map((l) => `   ${l}`)
            .join('\n')}\n   \`\`\``;
        }
      }
      if (e.snippet_specs && Object.keys(e.snippet_specs).length > 0) {
        for (const [key, spec] of Object.entries(e.snippet_specs)) {
          const brief = typeof spec === 'string' ? spec : spec.brief;
          const effort = typeof spec === 'string' ? undefined : spec.effort;
          out += `\n   snippet_specs.${key}${effort === 'high' ? ' [high]' : ''}: ${brief}`;
        }
      }
      const trace = editTraces?.[i];
      if (trace) {
        for (const s of trace.snippets) {
          const window = `${relTime(s.startedAt, t0)} → ${
            s.resolvedAt == null ? 'unresolved' : relTime(s.resolvedAt, t0)
          }`;
          out += `\n   snippet ${s.key}${s.effort === 'high' ? ' · high' : ''} · ${window}${s.error ? ` · ⚠ ${s.error}` : ''}`;
          if (s.text) {
            out += `\n   \`\`\`\n${s.text
              .split('\n')
              .map((l) => `   ${l}`)
              .join('\n')}\n   \`\`\``;
          }
        }
        const runCodes = trace.runCodeAt
          .map((ms) => relTime(ms, t0))
          .join(', ');
        out += `\n   coder ${relTime(trace.coderStartedAt, t0)} → ${relTime(trace.coderFinishedAt, t0)}${runCodes ? ` · runCode at ${runCodes}` : ''}`;
      }
      const codes = codesPerEdit?.[i];
      if (codes && codes.length > 0) {
        for (const code of codes) {
          out += `\n\n   \`\`\`js\n${code
            .split('\n')
            .map((l) => `   ${l}`)
            .join('\n')}\n   \`\`\``;
        }
      }
      return out;
    })
    .join('\n');
}

function formatToolCall(
  call: TraceToolCall,
  codesPerEdit?: string[][],
  editTraces?: DispatchEditTrace[],
  t0?: number
): string {
  const lines: string[] = [];
  const { output } = call;

  if (call.toolName === 'dispatch') {
    const input = call.input as { edits?: TraceDispatchEdit[] };
    const edits = Array.isArray(input.edits) ? input.edits : [];
    lines.push(`**dispatch** — ${edits.length} edit(s)`);
    if (edits.length === 0 && input.edits == null) {
      lines.push('```json');
      lines.push(JSON.stringify(call.input, null, 2));
      lines.push('```');
    } else {
      lines.push('');
      lines.push(formatDispatchArgs({ edits }, codesPerEdit, editTraces, t0));
    }
    if (output != null) {
      const res = String(output);
      const docStart = res.indexOf('<document>');
      const docEnd = res.indexOf('</document>');
      const summary =
        docStart !== -1 ? res.slice(0, docStart).trim() : res.trim();
      if (summary) {
        lines.push('');
        lines.push('**result:**');
        lines.push(summary);
      }
      if (docStart !== -1 && docEnd !== -1) {
        lines.push('');
        lines.push('**document after:**');
        lines.push('```xml');
        lines.push(res.slice(docStart + '<document>'.length, docEnd).trim());
        lines.push('```');
      }
    }
  } else if (call.toolName === 'readDocument') {
    lines.push(`**readDocument**`);
    if (output != null) {
      lines.push('');
      lines.push('```xml');
      lines.push(String(output).trim());
      lines.push('```');
    }
  } else {
    lines.push(`**${call.toolName}**`);
    lines.push('```json');
    lines.push(JSON.stringify(call.input, null, 2));
    lines.push('```');
    if (output != null) {
      lines.push('');
      lines.push('**result:**');
      lines.push(String(output).slice(0, 400));
    }
  }

  return lines.join('\n');
}

/** Step header timing, e.g. `· 0.9s · t+1.4s` (this step / cumulative). */
function formatTiming(durationMs?: number, elapsedMs?: number): string {
  const parts: string[] = [];
  if (durationMs != null) parts.push(`${(durationMs / 1000).toFixed(1)}s`);
  if (elapsedMs != null) parts.push(`t+${(elapsedMs / 1000).toFixed(1)}s`);
  return parts.length > 0 ? ` · ${parts.join(' · ')}` : '';
}

function formatStep(
  step: TraceStep,
  i: number,
  elapsedMs: number | undefined,
  dispatchRoundRef: { current: number },
  coderCodeBlocks?: string[][][],
  dispatchEditTraces?: DispatchEditTrace[][],
  t0?: number
): string {
  const lines: string[] = [
    `### Step ${i + 1}${formatTiming(step.durationMs, elapsedMs)}`,
  ];

  if (step.text) {
    lines.push('');
    lines.push(step.text.trim());
  }

  for (const call of step.toolCalls) {
    const round =
      call.toolName === 'dispatch' ? dispatchRoundRef.current++ : undefined;
    const codesPerEdit = round == null ? undefined : coderCodeBlocks?.[round];
    const editTraces = round == null ? undefined : dispatchEditTraces?.[round];
    lines.push('');
    lines.push(formatToolCall(call, codesPerEdit, editTraces, t0));
  }

  lines.push('');
  lines.push(
    `*${step.inputTokens.toLocaleString()} in / ${step.outputTokens.toLocaleString()} out*`
  );

  return lines.join('\n');
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

  const dispatchRoundRef = { current: 0 };
  const t0 = Date.parse(session.startedAt);
  let elapsedMs = 0;
  let sawDuration = false;
  for (let i = 0; i < session.steps.length; i++) {
    const step = session.steps[i]!;
    if (step.durationMs != null) {
      elapsedMs += step.durationMs;
      sawDuration = true;
    }
    sections.push('');
    sections.push(
      formatStep(
        step,
        i,
        sawDuration ? elapsedMs : undefined,
        dispatchRoundRef,
        session.coderCodeBlocks,
        session.dispatchEditTraces,
        Number.isNaN(t0) ? undefined : t0
      )
    );
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
