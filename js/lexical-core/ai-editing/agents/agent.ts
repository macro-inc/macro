import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createCerebras } from '@ai-sdk/cerebras';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { type LanguageModel, generateText, stepCountIs, tool } from 'ai';
import { createTwoFilesPatch } from 'diff';
import { envsafe, str } from 'envsafe';
import * as lexical from 'lexical';
import { $createHeadingNode } from '@lexical/rich-text';
import { $createListItemNode, $createListNode } from '@lexical/list';
import { $createTableCellNode, $createTableNode, $createTableRowNode } from '@lexical/table';
import { z } from 'zod';
import { $createDateMentionNode } from '../../nodes/DateMentionNode';
import { $createEquationNode } from '../../nodes/EquationNode';
import { $createHorizontalRuleNode } from '../../nodes/HorizontalRuleNode';
import { $createImageNode } from '../../nodes/ImageNode';
import { $createVideoNode } from '../../nodes/VideoNode';
import { $updateAllNodeIds } from '../../plugins/nodeIdPlugin';
import { debugMarkdown, isDebug, nextSeq, writeDebug } from '../debug';
import * as toolkit from '../ai-toolkit';
import { type Session, toSnapshot } from '../ai-toolkit';
import { diffTrees, printChanges } from '../tree-diff';
import { findInDocument, serializeHeadings, serializeWithIds, serializeWindowByLines } from '../utils';
import { interpret } from './interpret';

let childCount = 0;

const env = envsafe({
  ANTHROPIC_API_KEY: str({ default: '' }),
  OPENAI_API_KEY: str({ default: '' }),
  CEREBRAS_API_KEY: str({ default: '' }),
  GOOGLE_API_KEY: str({ default: '' }),
  MODEL: str({ default: 'claude-sonnet-4-6' }),
});

export type Provider = 'anthropic' | 'openai' | 'cerebras' | 'google';

export function createModel(provider: Provider, modelId?: string): LanguageModel {
  if (provider === 'openai') {
    const key = modelId ?? 'gpt-5.4-mini';
    if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for --provider openai');
    return createOpenAI({ apiKey: env.OPENAI_API_KEY })(key);
  }
  if (provider === 'cerebras') {
    const key = modelId ?? 'zai-glm-4.7';
    if (!env.CEREBRAS_API_KEY) throw new Error('CEREBRAS_API_KEY is required for --provider cerebras');
    return createCerebras({ apiKey: env.CEREBRAS_API_KEY })(key);
  }
  if (provider === 'google') {
    const key = modelId ?? 'gemini-2.5-flash';
    if (!env.GOOGLE_API_KEY) throw new Error('GOOGLE_API_KEY is required for --provider google');
    return createGoogleGenerativeAI({ apiKey: env.GOOGLE_API_KEY })(key);
  }
  const key = modelId ?? env.MODEL;
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is required for --provider anthropic');
  return createAnthropic({ apiKey: env.ANTHROPIC_API_KEY })(key);
}

export const MODEL_ID = env.MODEL;

const read = (f: string) => fs.readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');

const SHARED = read('../prompts/SHARED.md');
const CHILD_SYSTEM = `${SHARED}\n${read('../prompts/CODER.md')}\n${read('../prompts/GUIDE.md')}`;
const MASTER_SYSTEM = `${SHARED}\n${read('../prompts/SUPERVISOR.md')}`;
const INTERPRET_SYSTEM = `${SHARED}\n${read('../prompts/INTERPRET.md')}`;


export function runCode(s: Session, code: string): string {
  // Keep these in sync with the "In scope" list in prompts/CODER.md.
  const scope = {
    s,
    ...toolkit,
    $createTextNode: lexical.$createTextNode,
    $createParagraphNode: lexical.$createParagraphNode,
    $createLineBreakNode: lexical.$createLineBreakNode,
    $createTabNode: lexical.$createTabNode,
    $createHeadingNode,
    $createListNode,
    $createListItemNode,
    $createTableNode,
    $createTableRowNode,
    $createTableCellNode,
    $createHorizontalRuleNode,
    $createEquationNode,
    $createImageNode,
    $createVideoNode,
    $createDateMentionNode,
  };
  const before = s.editor.getEditorState();
  try {
    s.editor.update(() => new Function(...Object.keys(scope), code)(...Object.values(scope)), {
      discrete: true,
    });
  } catch (e) {
    s.editor.setEditorState(before);
    s.editor.update(() => $updateAllNodeIds(s.ids), { discrete: true });
    throw e;
  }
  return serializeWithIds(s);
}

function unifiedDiff(before: string, after: string): string {
  if (before === after) return '(no changes)';
  return createTwoFilesPatch('before', 'after', before, after, '', '');
}

