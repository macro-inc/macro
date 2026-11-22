export type TableMoveMenuAction =
  | 'insert-column-left'
  | 'insert-column-right'
  | 'insert-row-below'
  | 'insert-row-above'
  | 'delete-row'
  | 'delete-column'
  | 'split-cell'
  | 'delete-table';

/**
 * The cells the handle represents: a table selection's corners, or one caret
 * cell. Each corner resolves on its own, as Source tracks them: a table
 * selection whose focus is not in a cell keeps its anchor (and merged) for
 * the touch menu; the handle itself needs both.
 */
export interface TableMoveCells<Key> {
  readonly anchor: Key | undefined;
  readonly focus: Key | undefined;
  /** The anchor cell spans more than one row or column. */
  readonly merged: boolean;
}

export interface TableMoveShape {
  readonly rows: number;
  readonly columns: number;
}

export type TableMoveRect = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;

/**
 * Backend operations behind the shared TableMoveHandle markup and drag loop.
 * Operations taking `cells` accept undefined, as Source still opens its
 * read/update when the tracked keys are missing.
 */
export interface TableMoveHost<Key> {
  /**
   * Current tracked cells from the live selection; undefined hides the handle.
   * The Source host reads the active editor state, so call it from a
   * registerSelection listener.
   */
  trackedCells(): TableMoveCells<Key> | undefined;
  registerSelection(listener: () => void): () => void;
  registerFocus(listener: (focused: boolean) => void): () => void;
  registerLayout(listener: () => void): () => void;
  /** The editor root: initial focus and the scroll viewport clamp. */
  rootElement(): HTMLElement | null;
  elementFor(key: Key): HTMLElement | undefined;
  /** The table cell element containing `target` (the drop under the pointer). */
  cellElementFromTarget(target: Element): HTMLElement | undefined;
  /** Row by column footprint of the range; 1x1 when a cell is detached. */
  shape(cells: TableMoveCells<Key> | undefined): TableMoveShape;
  /** Cells the range would land on at `target`, extended for appended rows. */
  previewRect(target: HTMLElement, shape: TableMoveShape): TableMoveRect;
  /**
   * Source $moveCellRange onto the cell under `target`. The view ignores the
   * result: the Source host decides synchronously, the native host settles a
   * queued SessionEdit input and reports its own outcome to its callers.
   */
  move(cells: TableMoveCells<Key> | undefined, target: HTMLElement): void;
  /** Desktop tap: select the cells as a table selection and open its popup. */
  selectCells(cells: TableMoveCells<Key> | undefined): void;
  /**
   * Touch menu: act on the live selection when it is in a table cell,
   * otherwise on the tracked anchor cell (Source runMenuAction).
   */
  menuAction(
    action: TableMoveMenuAction,
    tracked: TableMoveCells<Key> | undefined
  ): void;
}
