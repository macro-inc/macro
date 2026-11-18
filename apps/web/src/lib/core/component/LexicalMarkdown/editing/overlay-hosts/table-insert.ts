export type TableInsertAxis = 'row' | 'column';
export type TableBorderSide = 'start' | 'end';

export interface TableInsertHit {
  readonly element: HTMLElement;
}

/** Backend operations for the unchanged border geometry and markup. */
export interface TableInsertHost<Key, Hit extends TableInsertHit> {
  /** null ignores an unavailable/non-element hit; undefined clears an empty hit. */
  cellFromTarget(target: EventTarget | null): Hit | null | undefined;
  referenceForBorder(
    cell: Hit,
    axis: TableInsertAxis,
    side: TableBorderSide
  ): { key: Key; table: HTMLElement } | undefined;
  /** UI disposition only; this is never a model publication receipt. */
  insertAfter(key: Key, axis: TableInsertAxis): 'keep-target' | 'clear-target';
  registerScroll(listener: () => void): () => void;
  registerRoot(
    listener: (event: PointerEvent) => void
  ): (() => void) | undefined;
}
