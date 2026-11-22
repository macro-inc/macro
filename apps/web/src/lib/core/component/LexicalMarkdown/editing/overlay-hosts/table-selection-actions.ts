/** The cells a table selection spans, as the action bar tracks them. */
export interface TableSelectionCells<Key> {
  /** Each corner resolves on its own; a corner outside a cell is undefined. */
  readonly anchor: Key | undefined;
  readonly focus: Key | undefined;
  /** Some selected cell spans more than one row or column. */
  readonly merged: boolean;
}

/** Backend operations behind the shared touch table selection action bar. */
export interface TableSelectionActionsHost<Key> {
  /** The live table selection's cells; undefined hides the bar. */
  tracked(): TableSelectionCells<Key> | undefined;
  registerSelection(listener: () => void): () => void;
  /** Every editor update: the bar re-tracks and re-measures. */
  registerLayout(listener: () => void): () => void;
  registerBlur(listener: () => void): () => void;
  elementFor(key: Key): HTMLElement | undefined;
  /** Clipboard MIME strings for the table selection; null without one. */
  clipboardData(): Record<string, string | undefined> | null;
  /** Clear the selected cells as Backspace does, collapsing the selection. */
  clearCells(): void;
  clearSelection(): void;
  /** Merge the selected cells and clear the selection; the view ignores any result. */
  merge(): void;
  /** Split the merged cell at the selection and clear the selection; the view ignores any result. */
  split(): void;
  /** Paste into the table or range selection, then clear the selection. */
  paste(data: DataTransfer): void;
}
