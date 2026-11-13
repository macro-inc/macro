import type { TableInsertHit } from './table-insert';

export type TableResizeEdge = 'left' | 'right' | 'bottom';

/** One live gesture over dimensions frozen when it started. */
export interface TableResizeDrag {
  readonly axis: 'row' | 'column';
  /** The first apply opens one history entry; later ones merge into it. */
  apply(delta: number): void;
  /**
   * Escape / pointercancel: back to the pre-drag width or height. A no-op
   * when nothing was applied yet.
   */
  restore(): void;
}

/**
 * Backend operations behind the shared TableCellResizer markup and gesture
 * loop (hover strips, touch swipe arming, pointer capture, cursor, rAF).
 */
export interface TableResizeHost<Hit extends TableInsertHit> {
  /** null ignores an unavailable target; undefined clears the hovered cell. */
  cellFromTarget(target: EventTarget | null): Hit | null | undefined;
  isEditable(): boolean;
  /** Source calculateZoomLevel over the cell. */
  zoom(cell: Hit): number;
  /** Capture the gesture's snapshot; undefined refuses it. */
  beginDrag(
    cell: Hit,
    edge: TableResizeEdge,
    zoom: number
  ): TableResizeDrag | undefined;
  /**
   * Resolve the cell's model identity for the drag, after pointer capture
   * (Source reads the cell's node key here). undefined when it has none.
   */
  pinCell(cell: Hit): Hit | undefined;
  /** A pinned cell's current element, re-resolved after its row DOM is recreated. */
  elementFor(cell: Hit): HTMLElement | undefined;
  registerRoot(listeners: {
    pointermove: (event: PointerEvent) => void;
    pointerdown: (event: PointerEvent) => void;
  }): () => void;
  /** Model commits and editor width changes that move the strips. */
  registerLayout(listener: () => void): () => void;
}
