import { type GenerateTextResult, type LanguageModel, tool } from 'ai';
import { z } from 'zod';
import { type Session } from '../ai-toolkit';
import type { AwarenessSource } from '../awareness/awareness-source';
import type { Doc } from '../doc/doc';
import type { RunTaskDeps } from '../agents/coder';
import type { DocumentOpQueueParams } from '../queue/document-op-queue';
import type { RunCodeToolOptions } from './run-code';
import { serializeWithXml } from '../utils';

export type Counters = { inputTokens: number; outputTokens: number };

/** A borrowed writer identity (its own cursor). `release` clears the cursor and
 *  returns the peer to the pool; call it when the writer ends. */
export type Writer = { awarenessSource: AwarenessSource; release: () => void };

export type DispatchToolOptions = {
  s: Session;
  doc: Doc;
  childModel: LanguageModel;
  counters: Counters;
  params?: DocumentOpQueueParams;
  signal?: AbortSignal;
  makeWriter: () => Promise<Writer>;
  runTask: (s: Session, task: string, model: LanguageModel, deps: RunTaskDeps) => Promise<GenerateTextResult<any, any>>;
  serialize?: (s: Session) => string;
  runner?: RunCodeToolOptions['runner'];
  onOps?: RunCodeToolOptions['onOps'];
};

export function createDispatchTool(opts: DispatchToolOptions) {
  const { s, doc, childModel, counters, params, signal, makeWriter, runTask, runner, onOps } = opts;
  const serialize = opts.serialize ?? serializeWithXml;
  let round = 0;
  return tool({
    description:
      'Spawn one writer per edit instruction; each carries out its edit and animates it live as a distinct cursor. Returns each writer\'s summary plus the updated document. ' +
      'Batch edits that touch DIFFERENT regions and cannot conflict; dispatch dependent or same-region edits one at a time across separate calls.',
    inputSchema: z.object({
      edits: z
        .array(z.object({ instruction: z.string().describe('one mechanical change, referencing node ids') }))
        .describe('edit instructions to run as one parallel batch'),
    }),
    execute: async ({ edits }) => {
      round += 1;
      console.log(`\n[round ${round}] ${edits.length} edit(s):\n${edits.map((e, i) => `  ${i + 1}. ${e.instruction}`).join('\n')}`);
      // Writers run concurrently (distinct cursors); each applies its own ops
      // serially via editor.update, so the shared session never tears.
      const results = await Promise.all(
        edits.map(async ({ instruction }) => {
          const writer = await makeWriter();
          const { awarenessSource } = writer;
          try {
            return await runTask(s, instruction, childModel, { doc, awarenessSource, params, signal, runner, onOps });
          } finally {
            writer.release();
          }
        })
      );
      const summaries = results.map((res, i) => {
        counters.inputTokens += res.totalUsage.inputTokens ?? 0;
        counters.outputTokens += res.totalUsage.outputTokens ?? 0;
        return `${i + 1}. ${res.text.trim()}`;
      });
      return `${summaries.join('\n')}\n\n<document>\n${serialize(s)}\n</document>`;
    },
  });
}
