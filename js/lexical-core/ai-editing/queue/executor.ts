import { match } from 'ts-pattern';
import type { DocumentOp, NodeRef, NodeSpec } from '../editor/ops';
import type { DocWriter } from '../doc/interfaces';
import type { DocReader } from '../doc/interfaces';
import type { DocumentOpQueue } from './document-op-queue';
import type { RandomSource } from './random-source';
import type { Awareness, DocumentOpStep, Edit } from './types';

export type OpResult =
  | { ok: true; op: DocumentOp; summary: string }
  | { ok: false; op: DocumentOp; error: string };

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type RunQueueArgs = {
  queue: DocumentOpQueue;
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
  const { queue, randomSource, docReader, docWriter, awarenessSource } = args;
  const sleep = args.sleep ?? defaultSleep;
  const resolveNode = args.resolveNode ?? ((n) => n);
  const results: OpResult[] = [];
  if (queue.isDone) return results;

  let done = false;
  while (!done) {
    let steps: DocumentOpStep[];
    try {
      ({ done, steps } = queue.step({ randomSource, docReader }));
    } catch (e) {
      // a planning read failed (e.g. unknown id) — attribute to the stepped op.
      results.push({ ok: false, op: queue.lastOp!, error: toMessage(e) });
      done = queue.isDone;
      continue;
    }

    const op = queue.lastOp!;
    try {
      for (const step of steps) {
        await match(step)
          .with({ kind: 'pause' }, ({ ms }) => sleep(ms))
          .with({ kind: 'awareness' }, ({ x }) => awarenessSource.apply({ ...x, node: resolveNode(x.node) }))
          // applies to the Lexical session only; loro push is batched in flush()
          .with({ kind: 'edit' }, ({ y }) => applyEdit(docWriter, y))
          .exhaustive();
      }
      results.push({ ok: true, op, summary: describe(op) });
    } catch (e) {
      results.push({ ok: false, op, error: toMessage(e) });
    }
  }

  return results;
}

/** Map a structured `Edit` (Y) onto its `DocWriter` method. */
export function applyEdit(w: DocWriter, y: Edit): void {
  match(y)
    .with({ fn: 'insertText' }, (e) => w.insertText(e.node, e.at, e.text))
    .with({ fn: 'removeText' }, (e) => w.removeText(e.node, e.at, e.len))
    .with({ fn: 'setText' }, (e) => w.setText(e.node, e.text))
    .with({ fn: 'appendText' }, (e) => w.appendText(e.node, e.text))
    .with({ fn: 'prependText' }, (e) => w.prependText(e.node, e.text))
    .with({ fn: 'replaceText' }, (e) => w.replaceText(e.node, e.find, e.to, e.scope))
    .with({ fn: 'formatText' }, (e) => w.formatText(e.node, e.match, e.format, e.on, e.scope))
    .with({ fn: 'clearFormat' }, (e) => w.clearFormat(e.node, e.match, e.scope))
    .with({ fn: 'markText' }, (e) => w.markText(e.node, e.match, e.on, e.scope))
    .with({ fn: 'linkText' }, (e) => w.linkText(e.node, e.match, e.url, e.scope))
    .with({ fn: 'formatNode' }, (e) => w.formatNode(e.node, e.format, e.on))
    .with({ fn: 'clearNodeFormat' }, (e) => w.clearNodeFormat(e.node))
    .with({ fn: 'setBlockType' }, (e) => w.setBlockType(e.node, e.block, { level: e.level, language: e.language }))
    .with({ fn: 'setListType' }, (e) => w.setListType(e.nodes, e.list))
    .with({ fn: 'appendListItem' }, (e) => w.appendListItem(e.ref, e.node, e.checked))
    .with({ fn: 'setChecked' }, (e) => w.setChecked(e.node, e.checked))
    .with({ fn: 'setIndent' }, (e) => w.setIndent(e.node, e.indent))
    .with({ fn: 'sortList' }, (e) => w.sortList(e.node, e.order))
    .with({ fn: 'insertNode' }, (e) => w.insertNode(e.ref, e.spec, e.at))
    .with({ fn: 'insertInline' }, (e) => w.insertInline(e.ref, e.node, e.at, e.spec))
    .with({ fn: 'moveNode' }, (e) => w.moveNode(e.node, e.at))
    .with({ fn: 'removeNode' }, (e) => w.removeNode(e.node))
    .with({ fn: 'mergeBlocks' }, (e) => w.mergeBlocks(e.nodes, e.separator))
    .with({ fn: 'splitBlock' }, (e) => w.splitBlock(e.node, e.atText))
    .with({ fn: 'setCell' }, (e) => w.setCell(e.table, e.row, e.col, e.text))
    .with({ fn: 'addRow' }, (e) => w.addRow(e.table, e.at))
    .with({ fn: 'addColumn' }, (e) => w.addColumn(e.table, e.at))
    .with({ fn: 'removeRow' }, (e) => w.removeRow(e.table, e.row))
    .with({ fn: 'removeColumn' }, (e) => w.removeColumn(e.table, e.col))
    .exhaustive();
}

