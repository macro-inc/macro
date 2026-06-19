/**
 * Optional per-turn debug dumps. When enabled via `--debug <dir>`, every LLM
 * call (the supervisor and each child writer) is written to its own numbered
 * markdown file: 0000-supervisor.md, 0001-child1.md, 0002-child2.md, …
 *
 * Sequence numbers are reserved at call START (so file order matches spawn
 * order) and shared across the whole process, so a REPL session keeps
 * accumulating files across user turns.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

let dir: string | null = null;
let seq = 0;

export function initDebug(d: string | undefined): void {
  if (!d) return;
  dir = d;
  fs.mkdirSync(d, { recursive: true });
}

export function isDebug(): boolean {
  return dir !== null;
}

/** Reserve the next sequence number (call at the START of an LLM turn). */
export function nextSeq(): number {
  return seq++;
}

/** Write a reserved turn to `<dir>/NNNN-<label>.md`. No-op if debug is off. */
export function writeDebug(index: number, label: string, markdown: string): void {
  if (!dir) return;
  const n = String(index).padStart(4, '0');
  fs.writeFileSync(path.join(dir, `${n}-${label}.md`), markdown);
}

// Structural shape of the bits of a generateText result we render. Typed loosely
// so it accepts results from any tool set (the supervisor's `dispatch`, a child's
// `applyEdit`, …) without fighting GenerateTextResult's invariant tool-set param.
export type GenResult = {
  text?: string;
  totalUsage?: { inputTokens?: number; outputTokens?: number };
  steps?: ReadonlyArray<{
    text?: string;
    finishReason?: string;
    toolCalls?: unknown[];
    toolResults?: unknown[];
  }>;
};

function fence(content: unknown, lang = ''): string {
  const body = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  return '```' + lang + '\n' + body + '\n```';
}

/** Render one LLM turn as a readable markdown document. Interesting parts
 *  (the tool calls and their diffs) go first; the long system/prompt last. */
export function debugMarkdown(
  role: string,
  system: string,
  prompt: string,
  result: GenResult,
  task?: string
): string {
  const u = result.totalUsage;
  const out: string[] = [];
  out.push(`# ${role}`, '');
  out.push(`**usage:** in ${u?.inputTokens ?? '?'} · out ${u?.outputTokens ?? '?'}`, '');
  if (task) out.push('## Task', '', task, '');
  if (result.text) out.push('## Final reply', '', result.text, '');

  out.push('## Steps', '');
  (result.steps ?? []).forEach((st, i) => {
    out.push(`### Step ${i + 1} — \`${st.finishReason ?? ''}\``, '');
    if (st.text) out.push(st.text, '');
    for (const tc of (st.toolCalls ?? []) as any[]) {
      out.push(`**→ call \`${tc.toolName}\`**`, '', fence(tc.input ?? tc.args ?? {}, 'json'), '');
    }
    for (const tr of (st.toolResults ?? []) as any[]) {
      out.push(`**← result of \`${tr.toolName}\`**`, '', fence(tr.output ?? tr.result ?? tr), '');
    }
  });

  out.push('## System', '', fence(system), '');
  out.push('## Prompt', '', fence(prompt), '');
  return out.join('\n');
}
