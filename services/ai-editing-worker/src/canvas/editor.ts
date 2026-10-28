import type { CanvasUserMention } from './mentions';
import type { CanvasOp, TextFitMode } from './schema';

/** Sandboxed command builder. Only the host can validate and commit commands. */
export class CanvasEditor {
  private readonly ops: CanvasOp[] = [];
  constructor(private readonly refs: string[]) {}
  private nextId() {
    const id = this.refs.shift();
    if (!id) throw new Error('At most 100 new items per snippet.');
    return id;
  }
  private add(op: CanvasOp) {
    if (this.ops.length >= 100)
      throw new Error('At most 100 operations per snippet.');
    this.ops.push(op);
  }
  create(
    options: Omit<Extract<CanvasOp, { kind: 'create' }>, 'kind' | 'id'>
  ): string {
    const id = this.nextId();
    this.add({ ...options, kind: 'create', id });
    return id;
  }
  connect(
    options: Omit<
      Extract<CanvasOp, { kind: 'connect' }>,
      'kind' | 'id' | 'route'
    > & { route?: 'straight' | 'stepped' | 'smooth' }
  ): string {
    const id = this.nextId();
    this.add({
      ...options,
      route: options.route ?? 'stepped',
      kind: 'connect',
      id,
    });
    return id;
  }
  move(ids: string[], dx: number, dy: number) {
    this.add({ kind: 'move', ids, dx, dy });
  }
  resize(id: string, width: number, height: number, fitText?: TextFitMode) {
    this.add({ kind: 'resize', id, width, height, fitText });
  }
  style(ids: string[], style: Extract<CanvasOp, { kind: 'style' }>['style']) {
    this.add({ kind: 'style', ids, style });
  }
  text(id: string, text: string, fitText?: TextFitMode) {
    this.add({ kind: 'text', id, text, fitText });
  }
  mentionUser(
    id: string,
    at: number,
    person: CanvasUserMention,
    fitText?: TextFitMode
  ) {
    this.add({ kind: 'mentionUser', id, at, person, fitText });
  }
  /** Grow measured text at a sensible width unless an explicit fixed policy is requested. */
  fitText(id: string, mode: TextFitMode = 'grow', width?: number) {
    this.add({ kind: 'fitText', id, mode, width });
  }
  textStyle(
    id: string,
    style: Omit<Extract<CanvasOp, { kind: 'textStyle' }>, 'kind' | 'id'>
  ) {
    this.add({ ...style, kind: 'textStyle', id });
  }
  delete(ids: string[]) {
    this.add({ kind: 'delete', ids });
  }
  group(ids: string[]): string {
    const id = this.nextId();
    this.add({ kind: 'group', ids, id });
    return id;
  }
  ungroup(id: string) {
    this.add({ kind: 'ungroup', id });
  }
  reparent(id: string, parentId: string) {
    this.add({ kind: 'reparent', id, parentId });
  }
  order(
    ids: string[],
    position: Extract<CanvasOp, { kind: 'order' }>['position']
  ) {
    this.add({ kind: 'order', ids, position });
  }
  drain(): CanvasOp[] {
    return this.ops.splice(0);
  }
}