/** A concise, semantic summary line for the model — the replacement for a diff. */
export function describe(op: DocumentOp): string {
  return match(op)
    .returnType<string>()
    .with({ kind: 'formatText' }, (o) => `${o.on ? '' : 'un'}${o.format} "${o.match}" in {${o.id}}`)
    .with({ kind: 'clearFormat' }, (o) => (o.match ? `cleared formatting on "${o.match}" in {${o.id}}` : `cleared all formatting in {${o.id}}`))
    .with({ kind: 'formatNode' }, (o) => `${o.on ? '' : 'un'}${o.format} {${o.textId}}`)
    .with({ kind: 'clearNodeFormat' }, (o) => `cleared formatting on {${o.textId}}`)
    .with({ kind: 'markText' }, (o) => `${o.on ? 'highlighted' : 'unhighlighted'} "${o.match}" in {${o.id}}`)
    .with({ kind: 'linkText' }, (o) => (o.url ? `linked "${o.match}" → ${o.url} in {${o.id}}` : `unlinked "${o.match}" in {${o.id}}`))
    .with({ kind: 'setText' }, (o) => `set {${o.id}} text to "${truncate(o.text)}"`)
    .with({ kind: 'replaceText' }, (o) => `replaced "${o.find}" → "${o.to}" in {${o.id}}`)
    .with({ kind: 'appendText' }, (o) => `appended "${truncate(o.text)}" to {${o.id}}`)
    .with({ kind: 'prependText' }, (o) => `prepended "${truncate(o.text)}" to {${o.id}}`)
    .with({ kind: 'setBlockType' }, (o) => `{${o.id}} → ${o.block}${o.level ? ` h${o.level}` : ''}`)
    .with({ kind: 'setListType' }, (o) => `{${o.ids.join(', ')}} → ${o.list} list`)
    .with({ kind: 'setChecked' }, (o) => `{${o.id}} ${o.checked ? 'checked' : 'unchecked'}`)
    .with({ kind: 'setIndent' }, (o) => `{${o.id}} indent ${o.indent}`)
    .with({ kind: 'sortList' }, (o) => `sorted list {${o.id}} ${o.order}`)
    .with({ kind: 'insertBlock' }, (o) => `inserted ${specLabel(o.spec)} (${o.ref})`)
    .with({ kind: 'insertInline' }, (o) => `inserted ${specLabel(o.spec)} in {${o.id}} @${o.at}`)
    .with({ kind: 'moveBlock' }, (o) => `moved {${o.id}}`)
    .with({ kind: 'removeBlock' }, (o) => `removed {${o.id}}`)
    .with({ kind: 'mergeBlocks' }, (o) => `merged {${o.ids.join(', ')}}`)
    .with({ kind: 'splitBlock' }, (o) => `split {${o.id}} at "${o.atText}"`)
    .with({ kind: 'setCell' }, (o) => `set cell [${o.row}, ${o.col}] of {${o.table}}`)
    .with({ kind: 'addRow' }, (o) => `added row to {${o.table}}`)
    .with({ kind: 'addColumn' }, (o) => `added column to {${o.table}}`)
    .with({ kind: 'removeRow' }, (o) => `removed row ${o.row} of {${o.table}}`)
    .with({ kind: 'removeColumn' }, (o) => `removed column ${o.col} of {${o.table}}`)
    .exhaustive();
}

function toMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  throw e;
}

function specLabel(spec: NodeSpec): string {
  return 'block' in spec ? spec.block : `${spec.inline}`;
}

function truncate(s: string, n = 40): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** Render results as a per-op summary the tool returns to the model. */
export function summarize(results: OpResult[]): string {
  if (results.length === 0) return 'no operations';
  return results
    .map((r) => {
      if (r.ok) return `✓ ${r.summary}`;
      return `✗ ${r.op.kind}: ${r.error}`;
    })
    .join('\n');
}
