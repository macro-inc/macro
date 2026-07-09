import type { LanguageModel } from 'ai';
import { z } from 'zod';
import type { snippet } from '../agents/snippet';
import type { PendingSnippet, PendingSnippetEffort } from '../runtime';
import type { TokenTracker } from '../token-tracker';

/** A snippet spec as the supervisor writes it: a plain brief (low effort), or
 *  `{ brief, effort }` to route composition to the stronger model. */
export const SnippetSpecsSchema = z.record(
  z.string(),
  z.union([
    z.string(),
    z.object({
      brief: z.string(),
      effort: z.enum(['low', 'high']).optional(),
    }),
  ])
);

export type SnippetSpecs = z.infer<typeof SnippetSpecsSchema>;

/** One spec'd snippet's life, timestamped (epoch ms) for the session trace.
 *  `resolvedAt` stays unset if generation was still in flight when the batch
 *  finished (a spec no writer awaited). */
export type SnippetTraceEntry = {
  key: string;
  brief: string;
  effort?: PendingSnippetEffort;
  text?: string;
  error?: string;
  startedAt: number;
  resolvedAt?: number;
};

export type LaunchSnippetSpecsOptions = {
  specs: SnippetSpecs | undefined;
  /** Document window the snippet text will land in. */
  context: string;
  snippetModel: LanguageModel;
  snippetHighModel: LanguageModel;
  tracker: TokenTracker;
  runSnippet: typeof snippet;
  signal?: AbortSignal;
};

/** Fire one snippet agent per spec — immediately, without awaiting — so
 *  composition overlaps the writer's codegen. The returned promises settle
 *  only when the writer's code runs (see `settleSnippets`). */
export function launchSnippetSpecs(opts: LaunchSnippetSpecsOptions): {
  pending: Record<string, PendingSnippet>;
  traces: SnippetTraceEntry[];
} {
  const traces: SnippetTraceEntry[] = [];
  const pending: Record<string, PendingSnippet> = Object.fromEntries(
    Object.entries(opts.specs ?? {}).map(([key, spec]) => {
      const { brief, effort = 'low' as PendingSnippetEffort } =
        typeof spec === 'string' ? { brief: spec } : spec;
      const model =
        effort === 'high' ? opts.snippetHighModel : opts.snippetModel;
      const entry: SnippetTraceEntry = {
        key,
        brief,
        effort,
        startedAt: Date.now(),
      };
      traces.push(entry);
      const promise = opts
        .runSnippet(brief, opts.context, model, opts.signal)
        .then((res) => {
          opts.tracker.add(model as { modelId: string }, res.totalUsage);
          return res.text;
        });
      // Trace tap; doubles as the unhandled-rejection guard for specs
      // the writer never awaits.
      promise.then(
        (text) => {
          entry.text = text;
          entry.resolvedAt = Date.now();
        },
        (e: unknown) => {
          entry.error = e instanceof Error ? e.message : String(e);
          entry.resolvedAt = Date.now();
        }
      );
      return [key, { brief, promise }];
    })
  );
  return { pending, traces };
}