async function runTask(
  s: Session,
  task: string,
  lineStart: number,
  lineEnd: number,
  model: LanguageModel,
  onEdit?: () => void,
  reportDiff = false
) {
  const applyEdit = tool({
    description: 'Run JS statements (using the $-helpers and `s`) against the document.',
    inputSchema: z.object({ code: z.string() }),
    execute: async ({ code }) => {
      console.error(`\n[applyEdit] (${task})\n${code}`);
      const before = serializeWithIds(s);
      const beforeSnap = toSnapshot(s);
      try {
        const after = runCode(s, code);
        if (after === before) {
          return 'ran OK but nothing changed — your locators/find-strings matched nothing (list markers and indentation are not text; use $toggleList to renumber, .remove() for blank lines).';
        }
        // Compute the keyed tree diff for observability. Not applied yet — the
        // edit already landed via runCode; this is the change list the future
        // human-like replay will consume.
        const afterSnap = toSnapshot(s);
        const changes = diffTrees(beforeSnap, afterSnap);
        console.error(`\n[changelist] ${changes.length} change(s)\n${printChanges(changes)}`);
        onEdit?.();
        return reportDiff ? `ok — applied.\n[diff]\n${unifiedDiff(before, after)}` : 'ok — applied.';
      } catch (e) {
        return `error: ${(e as Error).message}`;
      }
    },
  });

  const dbg = isDebug();
  const idx = dbg ? nextSeq() : 0;
  const label = dbg ? `child${++childCount}` : '';
  const context = lineStart > 0 ? `\n\n<document>\n${serializeWindowByLines(s, lineStart, lineEnd)}\n</document>` : '';
  const prompt = `Make this single edit:\n${task}${context}`;
  const result = await generateText({
    model,
    stopWhen: stepCountIs(5),
    system: CHILD_SYSTEM,
    prompt,
    tools: { applyEdit },
  });
  if (dbg) writeDebug(idx, label, debugMarkdown(label, CHILD_SYSTEM, prompt, result, task));
  return result;
}

export async function runAgent(
  s: Session,
  request: string,
  onEdit?: () => void,
  model?: LanguageModel,
  opts: { reportDiff?: boolean; interpret?: boolean; childModel?: LanguageModel; lightweight?: boolean } = {}
) {
  const resolvedModel = model ?? createModel('anthropic');
  const resolvedChildModel = opts.childModel ?? resolvedModel;
  let inputTokens = 0;
  let outputTokens = 0;
  let round = 0;

  const find = tool({
    description: 'Search the document for lines matching a needle. Returns up to 3 matching regions with surrounding context. Use this to locate content not visible in the headings.',
    inputSchema: z.object({
      needle: z.string().describe('text to search for'),
      contextLines: z.number().int().default(5).describe('lines of context around each match'),
    }),
    execute: async ({ needle, contextLines }) => findInDocument(s, needle, contextLines),
  });

  // Optional first pass: establish intent (what + why) before any edits, and
  // inject it into the supervisor prompt to anchor its decisions.
  let intent = '';
  if (opts.interpret) {
    const docContext = opts.lightweight
      ? `<headings>\n${serializeHeadings(s)}\n</headings>`
      : `<document>\n${serializeWithIds(s)}\n</document>`;
    const interpretation = await interpret(
      docContext,
      request,
      resolvedModel,
      INTERPRET_SYSTEM,
      opts.lightweight ? { find } : undefined
    );
    inputTokens += interpretation.totalUsage.inputTokens ?? 0;
    outputTokens += interpretation.totalUsage.outputTokens ?? 0;
    intent = interpretation.text;
    console.error(`\n[intent]\n${intent}`);
  }

  // The supervisor works in rounds: it calls `dispatch` with a batch of edit
  // instructions, the batch is applied, and the resulting diff is returned so
  // the supervisor can decide the next round. Edits within one batch run in
  // parallel, so the supervisor must only group edits that touch DIFFERENT
  // regions and cannot conflict (see SUPERVISOR.md).
  const dispatch = tool({
    description:
      'Spawn one writer per edit instruction, apply them, and return the resulting unified diff. ' +
      'Only put multiple edits in one call when they touch DIFFERENT regions and cannot conflict; ' +
      'otherwise dispatch one edit at a time across separate calls so each sees the previous diff.',
    inputSchema: z.object({
      edits: z.array(
        z.object({
          instruction: z.string().describe('what to change'),
          lineStart: z.number().int().optional(),
          lineEnd: z.number().int().optional(),
        })
      ).describe('edit instructions to run as one parallel batch'),
    }),
    execute: async ({ edits }) => {
      round += 1;
      console.error(
        `\n[round ${round}] dispatching ${edits.length} edit(s):\n${edits
          .map((e, i) => `  ${i + 1}. ${e.instruction}`)
          .join('\n')}`
      );
      const before = serializeWithIds(s);
      const results = await Promise.all(
        edits.map(({ instruction, lineStart, lineEnd }) => runTask(s, instruction, lineStart ?? 0, lineEnd ?? 0, resolvedChildModel, onEdit, opts.reportDiff))
      );
      for (const res of results) {
        inputTokens += res.totalUsage.inputTokens ?? 0;
        outputTokens += res.totalUsage.outputTokens ?? 0;
      }
      const diff = unifiedDiff(before, serializeWithIds(s));
      console.error(`\n[round ${round} diff]\n${diff}`);
      return diff;
    },
  });

  const dbg = isDebug();
  const supIdx = dbg ? nextSeq() : 0;
  const intentBlock = intent ? `<intent>\n${intent}\n</intent>\n\n` : '';
  const docContext = opts.lightweight
    ? `<headings>\n${serializeHeadings(s)}\n</headings>`
    : `<document>\n${serializeWithIds(s)}\n</document>`;
  const prompt = `Request: ${request}\n\n${intentBlock}${docContext}`;

  const result = await generateText({
    model: resolvedModel,
    stopWhen: stepCountIs(4),
    system: MASTER_SYSTEM,
    prompt,
    tools: opts.lightweight ? { dispatch, find } : { dispatch },
  });
  if (dbg) writeDebug(supIdx, 'supervisor', debugMarkdown('supervisor', MASTER_SYSTEM, prompt, result));
  inputTokens += result.totalUsage.inputTokens ?? 0;
  outputTokens += result.totalUsage.outputTokens ?? 0;

  const text = round ? `Applied edits over ${round} round(s).` : 'No edits needed.';
  return { text, totalUsage: { inputTokens, outputTokens } };
}
