import { match } from 'ts-pattern';
import type { DocReader, DocWriter } from '../doc/interfaces';
import type { DocumentOp, NodeRef } from '../editor/ops';
import { animate } from './animators';
import type { RandomSource } from './random-source';
import type { Awareness, DocumentOpStep } from './types';
import { DEFAULT_QUEUE_PARAMS, type DocumentOpQueueParams } from './types';

export type OpResult =
  | { ok: true; op: DocumentOp }
  | { ok: false; op: DocumentOp; error: string };

const defaultSleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));

export type RunQueueArgs = {
  ops: DocumentOp[];
  params?: DocumentOpQueueParams;
  randomSource: RandomSource;
  docReader: DocReader;
  docWriter: DocWriter;
  awarenessSource: { apply(x: Awareness): void };
  /** Resolve a placeholder ref to its real id, so cursors point at inserted
   *  nodes once their insert edit has run. Defaults to identity. */
  resolveNode?: (node: NodeRef) => NodeRef;
  /** Injectable for tests (skip real timers). */
  sleep?: (ms: number) => Promise<void>;
};

export async function runQueue(args: RunQueueArgs): Promise<OpResult[]> {
  const { ops, randomSource, docReader, docWriter, awarenessSource } = args;
  const sleep = args.sleep ?? defaultSleep;
  const resolveNode = args.resolveNode ?? ((n) => n);
  const params = args.params ?? DEFAULT_QUEUE_PARAMS;
  const msPerChar = 60_000 / (params.speed * 5);
  const results: OpResult[] = [];

  for (const op of ops) {
    let steps: DocumentOpStep[];
    try {
      steps = animate(op, {
        randomSource,
        docReader,
        msPerChar,
        ranges: params.ranges,
      });
    } catch (e) {
      results.push({ ok: false, op, error: toMessage(e) });
      continue;
    }

    try {
      for (const step of steps) {
        await match(step)
          .with({ kind: 'pause' }, ({ ms }) => sleep(ms))
          .with({ kind: 'awareness' }, ({ x }) =>
            awarenessSource.apply({ ...x, node: resolveNode(x.node) })
          )
          .with({ kind: 'edit' }, ({ y }) => docWriter.apply(y))
          .exhaustive();
      }
      results.push({ ok: true, op });
    } catch (e) {
      results.push({ ok: false, op, error: toMessage(e) });
    }
  }

  return results;
}

function toMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  throw e;
}

/** Render only failures; successful ops intentionally produce no detail. */
export function summarize(results: OpResult[]): string {
  const failures = results.filter(
    (r): r is Extract<OpResult, { ok: false }> => !r.ok
  );
  if (failures.length === 0) return 'ok';
  return failures.map((r) => `error: ${r.op.kind}: ${r.error}`).join('\n');
}
