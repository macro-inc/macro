import type { StepResult, ToolSet } from 'ai';
import type { UsageEntry } from './ai-editing/token-tracker';

export type TraceMeta = {
  documentId: string;
  prompt: string;
  startedAt: Date;
  initialDocument?: string;
  intent?: string;
  /** JS code blocks run by each coder, indexed by dispatch round then edit index. */
  coderCodeBlocks?: string[][][];
  /** Wall-clock duration of each supervisor step, in ms. */
  stepDurationsMs?: number[];
};

type Usage = UsageEntry[];

function formatDispatchArgs(
  args: {
    edits: Array<{
      editing_instruction: string;
      context?: { start_line: number; end_line: number };
      snippets?: Record<string, string>;
    }>;
  },
  codesPerEdit?: string[][]
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
  call: { toolName: string; input: unknown },
  output: unknown,
  codesPerEdit?: string[][]
): string {
  const lines: string[] = [];

  if (call.toolName === 'dispatch') {
    const { edits } = call.input as {
      edits: Array<{
        editing_instruction: string;
        context?: { start_line: number; end_line: number };
        snippets?: Record<string, string>;
      }>;
    };
    lines.push(`**dispatch** — ${edits.length} edit(s)`);
    lines.push('');
    lines.push(formatDispatchArgs({ edits }, codesPerEdit));
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
  step: StepResult<ToolSet>,
  i: number,
  durationMs: number | undefined,
  elapsedMs: number | undefined,
  dispatchRoundRef: { current: number },
  coderCodeBlocks?: string[][][]
): string {
  const lines: string[] = [
    `### Step ${i + 1}${formatTiming(durationMs, elapsedMs)}`,
  ];

  if (step.text) {
    lines.push('');
    lines.push(step.text.trim());
  }

  for (let j = 0; j < step.toolCalls.length; j++) {
    const call = step.toolCalls[j]!;
    const result = step.toolResults?.[j];
    const codesPerEdit =
      call.toolName === 'dispatch'
        ? coderCodeBlocks?.[dispatchRoundRef.current++]
        : undefined;
    lines.push('');
    lines.push(
      formatToolCall(
        call as unknown as { toolName: string; input: unknown },
        result != null
          ? (result as unknown as { output: unknown }).output
          : undefined,
        codesPerEdit
      )
    );
  }

  const { inputTokens, outputTokens } = step.usage;
  lines.push('');
  lines.push(
    `*${inputTokens.toLocaleString()} in / ${outputTokens.toLocaleString()} out*`
  );

  return lines.join('\n');
}

function formatTrace(
  meta: TraceMeta,
  steps: StepResult<ToolSet>[],
  usage: Usage
): string {
  const sections: string[] = [
    '# AI Edit Trace',
    `- **document:** ${meta.documentId}`,
    `- **timestamp:** ${meta.startedAt.toISOString()}`,
    `- **prompt:** ${meta.prompt}`,
  ];

  if (meta.initialDocument) {
    sections.push(
      '',
      '**document before:**',
      '```xml',
      meta.initialDocument,
      '```'
    );
  }

  if (meta.intent) {
    sections.push('', '---', '', '## Interpreter', '', meta.intent);
  }

  sections.push('', '---', '', '## Supervisor');

  const dispatchRoundRef = { current: 0 };
  let elapsedMs = 0;
  for (let i = 0; i < steps.length; i++) {
    const durationMs = meta.stepDurationsMs?.[i];
    if (durationMs != null) elapsedMs += durationMs;
    sections.push('');
    sections.push(
      formatStep(
        steps[i]!,
        i,
        durationMs,
        meta.stepDurationsMs ? elapsedMs : undefined,
        dispatchRoundRef,
        meta.coderCodeBlocks
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
  for (const u of usage) {
    sections.push(
      `| ${u.model} | ${u.inputTokens.toLocaleString()} | ${u.outputTokens.toLocaleString()} |`
    );
  }

  return sections.join('\n');
}

export function buildTraceLog(
  meta: TraceMeta,
  steps: StepResult<ToolSet>[],
  usage: Usage
): string {
  return formatTrace(meta, steps, usage);
}
