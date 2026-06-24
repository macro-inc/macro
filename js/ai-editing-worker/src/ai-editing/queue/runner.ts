import { match } from 'ts-pattern';
import type { DocReader, DocWriter } from '../doc/interfaces';
import type { DocumentOp, Edit, NodeRef } from '../editor/ops';
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

/** Apply a DocumentOp directly to a DocWriter with no animation, pauses, or cursor movement. */
export function applyOp(w: DocWriter, op: DocumentOp): void {
  const edit: Edit = match(op)
    .with({ kind: 'formatText' }, (o) => ({
      fn: 'formatText' as const,
      node: o.id,
      match: o.match,
      format: o.format,
      on: o.on,
      scope: o.scope,
    }))
    .with({ kind: 'markText' }, (o) => ({
      fn: 'markText' as const,
      node: o.id,
      match: o.match,
      on: o.on,
      scope: o.scope,
    }))
    .with({ kind: 'linkText' }, (o) => ({
      fn: 'linkText' as const,
      node: o.id,
      match: o.match,
      url: o.url,
      scope: o.scope,
    }))
    .with({ kind: 'replaceText' }, (o) => ({
      fn: 'replaceText' as const,
      node: o.id,
      find: o.find,
      to: o.to,
      scope: o.scope,
    }))
    .with({ kind: 'clearFormat' }, (o) => ({
      fn: 'clearFormat' as const,
      node: o.id,
      match: o.match,
      scope: o.scope,
    }))
    .with({ kind: 'formatNode' }, (o) => ({
      fn: 'formatNode' as const,
      node: o.textId,
      format: o.format,
      on: o.on,
    }))
    .with({ kind: 'clearNodeFormat' }, (o) => ({
      fn: 'clearNodeFormat' as const,
      node: o.textId,
    }))
    .with({ kind: 'setText' }, (o) => ({
      fn: 'setText' as const,
      node: o.id,
      text: o.text,
    }))
    .with({ kind: 'setEquation' }, (o) => ({
      fn: 'setEquation' as const,
      node: o.id,
      tex: o.tex,
    }))
    .with({ kind: 'appendText' }, (o) => ({
      fn: 'appendText' as const,
      node: o.id,
      text: o.text,
    }))
    .with({ kind: 'prependText' }, (o) => ({
      fn: 'prependText' as const,
      node: o.id,
      text: o.text,
    }))
    .with({ kind: 'setBlockType' }, (o) => ({
      fn: 'setBlockType' as const,
      node: o.id,
      block: o.block,
      level: o.level,
      language: o.language,
    }))
    .with({ kind: 'setListType' }, (o) => ({
      fn: 'setListType' as const,
      nodes: o.ids,
      list: o.list,
    }))
    .with({ kind: 'setChecked' }, (o) => ({
      fn: 'setChecked' as const,
      node: o.id,
      checked: o.checked,
    }))
    .with({ kind: 'setIndent' }, (o) => ({
      fn: 'setIndent' as const,
      node: o.id,
      indent: o.indent,
    }))
    .with({ kind: 'insertBlock' }, (o) => ({
      fn: 'insertNode' as const,
      ref: o.ref,
      spec: o.spec,
      at: o.at,
    }))
    .with({ kind: 'insertInline' }, (o) => ({
      fn: 'insertInline' as const,
      ref: o.ref,
      node: o.id,
      at: o.at,
      spec: o.spec,
    }))
    .with({ kind: 'moveBlock' }, (o) => ({
      fn: 'moveNode' as const,
      node: o.id,
      at: o.at,
    }))
    .with({ kind: 'removeBlock' }, (o) => ({
      fn: 'removeNode' as const,
      node: o.id,
    }))
    .with({ kind: 'mergeBlocks' }, (o) => ({
      fn: 'mergeBlocks' as const,
      nodes: o.ids,
      separator: o.separator,
    }))
    .with({ kind: 'insertListItemAfter' }, (o) => ({
      fn: 'insertListItemAfter' as const,
      ref: o.ref,
      node: o.id,
      text: o.text,
      list: o.list,
    }))
    .with({ kind: 'insertListItemBefore' }, (o) => ({
      fn: 'insertListItemBefore' as const,
      ref: o.ref,
      node: o.id,
      text: o.text,
      list: o.list,
    }))
    .with({ kind: 'removeListItem' }, (o) => ({
      fn: 'removeListItem' as const,
      node: o.id,
    }))
    .with({ kind: 'setCell' }, (o) => ({
      fn: 'setCell' as const,
      table: o.table,
      row: o.row,
      col: o.col,
      text: o.content,
    }))
    .with({ kind: 'addRow' }, (o) => ({
      fn: 'addRow' as const,
      table: o.table,
      at: o.at,
    }))
    .with({ kind: 'addColumn' }, (o) => ({
      fn: 'addColumn' as const,
      table: o.table,
      at: o.at,
    }))
    .with({ kind: 'removeRow' }, (o) => ({
      fn: 'removeRow' as const,
      table: o.table,
      row: o.row,
    }))
    .with({ kind: 'removeColumn' }, (o) => ({
      fn: 'removeColumn' as const,
      table: o.table,
      col: o.col,
    }))
    .with({ kind: 'setImageAlt' }, (o) => ({
      fn: 'setImageAlt' as const,
      node: o.id,
      alt: o.alt,
    }))
    .with({ kind: 'setImageUrl' }, (o) => ({
      fn: 'setImageUrl' as const,
      node: o.id,
      url: o.url,
    }))
    .with({ kind: 'setVideoUrl' }, (o) => ({
      fn: 'setVideoUrl' as const,
      node: o.id,
      url: o.url,
    }))
    .with({ kind: 'setVideoControls' }, (o) => ({
      fn: 'setVideoControls' as const,
      node: o.id,
      controls: o.controls,
    }))
    .with({ kind: 'setDate' }, (o) => ({
      fn: 'setDate' as const,
      node: o.id,
      date: o.date,
      displayFormat: o.displayFormat,
    }))
    .exhaustive();
  w.apply(edit);
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
