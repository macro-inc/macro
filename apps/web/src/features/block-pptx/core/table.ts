/**
 * Table geometry in slide space: where rows, columns, and (merged) cells
 * are, for hit testing, cell editing, range selection, and border dragging.
 */

import type { CellRef, ShapeOutline } from '@core/pptx-engine/types';
import type { Box, Point } from './geometry';

export interface TableGeometry {
  /** Left edge of each column, plus the right edge of the last (length cols + 1). */
  xs: number[];
  /** Top edge of each row, plus the bottom edge of the last (length rows + 1). */
  ys: number[];
}

/** Row and column edges of a table frame (unrotated tables). */
export function tableGeometry(shape: ShapeOutline): TableGeometry | undefined {
  const table = shape.table;
  if (
    !table ||
    table.columnWidths.length === 0 ||
    table.rowHeights.length === 0
  )
    return undefined;
  const heights = table.laidOutRowHeights ?? table.rowHeights;
  const totalW = table.columnWidths.reduce((a, b) => a + b, 0) || shape.w;
  const totalH = heights.reduce((a, b) => a + b, 0) || shape.h;
  // Without laid-out heights, rows are spread over the frame's height.
  const sy = table.laidOutRowHeights ? 1 : shape.h / totalH;
  const sx = shape.w / totalW;
  const xs = [shape.x];
  for (const w of table.columnWidths) xs.push(xs[xs.length - 1] + w * sx);
  const ys = [shape.y];
  for (const h of heights) ys.push(ys[ys.length - 1] + h * sy);
  return { xs, ys };
}

/** The span of the cell at `ref`: itself, or the merge it anchors. */
export function cellSpan(shape: ShapeOutline, ref: CellRef) {
  const cell = shape.table?.cells?.[ref.row]?.[ref.col];
  return { rowSpan: cell?.rowSpan ?? 1, colSpan: cell?.colSpan ?? 1 };
}

/** The anchor of the merge covering `ref` (or `ref` itself). */
export function anchorOf(shape: ShapeOutline, ref: CellRef): CellRef {
  const cells = shape.table?.cells;
  if (!cells) return ref;
  for (let row = ref.row; row >= 0; row--) {
    for (let col = ref.col; col >= 0; col--) {
      const cell = cells[row]?.[col];
      if (!cell || cell.merged) continue;
      if (
        row + (cell.rowSpan ?? 1) > ref.row &&
        col + (cell.colSpan ?? 1) > ref.col
      )
        return { row, col };
    }
  }
  return ref;
}

/** The box of a cell (spanning its merge). */
export function cellBox(
  shape: ShapeOutline,
  g: TableGeometry,
  ref: CellRef
): Box {
  const anchor = anchorOf(shape, ref);
  const { rowSpan, colSpan } = cellSpan(shape, anchor);
  const right = Math.min(anchor.col + colSpan, g.xs.length - 1);
  const bottom = Math.min(anchor.row + rowSpan, g.ys.length - 1);
  return {
    x: g.xs[anchor.col],
    y: g.ys[anchor.row],
    w: g.xs[right] - g.xs[anchor.col],
    h: g.ys[bottom] - g.ys[anchor.row],
    rotation: 0,
  };
}

/** The cell under `p`, or undefined outside the grid. */
export function cellAt(g: TableGeometry, p: Point): CellRef | undefined {
  if (
    p.x < g.xs[0] ||
    p.x > g.xs[g.xs.length - 1] ||
    p.y < g.ys[0] ||
    p.y > g.ys[g.ys.length - 1]
  )
    return undefined;
  let col = 0;
  while (col < g.xs.length - 2 && p.x >= g.xs[col + 1]) col++;
  let row = 0;
  while (row < g.ys.length - 2 && p.y >= g.ys[row + 1]) row++;
  return { row, col };
}

/** A column or row boundary within `slop` of `p` (inner boundaries only). */
export function boundaryAt(
  g: TableGeometry,
  p: Point,
  slop: number
): { kind: 'col' | 'row'; index: number } | undefined {
  const inside =
    p.x >= g.xs[0] - slop &&
    p.x <= g.xs[g.xs.length - 1] + slop &&
    p.y >= g.ys[0] - slop &&
    p.y <= g.ys[g.ys.length - 1] + slop;
  if (!inside) return undefined;
  for (let i = 1; i < g.xs.length; i++)
    if (Math.abs(p.x - g.xs[i]) <= slop) return { kind: 'col', index: i - 1 };
  for (let i = 1; i < g.ys.length; i++)
    if (Math.abs(p.y - g.ys[i]) <= slop) return { kind: 'row', index: i - 1 };
  return undefined;
}

/** Normalized range bounds. */
export function rangeOf(from: CellRef, to: CellRef) {
  return {
    top: Math.min(from.row, to.row),
    bottom: Math.max(from.row, to.row),
    left: Math.min(from.col, to.col),
    right: Math.max(from.col, to.col),
  };
}

/** The box covering a cell range (grown to whole merges). */
export function rangeBox(
  shape: ShapeOutline,
  g: TableGeometry,
  from: CellRef,
  to: CellRef
): Box {
  const r = rangeOf(from, to);
  const a = cellBox(shape, g, { row: r.top, col: r.left });
  const b = cellBox(shape, g, { row: r.bottom, col: r.right });
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
    rotation: 0,
  };
}

/** The next cell in reading order (Tab), skipping covered cells. */
export function nextCell(
  shape: ShapeOutline,
  ref: CellRef,
  direction: 1 | -1
): CellRef | undefined {
  const rows = shape.table?.rowHeights.length ?? 0;
  const cols = shape.table?.columnWidths.length ?? 0;
  let index = ref.row * cols + ref.col;
  const start = anchorOf(shape, ref);
  for (;;) {
    index += direction;
    if (index < 0 || index >= rows * cols) return undefined;
    const cell = { row: Math.floor(index / cols), col: index % cols };
    const anchor = anchorOf(shape, cell);
    if (anchor.row === cell.row && anchor.col === cell.col)
      if (anchor.row !== start.row || anchor.col !== start.col) return cell;
  }
}
