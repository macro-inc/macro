import type { EditorView } from './editor-view';
import { createViewCommand } from './commands';
import { createDOMRange, readSelection, resolvePoint } from './selection';
import type { Point, ViewSelection } from './types';

export interface InternalDrop {
  readonly event: DragEvent;
  readonly source: EditorView;
  readonly keys: readonly number[];
  readonly point: Point;
  readonly sourceRevision: number;
}
/** Application move handlers own the Rust command; this layer owns DOM drag facts. */
export const INTERNAL_DROP_COMMAND = createViewCommand(
  'InternalDrop',
  (value): value is InternalDrop => {
    if (!value || typeof value !== 'object') return false;
    return (
      'event' in value &&
      'source' in value &&
      'point' in value &&
      'sourceRevision' in value &&
      'keys' in value &&
      Array.isArray(value.keys) &&
      value.keys.every((key) => Number.isInteger(key))
    );
  }
);
export const DRAG_START_COMMAND = createViewCommand(
  'DragStart',
  (event): event is DragEvent => event instanceof DragEvent
);
export const DRAG_OVER_COMMAND = createViewCommand(
  'Dragover',
  (event): event is DragEvent => event instanceof DragEvent
);
export const DRAG_END_COMMAND = createViewCommand(
  'DragEnd',
  (event): event is DragEvent => event instanceof DragEvent
);
const MIME = 'application/x-lexical-drag';
let nextDrag = 0;
let active: {
  source: EditorView;
  keys: readonly number[];
  payload: string;
  revision: number;
} | null = null;

export class DragAccess {
  private caret: HTMLElement | null = null;
  constructor(private readonly view: EditorView) {}
  start(event: DragEvent): void {
    const view = this.view;
    if (view.runViewCommand('DragStart', event, 'before')) return;
    if (!event.dataTransfer || !(event.target instanceof Element)) return;
    const key = view.keyFromDOM(event.target);
    const node = key === null ? null : view.node(key);
    if (
      !node ||
      (node.kind !== 'decorator' &&
        !event.target.closest('[data-lexical-block-handle]'))
    )
      return;
    const selection = view.selection().selection;
    const keys =
      selection.kind === 'node' && selection.keys.includes(node.key)
        ? selection.keys
        : [node.key];
    view.port.selectionFromView({ kind: 'node', keys });
    const formats = view.clipboard.formats();
    event.dataTransfer.setData('text/plain', formats.plain);
    event.dataTransfer.setData('text/html', formats.html);
    event.dataTransfer.setData('application/x-lexical-editor', formats.lexical);
    const payload = JSON.stringify({
      editor: view.options.namespace,
      drag: ++nextDrag,
      keys,
    });
    event.dataTransfer.setData(MIME, payload);
    event.dataTransfer.effectAllowed = 'copyMove';
    active = { source: view, keys, payload, revision: view.revision };
    view.runViewCommand('DragStart', event, 'after');
  }
  point(event: DragEvent): Point | null {
    const doc = this.view.root.ownerDocument;
    const range = doc.caretRangeFromPoint(event.clientX, event.clientY);
    if (!range || !this.view.root.contains(range.startContainer)) return null;
    return resolvePoint(this.view, range.startContainer, range.startOffset);
  }
  over(event: DragEvent): void {
    if (this.view.runViewCommand('Dragover', event, 'before')) return;
    event.preventDefault();
    const point = this.point(event);
    if (point) {
      const range = createDOMRange(this.view, point, point);
      if (range) {
        const rect = range.getBoundingClientRect();
        if (!this.caret) {
          this.caret = this.view.root.ownerDocument.createElement('div');
          this.caret.dataset.lexicalDropCaret = this.view.options.namespace;
          this.view.root.ownerDocument.body.append(this.caret);
        }
        Object.assign(this.caret.style, {
          position: 'fixed',
          pointerEvents: 'none',
          background: 'currentColor',
          width: '2px',
          left: `${rect.left}px`,
          top: `${rect.top}px`,
          height: `${rect.height}px`,
        });
      }
    } else this.hide();
    this.view.runViewCommand('Dragover', event, 'after');
  }
  async drop(event: DragEvent): Promise<void> {
    this.hide();
    if (this.view.runViewCommand('Drop', event, 'before')) return;
    if (!event.dataTransfer) return;
    event.preventDefault();
    const point = this.point(event);
    const selection: ViewSelection = point
      ? { kind: 'range', anchor: point, focus: point }
      : readSelection(this.view);
    const payload = event.dataTransfer.getData(MIME);
    if (payload && active?.payload === payload) {
      const drag = active;
      if (
        !point ||
        !drag.source.isMounted ||
        drag.source.revision !== drag.revision
      )
        return;
      const request: InternalDrop = {
        event,
        point,
        source: drag.source,
        keys: drag.keys,
        sourceRevision: drag.revision,
      };
      if (!this.view.runViewCommand('InternalDrop', request, 'before')) {
        // The later application move plugin must handle this atomically in
        // Rust. Do not duplicate the content or delete the source on failure.
        event.dataTransfer.dropEffect = 'none';
      }
    } else {
      this.view.port.selectionFromView(selection);
      await this.view.clipboard.paste(event.dataTransfer, selection);
    }
    this.view.runViewCommand('Drop', event, 'after');
  }
  end(event: DragEvent): void {
    this.hide();
    this.view.runViewCommand('DragEnd', event, 'before');
    if (active?.source === this.view) active = null;
    this.view.runViewCommand('DragEnd', event, 'after');
  }
  private hide(): void {
    this.caret?.remove();
    this.caret = null;
  }
  dispose(): void {
    this.hide();
    if (active?.source === this.view) active = null;
  }
}
