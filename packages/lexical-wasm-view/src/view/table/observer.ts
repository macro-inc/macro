/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * MIT licensed. TableObserver DOM grid and pointer selection retargeted from
 * @lexical/table 0.45.0, 0cfcc169296723e07de2396cd42ea3434b5b79ed.
 */
import type { EditorView } from '../editor-view';

export interface DOMCell {
  readonly element: HTMLTableCellElement;
  readonly key: number;
  readonly x: number;
  readonly y: number;
  readonly colSpan: number;
  readonly rowSpan: number;
}
const observers = new WeakMap<HTMLTableElement, TableObserver>();
export function getDOMCellFromTarget(
  target: EventTarget | null
): HTMLTableCellElement | null {
  if (!(target instanceof Element)) return null;
  const cell = target.closest('td,th');
  return cell instanceof HTMLTableCellElement ? cell : null;
}
export function getTableElement(element: Element): HTMLTableElement | null {
  const table = element.closest('table');
  return table instanceof HTMLTableElement ? table : null;
}
export function getTableObserverFromTableElement(
  table: HTMLTableElement
): TableObserver | null {
  return observers.get(table) ?? null;
}
export class TableObserver {
  private grid: DOMCell[][] = [];
  private cells = new Map<number, DOMCell>();
  private anchor: number | null = null;
  private focus: number | null = null;
  private dragging = false;
  constructor(
    readonly view: EditorView,
    readonly key: number,
    readonly table: HTMLTableElement
  ) {
    observers.set(table, this);
    table.addEventListener('pointerdown', this.down);
    table.ownerDocument.addEventListener('pointermove', this.move);
    table.ownerDocument.addEventListener('pointerup', this.up);
    this.refresh();
  }
  refresh(): void {
    this.grid = [];
    this.cells.clear();
    const table = this.view.node(this.key);
    if (!table) return;
    table.children.forEach((rowKey, y) => {
      const row = this.view.node(rowKey);
      if (!row) return;
      let x = 0;
      for (const key of row.children) {
        while (this.grid[y]?.[x]) x++;
        const element = this.view.getElementByKey(key),
          node = this.view.node(key);
        if (!(element instanceof HTMLTableCellElement) || !node) continue;
        const props = node.props();
        const colSpan = typeof props.colSpan === 'number' ? props.colSpan : 1;
        const rowSpan = typeof props.rowSpan === 'number' ? props.rowSpan : 1;
        const cell = { element, key, x, y, colSpan, rowSpan };
        this.cells.set(key, cell);
        for (let dy = 0; dy < rowSpan; dy++) {
          const line = this.grid[y + dy] ?? [];
          this.grid[y + dy] = line;
          for (let dx = 0; dx < colSpan; dx++) line[x + dx] = cell;
        }
        x += colSpan;
      }
    });
    this.paint();
  }
  getGrid(): readonly (readonly DOMCell[])[] {
    return this.grid;
  }
  select(anchor: number, focus: number): void {
    if (!this.cells.has(anchor) || !this.cells.has(focus)) return;
    this.anchor = anchor;
    this.focus = focus;
    this.paint();
  }
  clear(): void {
    this.anchor = this.focus = null;
    this.paint();
  }
  private paint(): void {
    const anchor =
      this.anchor === null ? undefined : this.cells.get(this.anchor);
    const focus = this.focus === null ? undefined : this.cells.get(this.focus);
    const selected = new Set<number>();
    if (anchor && focus) {
      let left = Math.min(anchor.x, focus.x),
        top = Math.min(anchor.y, focus.y);
      let right = Math.max(
        anchor.x + anchor.colSpan - 1,
        focus.x + focus.colSpan - 1
      );
      let bottom = Math.max(
        anchor.y + anchor.rowSpan - 1,
        focus.y + focus.rowSpan - 1
      );
      let expanded = true;
      while (expanded) {
        expanded = false;
        for (let y = top; y <= bottom; y++)
          for (let x = left; x <= right; x++) {
            const cell = this.grid[y]?.[x];
            if (!cell) continue;
            selected.add(cell.key);
            const nextLeft = Math.min(left, cell.x),
              nextTop = Math.min(top, cell.y);
            const nextRight = Math.max(right, cell.x + cell.colSpan - 1),
              nextBottom = Math.max(bottom, cell.y + cell.rowSpan - 1);
            if (
              nextLeft !== left ||
              nextTop !== top ||
              nextRight !== right ||
              nextBottom !== bottom
            )
              expanded = true;
            left = nextLeft;
            top = nextTop;
            right = nextRight;
            bottom = nextBottom;
          }
      }
    }
    for (const cell of this.cells.values()) {
      cell.element.toggleAttribute(
        'data-lexical-table-selected',
        selected.has(cell.key)
      );
      cell.element.setAttribute(
        'aria-selected',
        String(selected.has(cell.key))
      );
    }
  }
  private keyFromTarget(target: EventTarget | null): number | null {
    const cell = getDOMCellFromTarget(target);
    if (!cell || getTableElement(cell) !== this.table) return null;
    const key = this.view.keyFromDOM(cell);
    return key !== null && this.cells.has(key) ? key : null;
  }
  private down = (event: PointerEvent): void => {
    const key = this.keyFromTarget(event.target);
    if (key === null || event.button !== 0) return;
    if (!event.shiftKey || this.anchor === null) this.anchor = key;
    this.dragging = true;
    if (event.shiftKey) {
      event.preventDefault();
      this.submit(key);
    }
  };
  private move = (event: PointerEvent): void => {
    if (!this.dragging || this.anchor === null) return;
    const key = this.keyFromTarget(event.target);
    if (
      key === null ||
      key === this.focus ||
      (key === this.anchor && this.focus === null)
    )
      return;
    event.preventDefault();
    this.submit(key);
  };
  private up = (): void => {
    this.dragging = false;
  };
  private submit(key: number): void {
    if (this.anchor === null) return;
    this.select(this.anchor, key);
    this.view.port.selectionFromView({
      kind: 'table',
      table: this.key,
      anchorCell: this.anchor,
      focusCell: key,
    });
  }
  dispose(): void {
    this.table.removeEventListener('pointerdown', this.down);
    this.table.ownerDocument.removeEventListener('pointermove', this.move);
    this.table.ownerDocument.removeEventListener('pointerup', this.up);
    observers.delete(this.table);
    this.clear();
  }
}
