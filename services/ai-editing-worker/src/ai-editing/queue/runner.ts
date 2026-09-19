import { match } from 'ts-pattern';
import type { DocReader, DocWriter } from '../doc';
import type { DocumentOp, NodeRef } from '../editor';
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

/** Op fields that carry node ids. Content fields (`text`, `find`, `kind`, …) must
 *  be excluded or unrelated ops look dependent on each other. */
const ID_FIELDS = [
  'node',
  'nodes',
  'ref',
  'refs',
  'table',
  'before',
  'after',
] as const;

/** Every node id an op refers to, for detecting knock-on failures. */
function referencedIds(op: DocumentOp): string[] {
  const record = op as unknown as Record<string, unknown>;
  const out: string[] = [];
  for (const field of ID_FIELDS) {
    const value = record[field];
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value)) {
      for (const v of value) if (typeof v === 'string') out.push(v);
    }
  }
  return out;
}

/**
 * Render only failures; successful ops intentionally produce no detail.
 *
 * Failures caused by an EARLIER failure are reported as consequences rather than
 * as peers. One bad op used to produce a wall of equally-weighted errors — a
 * failed insert left its ref dangling, so every dependent op reported
 * `No node with id "<nanoid>"` and the writer could not tell which failure was
 * the real one. Measured on the current corpus runs, unknown-id errors are the
 * single largest remaining trigger for a retry, and most of those ids are refs
 * from an op that had already failed.
 */
export function summarize(results: OpResult[]): string {
  const failures = results.filter(
    (r): r is Extract<OpResult, { ok: false }> => !r.ok
  );
  if (failures.length === 0) return 'ok';

  // Ids that no longer resolve because the op meant to create them failed.
  const poisoned = new Set<string>();
  const lines: string[] = [];
  let consequences = 0;

  for (const result of results) {
    if (result.ok) continue;
    const failed = result as Extract<OpResult, { ok: false }>;
    const dependsOnFailed = referencedIds(result.op).some((id) =>
      poisoned.has(id)
    );
    if (dependsOnFailed) consequences++;
    else lines.push(`error: ${failed.op.kind}: ${failed.error}`);
    // Whatever this op would have produced is now unusable downstream.
    for (const id of referencedIds(result.op)) poisoned.add(id);
  }

  if (consequences > 0) {
    lines.push(
      `${consequences} later op${consequences > 1 ? 's' : ''} referenced a node the failed op above would have created, and could not run. ` +
        'Fix the first error; the rest are consequences of it.'
    );
  }
  return lines.join('\n');
}
