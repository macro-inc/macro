import type { TableInsertHit } from './table-insert';

export type TableDeleteAxis = 'row' | 'column' | 'table';

export interface TableDeletePixels {
  deleteRowTop: number;
  deleteRowBottom: number;
  deleteColLeft: number;
  deleteColRight: number;
  selectedRowCount: number;
  selectedColumnCount: number;
}

export interface TableDeleteHost<Hit extends TableInsertHit> {
  cellFromTarget(target: EventTarget | null): Hit | null | undefined;
  selectionPixels(cell: Hit, rect: DOMRect): TableDeletePixels;
  deleteAt(cell: Hit, axis: TableDeleteAxis): 'keep-target' | 'clear-target';
  registerScroll(listener: () => void): () => void;
  registerRoot(
    listener: (event: PointerEvent) => void
  ): (() => void) | undefined;
}

export function cellDeletePixels(rect: DOMRect): TableDeletePixels {
  return {
    deleteRowTop: rect.top,
    deleteRowBottom: rect.bottom,
    deleteColLeft: rect.left,
    deleteColRight: rect.right,
    selectedRowCount: 1,
    selectedColumnCount: 1,
  };
}
