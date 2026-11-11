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
interface Carry {
  readonly cell: DOMCell;
  readonly remaining: number;
}
interface RowGrid {
  readonly keys: readonly number[];
  readonly owned: ReadonlySet<number>;
  readonly outgoing: readonly (Carry | undefined)[];
}
export function sameCarry(
  a: readonly (Carry | undefined)[],
  b: readonly (Carry | undefined)[]
): boolean {
  if (a.length !== b.length) return false;
  for (let x = 0; x < a.length; x++) {
    if (a[x]?.cell !== b[x]?.cell || a[x]?.remaining !== b[x]?.remaining)
      return false;
  }
  return true;
}
export class TableObserver {
  private rows: readonly number[] = [];
  private rowPositions = new Map<number, number>();
  private grid = new Map<number, RowGrid>();
  private domGrid: DOMCell[][] = [];
  private selected = new Set<number>();
  private selectionBounds: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  } | null = null;
  private cells = new Map<number, DOMCell>();
  private anchor: number | null = null;
  private focus: number | null = null;
  private pointerId: number | null = null;
  constructor(
    readonly view: EditorView,
    readonly key: number,
    readonly table: HTMLTableElement
  ) {
    observers.set(table, this);
    table.addEventListener('pointerdown', this.down);
    table.ownerDocument.addEventListener('pointermove', this.move);
    table.ownerDocument.addEventListener('pointerup', this.up);
    table.ownerDocument.addEventListener('pointercancel', this.up);
    this.refresh();
  }
  /** Row topology and explicit dirty rows are admitted together before carrying spans. */
  refresh(dirtyRows: ReadonlySet<number> = new Set()): void {
    const table = this.view.node(this.key);
    if (!table) return;
    const changed = new Set<number>();
    let positions: number[];
    if (table.children !== this.rows) {
      const previousRows = this.rows;
      this.rows = table.children;
      if (!this.rows.length) {
        for (const cell of this.cells.values()) this.unpaint(cell);
        this.rowPositions.clear();
        this.grid.clear();
        this.cells.clear();
        this.domGrid.length = 0;
        this.selected.clear();
        this.selectionBounds = null;
        return;
      }
      let first = 0;
      while (
        first < previousRows.length &&
        previousRows[first] === this.rows[first]
      )
        first++;
      for (let y = first; y < previousRows.length; y++)
        this.rowPositions.delete(previousRows[y]);
      for (let y = first; y < this.rows.length; y++)
        this.rowPositions.set(this.rows[y], y);
      positions = Array.from(
        { length: this.rows.length - first },
        (_, offset) => first + offset
      );
      // Retire only removed suffix entries. Retained prefix cells keep their DOM
      // and selection paint when rows are appended or removed at the end.
      for (let y = this.rows.length; y < previousRows.length; y++) {
        for (const key of this.grid.get(y)?.owned ?? []) {
          const cell = this.cells.get(key);
          if (cell) this.unpaint(cell);
          this.cells.delete(key);
          changed.add(key);
        }
        this.grid.delete(y);
        this.domGrid.length = Math.min(this.domGrid.length, this.rows.length);
      }
    } else positions = [];
    for (const key of dirtyRows) {
      const y = this.rowPositions.get(key);
      if (y !== undefined) positions.push(y);
    }
    positions = [...new Set(positions)].sort((a, b) => a - b);
    if (
      !positions.length &&
      this.grid
        .get(this.rows.length - 1)
        ?.outgoing.some((carry) => carry !== undefined)
    )
      positions.push(this.rows.length);
    let through = -1;
    for (const start of positions) {
      if (start <= through) continue;
      for (
        let y = start;
        y < this.rows.length ||
        this.grid.has(y) ||
        this.grid.get(y - 1)?.outgoing.some((carry) => carry !== undefined);
        y++
      ) {
        const old = this.grid.get(y);
        const next = this.buildRow(y, changed);
        if (y >= this.rows.length && !next.keys.length) {
          this.grid.delete(y);
          this.domGrid.length = Math.min(this.domGrid.length, y);
          through = y;
          continue;
        }
        this.grid.set(y, next);
        this.domGrid[y] = next.keys.map((key) => {
          const cell = this.cells.get(key);
          if (!cell) throw new Error('Missing table grid cell');
          return cell;
        });
        through = y;
        if (old && sameCarry(old.outgoing, next.outgoing)) break;
      }
    }
    this.paint(changed);
  }
  private buildRow(y: number, changed: Set<number>): RowGrid {
    const previous = this.grid.get(y);
    const incoming = this.grid.get(y - 1)?.outgoing ?? [];
    const keys: number[] = [];
    const outgoing: (Carry | undefined)[] = [];
    incoming.forEach((carry, x) => {
      if (!carry) return;
      keys[x] = carry.cell.key;
      if (carry.remaining > 1)
        outgoing[x] = { cell: carry.cell, remaining: carry.remaining - 1 };
    });
    const owned = new Set<number>();
    let x = 0;
    const rowKey = this.rows[y];
    const children =
      rowKey === undefined ? [] : (this.view.node(rowKey)?.children ?? []);
    for (const key of children) {
      while (keys[x] !== undefined) x++;
      const element = this.view.getElementByKey(key),
        node = this.view.node(key);
      if (!(element instanceof HTMLTableCellElement) || !node) continue;
      const props = node.props();
      const colSpan = typeof props.colSpan === 'number' ? props.colSpan : 1;
      const rowSpan = typeof props.rowSpan === 'number' ? props.rowSpan : 1;
      const old = this.cells.get(key);
      const unchanged =
        old &&
        old.element === element &&
        old.x === x &&
        old.y === y &&
        old.colSpan === colSpan &&
        old.rowSpan === rowSpan;
      const cell = unchanged ? old : { element, key, x, y, colSpan, rowSpan };
      if (!old || old.element !== element) {
        if (old) this.unpaint(old);
        this.unpaint(cell);
      }
      this.cells.set(key, cell);
      owned.add(key);
      if (!unchanged) changed.add(key);
      for (let dx = 0; dx < colSpan; dx++) {
        keys[x + dx] = key;
        if (rowSpan > 1) outgoing[x + dx] = { cell, remaining: rowSpan - 1 };
      }
      x += colSpan;
    }
    for (const key of previous?.owned ?? []) {
      if (owned.has(key)) continue;
      const old = this.cells.get(key);
      if (old?.y !== y) continue;
      this.unpaint(old);
      this.cells.delete(key);
      changed.add(key);
    }
    return { keys, owned, outgoing };
  }
  getGrid(): readonly (readonly DOMCell[])[] {
    return this.domGrid;
  }
  select(anchor: number, focus: number): void {
    if (!this.cells.has(anchor) || !this.cells.has(focus)) return;
    if (this.anchor === anchor && this.focus === focus) return;
    this.anchor = anchor;
    this.focus = focus;
    this.paint();
  }
  clear(): void {
    if (this.anchor === null && this.focus === null) return;
    this.anchor = this.focus = null;
    this.paint();
  }
  private unpaint(cell: DOMCell): void {
    if (getTableElement(cell.element) !== this.table) return;
    cell.element.removeAttribute('data-lexical-table-selected');
    cell.element.setAttribute('aria-selected', 'false');
  }
  private paint(changed?: ReadonlySet<number>): void {
    if (changed) {
      const bounds = this.selectionBounds;
      const intersects = [...changed].some((key) => {
        if (key === this.anchor || key === this.focus || this.selected.has(key))
          return true;
        const cell = this.cells.get(key);
        return (
          bounds &&
          cell &&
          cell.x <= bounds.right &&
          cell.x + cell.colSpan > bounds.left &&
          cell.y <= bounds.bottom &&
          cell.y + cell.rowSpan > bounds.top
        );
      });
      if (!intersects) return;
    }
    this.selectionBounds = null;
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
      const rectangles = [{ left, top, right, bottom }];
      // Visit only newly exposed strips when a merged cell expands the bounds.
      for (let i = 0; i < rectangles.length; i++) {
        const area = rectangles[i];
        for (let y = area.top; y <= area.bottom; y++) {
          for (let x = area.left; x <= area.right; x++) {
            const key = this.grid.get(y)?.keys[x];
            const cell = key === undefined ? undefined : this.cells.get(key);
            if (!cell || selected.has(cell.key)) continue;
            selected.add(cell.key);
            const nextLeft = Math.min(left, cell.x),
              nextTop = Math.min(top, cell.y);
            const nextRight = Math.max(right, cell.x + cell.colSpan - 1);
            const nextBottom = Math.max(bottom, cell.y + cell.rowSpan - 1);
            if (nextTop < top)
              rectangles.push({
                left: nextLeft,
                top: nextTop,
                right: nextRight,
                bottom: top - 1,
              });
            if (nextBottom > bottom)
              rectangles.push({
                left: nextLeft,
                top: bottom + 1,
                right: nextRight,
                bottom: nextBottom,
              });
            if (nextLeft < left)
              rectangles.push({ left: nextLeft, top, right: left - 1, bottom });
            if (nextRight > right)
              rectangles.push({
                left: right + 1,
                top,
                right: nextRight,
                bottom,
              });
            left = nextLeft;
            top = nextTop;
            right = nextRight;
            bottom = nextBottom;
          }
        }
      }
      this.selectionBounds = { left, top, right, bottom };
    }
    for (const key of this.selected) {
      if (selected.has(key)) continue;
      const cell = this.cells.get(key);
      if (cell) this.unpaint(cell);
    }
    for (const key of selected) {
      if (this.selected.has(key) && !changed?.has(key)) continue;
      const cell = this.cells.get(key);
      if (!cell) continue;
      cell.element.setAttribute('data-lexical-table-selected', '');
      cell.element.setAttribute('aria-selected', 'true');
    }
    this.selected = selected;
  }
  private keyFromTarget(target: EventTarget | null): number | null {
    const cell = getDOMCellFromTarget(target);
    if (!cell || getTableElement(cell) !== this.table) return null;
    const key = this.view.keyFromDOM(cell);
    return key !== null && this.cells.has(key) ? key : null;
  }
  private down = (event: PointerEvent): void => {
    const key = this.keyFromTarget(event.target);
    if (
      key === null ||
      event.button !== 0 ||
      event.pointerType === 'touch' ||
      this.view.root.contentEditable !== 'true'
    )
      return;
    if (!event.shiftKey || this.anchor === null) this.anchor = key;
    this.pointerId = event.pointerId;
    if (event.shiftKey) {
      event.preventDefault();
      this.submit(key);
    }
  };
  private move = (event: PointerEvent): void => {
    if (this.pointerId !== event.pointerId || this.anchor === null) return;
    if (this.view.root.contentEditable !== 'true') {
      this.pointerId = null;
      return;
    }
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
  private up = (event: PointerEvent): void => {
    if (event.pointerId === this.pointerId) this.pointerId = null;
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
    this.table.ownerDocument.removeEventListener('pointercancel', this.up);
    this.pointerId = null;
    observers.delete(this.table);
    this.clear();
  }
}
