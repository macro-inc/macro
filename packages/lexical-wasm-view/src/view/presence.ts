import type { IViewEffectMsg } from '@macro-inc/collaboration/session/abi.generated';
import type { EditorView } from './editor-view';
import { createDOMRange, createRectsFromDOMRange } from './selection';
import type { Point } from './types';

interface PeerCursor {
  readonly key: string;
  readonly color: string;
  readonly anchor: Point;
  readonly focus: Point;
}
/** Remote cursor geometry is measured after apply, never on the input stack. */
export class PresenceLayer {
  private readonly layer: HTMLDivElement;
  private readonly window: Window;
  private peers: PeerCursor[] = [];
  private frame: number | null = null;
  constructor(private readonly view: EditorView) {
    const doc = view.root.ownerDocument;
    if (!doc.defaultView) throw new Error('Presence requires an owning window');
    this.window = doc.defaultView;
    this.layer = doc.createElement('div');
    this.layer.dataset.remoteCursors = view.options.namespace;
    this.layer.setAttribute('aria-hidden', 'true');
    this.layer.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:10;';
    doc.body.append(this.layer);
    this.window.addEventListener('scroll', this.schedule, true);
    this.window.addEventListener('resize', this.schedule);
  }
  update(effects: readonly IViewEffectMsg[]): void {
    for (const effect of effects) {
      if (effect.kind !== 10) continue;
      if (effect.flag) this.peers = [];
      else if (effect.selection.kind === 2) {
        const key = effect.keys[0],
          color = effect.keys[1];
        if (key === undefined || color === undefined)
          throw new Error('Malformed remote cursor effect');
        const point = (p: typeof effect.selection.anchor): Point => ({
          key: p.key,
          offset: p.offset,
          type: p.type === 0 ? 'text' : 'element',
        });
        this.peers.push({
          key,
          color,
          anchor: point(effect.selection.anchor),
          focus: point(effect.selection.focus),
        });
      }
    }
    this.schedule();
  }
  readonly schedule = (): void => {
    if (
      this.frame !== null ||
      (!this.peers.length && !this.layer.childElementCount)
    )
      return;
    this.frame = this.window.requestAnimationFrame(() => {
      this.frame = null;
      this.paint();
    });
  };
  private paint(): void {
    const doc = this.view.root.ownerDocument;
    const fragment = doc.createDocumentFragment();
    for (const peer of this.peers) {
      const range = createDOMRange(this.view, peer.anchor, peer.focus);
      const caretRange = createDOMRange(this.view, peer.focus, peer.focus);
      if (!range || !caretRange) continue;
      const color = CSS.supports('color', peer.color)
        ? peer.color
        : 'var(--color-accent, #2563eb)';
      for (const rect of createRectsFromDOMRange(range)) {
        const highlight = doc.createElement('span');
        highlight.dataset.remoteSelection = peer.key;
        Object.assign(highlight.style, {
          position: 'absolute',
          left: `${rect.left}px`,
          top: `${rect.top}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          backgroundColor: color,
          opacity: '0.2',
        });
        fragment.append(highlight);
      }
      const rect = caretRange.getBoundingClientRect();
      if (!rect.height) continue;
      const caret = doc.createElement('span');
      caret.dataset.remoteCursor = peer.key;
      Object.assign(caret.style, {
        position: 'absolute',
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: '2px',
        height: `${rect.height}px`,
        backgroundColor: color,
      });
      fragment.append(caret);
    }
    this.layer.replaceChildren(fragment);
  }
  dispose(): void {
    if (this.frame !== null) this.window.cancelAnimationFrame(this.frame);
    this.window.removeEventListener('scroll', this.schedule, true);
    this.window.removeEventListener('resize', this.schedule);
    this.layer.remove();
  }
}
