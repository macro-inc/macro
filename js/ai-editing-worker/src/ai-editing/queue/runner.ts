import { match } from 'ts-pattern';
import type { DocumentOp, NodeRef, NodeSpec } from '../editor/ops';
import type { DocWriter, DocReader } from '../doc/interfaces';
import type { RandomSource } from './random-source';
import { animate } from './animators';
import type { Awareness, DocumentOpStep, Edit } from './types';
import { DEFAULT_QUEUE_PARAMS, type DocumentOpQueueParams } from './types';

export type OpResult =
  | { ok: true; op: DocumentOp; summary: string }
  | { ok: false; op: DocumentOp; error: string };

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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
      steps = animate(op, { randomSource, docReader, msPerChar, ranges: params.ranges });
    } catch (e) {
      results.push({ ok: false, op, error: toMessage(e) });
      continue;
    }

    try {
      for (const step of steps) {
        await match(step)
          .with({ kind: 'pause' }, ({ ms }) => sleep(ms))
          .with({ kind: 'awareness' }, ({ x }) => awarenessSource.apply({ ...x, node: resolveNode(x.node) }))
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

/** Apply a DocumentOp directly to a DocWriter — no animation, pauses, or cursor movement. */
export function applyOp(w: DocWriter, op: DocumentOp): void {
  match(op)
    .with({ kind: 'formatText' }, (o) => w.formatText(o.id, o.match, o.format, o.on, o.scope))
    .with({ kind: 'markText' }, (o) => w.markText(o.id, o.match, o.on, o.scope))
    .with({ kind: 'linkText' }, (o) => w.linkText(o.id, o.match, o.url, o.scope))
    .with({ kind: 'replaceText' }, (o) => w.replaceText(o.id, o.find, o.to, o.scope))
    .with({ kind: 'clearFormat' }, (o) => w.clearFormat(o.id, o.match, o.scope))
    .with({ kind: 'formatNode' }, (o) => w.formatNode(o.textId, o.format, o.on))
    .with({ kind: 'clearNodeFormat' }, (o) => w.clearNodeFormat(o.textId))
    .with({ kind: 'setText' }, (o) => w.setText(o.id, o.text))
    .with({ kind: 'setEquation' }, (o) => w.setEquation(o.id, o.tex))
    .with({ kind: 'appendText' }, (o) => w.appendText(o.id, o.text))
    .with({ kind: 'prependText' }, (o) => w.prependText(o.id, o.text))
    .with({ kind: 'setBlockType' }, (o) => w.setBlockType(o.id, o.block, { level: o.level, language: o.language }))
    .with({ kind: 'setListType' }, (o) => w.setListType(o.ids, o.list))
    .with({ kind: 'setChecked' }, (o) => w.setChecked(o.id, o.checked))
    .with({ kind: 'setIndent' }, (o) => w.setIndent(o.id, o.indent))
    .with({ kind: 'sortList' }, (o) => w.sortList(o.id, o.order))
    .with({ kind: 'insertBlock' }, (o) => w.insertNode(o.ref, o.spec, o.at))
    .with({ kind: 'insertInline' }, (o) => w.insertInline(o.ref, o.id, o.at, o.spec))
    .with({ kind: 'moveBlock' }, (o) => w.moveNode(o.id, o.at))
    .with({ kind: 'removeBlock' }, (o) => w.removeNode(o.id))
    .with({ kind: 'mergeBlocks' }, (o) => w.mergeBlocks(o.ids, o.separator))
    .with({ kind: 'splitBlock' }, (o) => w.splitBlock(o.id, o.atText))
    .with({ kind: 'setCell' }, (o) => w.setCell(o.table, o.row, o.col, o.content))
    .with({ kind: 'addRow' }, (o) => w.addRow(o.table, o.at))
    .with({ kind: 'addColumn' }, (o) => w.addColumn(o.table, o.at))
    .with({ kind: 'removeRow' }, (o) => w.removeRow(o.table, o.row))
    .with({ kind: 'removeColumn' }, (o) => w.removeColumn(o.table, o.col))
    .with({ kind: 'setImageAlt' }, (o) => w.setImageAlt(o.id, o.alt))
    .with({ kind: 'setImageUrl' }, (o) => w.setImageUrl(o.id, o.url))
    .with({ kind: 'setVideoUrl' }, (o) => w.setVideoUrl(o.id, o.url))
    .with({ kind: 'setVideoControls' }, (o) => w.setVideoControls(o.id, o.controls))
    .with({ kind: 'setDate' }, (o) => w.setDate(o.id, o.date, o.displayFormat))
    .exhaustive();
}

/** Map a structured `Edit` (Y) onto its `DocWriter` method. */
export function applyEdit(w: DocWriter, y: Edit): void {
  match(y)
    .with({ fn: 'insertText' }, (e) => w.insertText(e.node, e.at, e.text))
    .with({ fn: 'removeText' }, (e) => w.removeText(e.node, e.at, e.len))
    .with({ fn: 'setText' }, (e) => w.setText(e.node, e.text))
    .with({ fn: 'setEquation' }, (e) => w.setEquation(e.node, e.tex))
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
    .with({ fn: 'setImageAlt' }, (e) => w.setImageAlt(e.node, e.alt))
    .with({ fn: 'setImageUrl' }, (e) => w.setImageUrl(e.node, e.url))
    .with({ fn: 'setVideoUrl' }, (e) => w.setVideoUrl(e.node, e.url))
    .with({ fn: 'setVideoControls' }, (e) => w.setVideoControls(e.node, e.controls))
    .with({ fn: 'setDate' }, (e) => w.setDate(e.node, e.date, e.displayFormat))
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
    .with({ kind: 'setEquation' }, (o) => `set equation {${o.id}} to "${truncate(o.tex)}"`)
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
    .with({ kind: 'setImageAlt' }, (o) => `set {${o.id}} image alt to "${truncate(o.alt)}"`)
    .with({ kind: 'setImageUrl' }, (o) => `set {${o.id}} image url to "${truncate(o.url)}"`)
    .with({ kind: 'setVideoUrl' }, (o) => `set {${o.id}} video url to "${truncate(o.url)}"`)
    .with({ kind: 'setVideoControls' }, (o) => `set {${o.id}} video controls ${o.controls}`)
    .with({ kind: 'setDate' }, (o) => `set {${o.id}} date to "${o.date}"`)
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

/** Render only failures; successful ops intentionally produce no detail. */
export function summarize(results: OpResult[]): string {
  const failures = results.filter((r): r is Extract<OpResult, { ok: false }> => !r.ok);
  if (failures.length === 0) return 'ok';
  return failures.map((r) => `error: ${r.op.kind}: ${r.error}`).join('\n');
}
