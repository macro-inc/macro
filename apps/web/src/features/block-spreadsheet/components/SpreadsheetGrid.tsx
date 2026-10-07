import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { cellPlainText } from '@macro-inc/spreadsheet/cell-mentions';
import type { ConditionalAppearance } from '@macro-inc/spreadsheet/conditional-formatting';
import {
  literalNumber,
  literalNumberDisplay,
} from '@macro-inc/spreadsheet/number-display';
import type {
  DrawingPlacement,
  SheetChart,
  SheetDrawing,
} from '@macro-inc/spreadsheet/sheet-drawings';
import { createElementSize } from '@solid-primitives/resize-observer';
import {
  createEffect,
  createMemo,
  createSelector,
  createSignal,
  createUniqueId,
  For,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import type { SpreadsheetCommentsCapability } from '../context/spreadsheet-comments';
import type { SpreadsheetMentions } from '../context/spreadsheet-mentions';
import { SPREADSHEET_CLIPBOARD_TYPE } from '../core/cell-copy';
import type { ChartData } from '../core/chart-data';
import type {
  FormulaReferenceSpan,
  FormulaTextSelection,
  ReferenceHighlight,
} from '../core/formula-reference';
import {
  type CellPosition,
  type CellSelection,
  cellAddress,
  GRID_COLUMNS,
  GRID_ROWS,
  selectionBounds,
} from '../core/grid-selection';
import {
  columnName,
  DEFAULT_COLUMN_WIDTH,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  parseCellAddress,
  type SpreadsheetCell,
  type SpreadsheetCells,
} from '../core/spreadsheet-document';
import type { SpreadsheetCursor } from '../core/spreadsheet-presence';
import type { CompleteFormula } from '../primitives/create-formula-assistance';
import { CellListMenu } from './CellListMenu';
import { ConditionalIcon } from './ConditionalIcon';
import {
  cellBackground,
  cellBorderColor,
  cellForeground,
  dataBarBackground,
} from './cell-colors';
import { FormulaInput } from './FormulaInput';
import { type DrawingRect, SheetDrawingLayer } from './SheetDrawingLayer';
import { type CellAction, SpreadsheetCellMenu } from './SpreadsheetCellMenu';
import {
  type HeaderAction,
  SpreadsheetHeaderMenu,
} from './SpreadsheetHeaderMenu';

export type GridValue = {
  display: string;
  number?: number;
  error?: string;
  warning?: string;
  conditional?: ConditionalAppearance;
};

const ROW_HEIGHT = 21;
const COLUMN_HEADER_HEIGHT = 24;
const LIST_BUTTON_SIZE = 18;
const ROW_HEADER_WIDTH = 46;
const CELL_PADDING_X = 3;
const CELL_PADDING_Y = 2;
const CELL_LINE_HEIGHT = 1.2;
const MAX_ROW_HEIGHT = 160;
const TOUCH_SLOP = 8;

export function renderedSelectionCell(
  root: ParentNode | undefined,
  selection: CellSelection
) {
  if (!root) return;
  const anchor = root.querySelector<HTMLElement>(
    `[data-address="${cellAddress(selection.anchor)}"]`
  );
  if (anchor) return anchor;
  const area = selectionBounds(selection);
  return [...root.querySelectorAll<HTMLElement>('[data-address]')].find(
    (element) => {
      const position = parseCellAddress(element.dataset.address ?? '');
      return (
        position &&
        position.row >= area.top &&
        position.row <= area.bottom &&
        position.column >= area.left &&
        position.column <= area.right
      );
    }
  );
}

function fontPixels(cell?: SpreadsheetCell, defaultSize = 10) {
  return ((cell?.fontSize ?? defaultSize) * 4) / 3;
}

/** Index of the last offset at or before `position` (offsets ascend). */
function offsetIndex(offsets: number[], position: number) {
  let low = 0;
  let high = offsets.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (offsets[middle] <= position) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** Bound measuring work as well as the maximum automatic row height. */
function wrappedLines(
  text: string,
  width: number,
  measure: (text: string) => number,
  limit: number
) {
  let lines = 1;
  let used = 0;
  for (const token of text.match(/[^\S\n]+|[^\s]+|\n/g) ?? []) {
    if (token === '\n') {
      lines++;
      used = 0;
    } else {
      const size = measure(token);
      if (used && used + size > width) {
        lines++;
        used = 0;
      }
      if (size <= width) used += size;
      else {
        for (const character of token) {
          const characterWidth = measure(character);
          if (used && used + characterWidth > width) {
            lines++;
            used = 0;
          }
          used += characterWidth;
          if (lines >= limit) return limit;
        }
      }
    }
    if (lines >= limit) return limit;
  }
  return lines;
}

export function SpreadsheetGrid(props: {
  cells: SpreadsheetCells;
  comments?: SpreadsheetCommentsCapability;
  mentions?: SpreadsheetMentions;
  sheetId?: string;
  complete?: CompleteFormula;
  rowCount?: number;
  columnCount?: number;
  /** The imported workbook's font for cells without their own. */
  defaultFont?: { name: string; size: number };
  columnWidths?: Record<number, number>;
  rowHeights?: Record<number, number>;
  hiddenRows?: number[];
  hiddenColumns?: number[];
  canChangeStructure?: boolean;
  onCellAction?: (action: Exclude<CellAction, 'comment'>) => void;
  onHeaderAction?: (axis: 'row' | 'column', action: HeaderAction) => void;
  zoom?: number;
  showGridlines?: boolean;
  showFormulas?: boolean;
  onResizeColumn?: (column: number, width: number) => void;
  onResizeRow?: (row: number, height: number | undefined) => void;
  onFill?: (
    source: CellSelection,
    target: CellSelection
  ) => void | Promise<void>;
  onCopyMetadata?: (cut?: boolean) => string;
  values: Record<string, GridValue>;
  /** Excel notes by address, marked in their cells. */
  notes?: Record<string, string>;
  /** The active cell's data validation input message. */
  inputMessage?: { title?: string; message: string };
  /** The active cell's list of allowed values, offered in a dropdown. */
  listItems?: string[];
  onPickListItem?: (item: string) => void;
  /** Images and charts over the sheet. */
  drawings?: SheetDrawing[];
  image?: (key: string) => string | undefined;
  chartData?: (chart: SheetChart) => ChartData;
  /** The text a cell shows, for shapes linked to it. */
  cellText?: (reference: string) => string | undefined;
  onDeleteDrawing?: (id: string) => void;
  /** Move or size a drawing: its new anchors, at 100% zoom. */
  onPlaceDrawing?: (id: string, placement: DrawingPlacement) => void;
  onEditDrawing?: (id: string) => void;
  /** Scroll to a drawing, select it and focus it, once per nonce. */
  revealDrawing?: { id: string; nonce: number };
  /** The first calculation is running; formulas without results shimmer. */
  pendingFormulas?: boolean;
  remoteCursors: SpreadsheetCursor[];
  selection: CellSelection;
  editing: boolean;
  formulaEditing?: boolean;
  editorSelection?: FormulaTextSelection;
  referenceSelection?: CellSelection;
  /** The colored ranges of the references in the formula being edited. */
  referenceHighlights?: ReferenceHighlight[];
  /** Colored spans of the formula draft's reference text. */
  draftReferences?: FormulaReferenceSpan[];
  pickingReference?: boolean;
  onTextSelection?: (start: number, end: number) => void;
  onReferenceStart?: (position: CellPosition) => boolean;
  onReferenceMove?: (position: CellPosition) => void;
  onReferenceEnd?: () => void;
  draft: string;
  readonly: boolean;
  onSelect: (position: CellPosition, extend?: boolean) => void;
  onSelectRange: (anchor: CellPosition, focus: CellPosition) => void;
  onEdit: () => void;
  onDraft: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  onMove: (row: number, column: number) => void;
  onKeyDown: (event: KeyboardEvent) => void;
  onCopy: (cut?: boolean) => string;
  onPaste: (text: string, metadata?: string) => void;
  onClear: () => void;
  onGridReady: (element: HTMLDivElement) => void;
}) {
  const id = createUniqueId();
  const [scrollElement, setScrollElement] = createSignal<HTMLDivElement>();
  const viewport = createElementSize(scrollElement);
  const [scrollTop, setScrollTop] = createSignal(0);
  const [scrollLeft, setScrollLeft] = createSignal(0);
  const [touchMode, setTouchMode] = createSignal(isTouchDevice());
  const scale = () => Math.max(0.5, Math.min(2, (props.zoom ?? 100) / 100));
  const headerHeight = () => COLUMN_HEADER_HEIGHT * scale();
  const headerWidth = () => ROW_HEADER_WIDTH * scale();
  const rowCount = () => props.rowCount ?? GRID_ROWS;
  const columnCount = () => props.columnCount ?? GRID_COLUMNS;
  const hiddenColumns = createMemo(() => new Set(props.hiddenColumns));
  const hiddenRows = createMemo(() => new Set(props.hiddenRows));
  const defaultFontSize = () => props.defaultFont?.size ?? 10;
  const [fillTarget, setFillTarget] = createSignal<CellSelection>();
  // The cell whose list is open; moving the selection closes it.
  const [listOpenAt, setListOpenAt] = createSignal<string>();
  const [selectedDrawing, setSelectedDrawing] = createSignal<string>();
  const [resizing, setResizing] = createSignal<{
    column: number;
    width: number;
  }>();
  let fillSource: CellSelection | undefined;
  let fillGeneration = 0;
  let resizeStart: { x: number; width: number } | undefined;
  const [resizingRow, setResizingRow] = createSignal<{
    row: number;
    height: number;
  }>();
  let rowResizeStart: { y: number; height: number } | undefined;
  let headerDrag: { axis: 'row' | 'column'; anchor: number } | undefined;
  let touchGesture:
    | {
        kind: 'tap';
        pointerId: number;
        x: number;
        y: number;
        position: CellPosition;
        moved: boolean;
      }
    | {
        kind: 'selection' | 'reference';
        pointerId: number;
        x: number;
        y: number;
        fixed: CellPosition;
        startX: number;
        startY: number;
        moved: boolean;
        tapPosition?: CellPosition;
      }
    | undefined;
  let lastTap: { address: string; time: number } | undefined;
  let autoScrollFrame: number | undefined;
  const columnWidth = (column: number) =>
    resizing()?.column === column
      ? resizing()!.width
      : (props.columnWidths?.[column] ?? DEFAULT_COLUMN_WIDTH);
  const width = (column: number) => `${columnWidth(column) * scale()}px`;
  const display = (address: string) => {
    const cell = props.cells[address];
    const formula = cell?.value.startsWith('=') && cell.format !== 'text';
    if (props.showFormulas && formula) return cell.value;
    // Newly filled formulas have no cached result yet. Keep them blank until
    // calculation finishes instead of briefly flashing the formula expression.
    // Literal numbers are formatted as calculation will show them.
    return (
      props.values[address]?.display ??
      (formula
        ? ''
        : (literalNumberDisplay(cell) ?? cellPlainText(cell?.value ?? '')))
    );
  };
  const rootStyle = getComputedStyle(document.documentElement);
  const fontFamilies = {
    sans: rootStyle.getPropertyValue('--font-sans') || 'sans-serif',
    serif: rootStyle.getPropertyValue('--font-serif') || 'serif',
    mono: rootStyle.getPropertyValue('--font-mono') || 'monospace',
  };
  const fontFamily = (cell?: SpreadsheetCell) => {
    const name =
      cell?.fontName ??
      (cell?.fontFamily ? undefined : props.defaultFont?.name);
    return name
      ? `${JSON.stringify(name)}, ${fontFamilies[cell?.fontFamily ?? 'sans']}`
      : fontFamilies[cell?.fontFamily ?? 'sans'];
  };
  // No cell measurement runs on pointer movement: only document, calculation,
  // column width, and zoom changes invalidate row geometry.
  const context =
    typeof CanvasRenderingContext2D === 'undefined'
      ? null
      : document.createElement('canvas').getContext('2d');
  const rowHeights = createMemo(() => {
    // Gridlines stay one CSS pixel wide when the workbook is zoomed.
    const borderInset = 1 / scale();
    const verticalInset = CELL_PADDING_Y * 2 + borderInset;
    const baseHeight = Math.max(
      ROW_HEIGHT,
      Math.ceil(
        fontPixels(undefined, defaultFontSize()) * CELL_LINE_HEIGHT +
          verticalInset
      )
    );
    const heights = new Array<number>(rowCount()).fill(baseHeight);
    for (const [row, height] of Object.entries(props.rowHeights ?? {}))
      if (Number(row) < heights.length)
        heights[Number(row)] = Math.max(ROW_HEIGHT, (height * 4) / 3);
    const resized = resizingRow();
    if (resized && resized.row < heights.length)
      heights[resized.row] = resized.height;
    for (const address in props.cells) {
      const cell = props.cells[address];
      // Only wrapped text and larger fonts can grow a row.
      if (
        !cell.wrap &&
        (cell.fontSize === undefined || cell.fontSize <= defaultFontSize())
      )
        continue;
      const position = parseCellAddress(address);
      if (!position || position.row >= heights.length) continue;
      if (
        props.rowHeights?.[position.row] !== undefined ||
        resizingRow()?.row === position.row
      )
        continue;
      const pixels = fontPixels(cell, defaultFontSize());
      const lineHeight = pixels * CELL_LINE_HEIGHT;
      let lines = 1;
      if (cell.wrap) {
        if (context)
          context.font = `${cell.italic ? 'italic ' : ''}${cell.bold ? 600 : 400} ${pixels}px ${fontFamily(cell)}`;
        lines = wrappedLines(
          display(address),
          columnWidth(position.column) - CELL_PADDING_X * 2 - borderInset,
          (text) =>
            context?.measureText(text).width ?? text.length * pixels * 0.6,
          Math.ceil((MAX_ROW_HEIGHT - verticalInset) / lineHeight)
        );
      }
      heights[position.row] = Math.max(
        heights[position.row],
        Math.min(MAX_ROW_HEIGHT, Math.ceil(lines * lineHeight + verticalInset))
      );
    }
    const hidden = hiddenRows();
    const zoom = scale();
    for (let row = 0; row < heights.length; row++)
      heights[row] = hidden.has(row) ? 0 : heights[row] * zoom;
    return heights;
  });
  const rowOffsets = createMemo(() => {
    const offsets = [headerHeight()];
    for (const height of rowHeights())
      offsets.push(offsets[offsets.length - 1] + height);
    return offsets;
  });
  const viewportRows = createMemo(() => {
    const offsets = rowOffsets();
    const top = scrollTop() - 160;
    const bottom = scrollTop() + (viewport.height ?? 600) + 160;
    const visible: number[] = [];
    for (
      let row = Math.min(
        rowCount() - 1,
        offsetIndex(offsets, Math.max(0, top))
      );
      row < rowCount() && offsets[row] <= bottom;
      row++
    )
      if (offsets[row + 1] >= top) visible.push(row);
    return visible;
  });
  const visibleRows = createMemo(() =>
    [
      ...new Set([
        ...viewportRows(),
        props.selection.anchor.row,
        props.selection.focus.row,
      ]),
    ]
      .filter((row) => !hiddenRows().has(row))
      .sort((a, b) => a - b)
  );
  const bounds = createMemo(() =>
    selectionBounds(fillTarget() ?? props.selection)
  );
  // Share one subscription for the range. Only changed aria-selected cells update;
  // visual selection is drawn by two overlays, independent of the range's area.
  const selectedCell = createSelector(
    bounds,
    (position: CellPosition, area) =>
      position.row >= area.top &&
      position.row <= area.bottom &&
      position.column >= area.left &&
      position.column <= area.right
  );
  const activeCell = createSelector(() => cellAddress(props.selection.anchor));
  const columnOffsets = createMemo(() => {
    const offsets = [headerWidth()];
    const hidden = hiddenColumns();
    for (let column = 0; column < columnCount(); column++)
      offsets.push(
        offsets[column] +
          (hidden.has(column) ? 0 : columnWidth(column) * scale())
      );
    return offsets;
  });
  // Only columns in view (plus the selection) are rendered, like rows.
  const visibleColumns = createMemo(() => {
    const offsets = columnOffsets();
    const left = scrollLeft() - 200;
    const right = scrollLeft() + (viewport.width ?? 1200) + 200;
    const visible = new Set<number>();
    for (
      let column = Math.min(
        columnCount() - 1,
        offsetIndex(offsets, Math.max(0, left))
      );
      column < columnCount() && offsets[column] <= right;
      column++
    )
      if (offsets[column + 1] >= left) visible.add(column);
    visible.add(Math.min(columnCount() - 1, props.selection.anchor.column));
    visible.add(Math.min(columnCount() - 1, props.selection.focus.column));
    const hidden = hiddenColumns();
    return [...visible]
      .filter((column) => !hidden.has(column))
      .sort((a, b) => a - b);
  });
  const totalWidth = () => columnOffsets()[columnCount()];
  const rangeStyle = (area = bounds()) => {
    const offsets = columnOffsets();
    return {
      left: `${offsets[area.left]}px`,
      top: `${rowOffsets()[area.top]}px`,
      width: `${offsets[area.right + 1] - offsets[area.left]}px`,
      height: `${rowOffsets()[area.bottom + 1] - rowOffsets()[area.top]}px`,
    };
  };
  /** A drawing's box in the grid, when it is near the visible area. */
  /** A drawing's box in the grid's content, wherever it is. */
  const drawingRect = (drawing: SheetDrawing): DrawingRect | undefined => {
    const columns = columnOffsets();
    const rows = rowOffsets();
    const at = (index: number, offsets: number[]) =>
      offsets[Math.min(index, offsets.length - 1)];
    const left = at(drawing.from.column, columns) + drawing.from.x * scale();
    const top = at(drawing.from.row, rows) + drawing.from.y * scale();
    const right = drawing.to
      ? at(drawing.to.column, columns) + drawing.to.x * scale()
      : left + (drawing.width ?? 0) * scale();
    const bottom = drawing.to
      ? at(drawing.to.row, rows) + drawing.to.y * scale()
      : top + (drawing.height ?? 0) * scale();
    if (right - left < 2 || bottom - top < 2) return;
    return { left, top, width: right - left, height: bottom - top };
  };
  /** A drawing's box when it is near the visible area. */
  const placeDrawing = (drawing: SheetDrawing): DrawingRect | undefined => {
    const rect = drawingRect(drawing);
    const margin = 400;
    if (
      !rect ||
      rect.top + rect.height < scrollTop() - margin ||
      rect.top > scrollTop() + (viewport.height ?? 600) + margin ||
      rect.left + rect.width < scrollLeft() - margin ||
      rect.left > scrollLeft() + (viewport.width ?? 1200) + margin
    )
      return;
    return rect;
  };
  /**
   * The anchors of a box in the grid's content: corners in cells for a
   * drawing that stretches with them, otherwise a corner and a size.
   */
  const placementOf = (
    drawing: SheetDrawing,
    rect: DrawingRect
  ): DrawingPlacement => {
    const point = (x: number, y: number) => {
      const columns = columnOffsets();
      const rows = rowOffsets();
      const column = Math.min(columnCount() - 1, offsetIndex(columns, x));
      const row = Math.min(rowCount() - 1, offsetIndex(rows, y));
      return {
        row,
        column,
        x: Math.max(0, Math.round((x - columns[column]) / scale())),
        y: Math.max(0, Math.round((y - rows[row]) / scale())),
      };
    };
    const from = point(rect.left, rect.top);
    return drawing.to
      ? { from, to: point(rect.left + rect.width, rect.top + rect.height) }
      : {
          from,
          width: Math.round(rect.width / scale()),
          height: Math.round(rect.height / scale()),
        };
  };
  /** Drawings in reading order: down the sheet, then across. */
  const drawingOrder = () =>
    [...(props.drawings ?? [])].sort(
      (a, b) => a.from.row - b.from.row || a.from.column - b.from.column
    );
  function revealDrawing(id: string) {
    const drawing = props.drawings?.find((value) => value.id === id);
    const rect = drawing && drawingRect(drawing);
    if (!rect) return;
    // Bring it into view below the headers, then focus it once drawn.
    const width = viewport.width ?? 0;
    const height = viewport.height ?? 0;
    if (
      rect.left < grid.scrollLeft + headerWidth() ||
      rect.left + Math.min(rect.width, width) > grid.scrollLeft + width
    )
      grid.scrollLeft = Math.max(0, rect.left - headerWidth() - 16);
    if (
      rect.top < grid.scrollTop + headerHeight() ||
      rect.top + Math.min(rect.height, height) > grid.scrollTop + height
    )
      grid.scrollTop = Math.max(0, rect.top - headerHeight() - 16);
    setScrollTop(grid.scrollTop);
    setScrollLeft(grid.scrollLeft);
    setSelectedDrawing(id);
    // After a menu that opened this returns focus, and once it is drawn.
    let tries = 0;
    const focus = () => {
      const element = grid.querySelector<HTMLElement>(
        `[data-drawing="${CSS.escape(id)}"]`
      );
      if (element) element.focus({ preventScroll: true });
      else if (tries++ < 20) setTimeout(focus, 16);
    };
    setTimeout(focus);
  }
  createEffect(
    on(
      () => props.revealDrawing,
      (request) => {
        if (request) revealDrawing(request.id);
      },
      { defer: true }
    )
  );
  const activeStyle = () => ({
    left: `${columnOffsets()[props.selection.anchor.column]}px`,
    top: `${rowOffsets()[props.selection.anchor.row]}px`,
    width: width(props.selection.anchor.column),
    height: `${rowHeights()[props.selection.anchor.row]}px`,
  });

  function stopTouchGesture() {
    if (autoScrollFrame !== undefined) cancelAnimationFrame(autoScrollFrame);
    autoScrollFrame = undefined;
    touchGesture = undefined;
  }

  function tapCell(position: CellPosition, time: number) {
    keepReferenceFocus = props.onReferenceStart?.(position) ?? false;
    if (!keepReferenceFocus) {
      const address = cellAddress(position);
      const repeat =
        lastTap?.address === address &&
        time - lastTap.time <= 500 &&
        cellAddress(props.selection.anchor) === address &&
        cellAddress(props.selection.focus) === address;
      props.onSelect(position);
      if (repeat && !props.readonly) {
        props.onEdit();
        // iOS may synthesize mousedown on the old cell after mounting its editor.
        keepReferenceFocus = true;
        lastTap = undefined;
      } else {
        focusGrid();
        lastTap = { address, time };
      }
    } else lastTap = undefined;
  }

  function endPointer(event: PointerEvent) {
    if (touchGesture && event.pointerId !== touchGesture.pointerId) return;
    const gesture = touchGesture;
    stopTouchGesture();
    if (
      gesture?.kind === 'tap' &&
      !gesture.moved &&
      Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) <=
        TOUCH_SLOP
    ) {
      tapCell(gesture.position, event.timeStamp);
    } else if (
      gesture &&
      gesture.kind !== 'tap' &&
      !gesture.moved &&
      gesture.tapPosition &&
      Math.hypot(
        event.clientX - gesture.startX,
        event.clientY - gesture.startY
      ) <= TOUCH_SLOP
    ) {
      // The accessible grip extends over nearby cells. A tap in its invisible
      // padding should still select that cell; only a drag claims the grip.
      tapCell(gesture.tapPosition, event.timeStamp);
    }
    dragging = false;
    headerDrag = undefined;
    props.onReferenceEnd?.();
    const target = fillTarget();
    const source = fillSource;
    fillSource = undefined;
    if (source && target && !props.readonly) {
      const generation = ++fillGeneration;
      // Keep the preview until formula relocation has committed the new cells.
      void Promise.resolve(props.onFill?.(source, target)).finally(() => {
        if (generation === fillGeneration) setFillTarget(undefined);
      });
    }
    const resize = resizing();
    if (resize && !props.readonly)
      props.onResizeColumn?.(resize.column, resize.width);
    setResizing(undefined);
    resizeStart = undefined;
    const rowResize = resizingRow();
    if (rowResize && !props.readonly)
      props.onResizeRow?.(rowResize.row, rowResize.height);
    setResizingRow(undefined);
    rowResizeStart = undefined;
  }

  function cancelPointer() {
    stopTouchGesture();
    lastTap = undefined;
    dragging = false;
    headerDrag = undefined;
    keepReferenceFocus = false;
    props.onReferenceEnd?.();
    fillSource = undefined;
    fillGeneration++;
    setFillTarget(undefined);
    setResizing(undefined);
    resizeStart = undefined;
    setResizingRow(undefined);
    rowResizeStart = undefined;
  }

  function previewFill(position: CellPosition) {
    if (!fillSource) return;
    const area = selectionBounds(fillSource);
    const vertical = Math.max(
      area.top - position.row,
      position.row - area.bottom,
      0
    );
    const horizontal = Math.max(
      area.left - position.column,
      position.column - area.right,
      0
    );
    setFillTarget({
      anchor: {
        row:
          vertical >= horizontal ? Math.min(area.top, position.row) : area.top,
        column:
          horizontal > vertical
            ? Math.min(area.left, position.column)
            : area.left,
      },
      focus: {
        row:
          vertical >= horizontal
            ? Math.max(area.bottom, position.row)
            : area.bottom,
        column:
          horizontal > vertical
            ? Math.max(area.right, position.column)
            : area.right,
      },
    });
  }

  function autoFit(column: number) {
    if (props.readonly) return;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return;
    let measured = Math.max(MIN_COLUMN_WIDTH, 24);
    const addresses = new Set<string>();
    for (const source of [props.cells, props.values])
      for (const address in source)
        if (parseCellAddress(address)?.column === column)
          addresses.add(address);
    for (const address of addresses) {
      const cell = props.cells[address];
      context.font = `${cell?.italic ? 'italic ' : ''}${cell?.bold ? 600 : 400} ${fontPixels(cell, defaultFontSize())}px ${fontFamily(cell)}`;
      const text = display(address);
      for (const line of text.split('\n'))
        measured = Math.max(
          measured,
          context.measureText(line).width + CELL_PADDING_X * 2 + 1 / scale()
        );
    }
    props.onResizeColumn?.(
      column,
      Math.min(MAX_COLUMN_WIDTH, Math.ceil(measured))
    );
  }
  let grid!: HTMLDivElement;
  let dragging = false;
  let keepReferenceFocus = false;
  const isInput = (target: EventTarget | null) =>
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && !!target.closest('[contenteditable]'));
  const focusGrid = () => grid.focus({ preventScroll: true });
  const selectHeaderRange = (
    axis: 'row' | 'column',
    index: number,
    anchor = index
  ) => {
    if (axis === 'row')
      props.onSelectRange(
        { row: anchor, column: 0 },
        { row: index, column: columnCount() - 1 }
      );
    else
      props.onSelectRange(
        { row: 0, column: anchor },
        { row: rowCount() - 1, column: index }
      );
    focusGrid();
  };
  const startHeader = (
    event: PointerEvent,
    axis: 'row' | 'column',
    index: number
  ) => {
    if (event.button !== 0 || event.ctrlKey) return;
    event.preventDefault();
    const anchor = event.shiftKey ? props.selection.anchor[axis] : index;
    headerDrag = { axis, anchor };
    selectHeaderRange(axis, index, anchor);
  };

  function positionAtPoint(x: number, y: number): CellPosition {
    const rect = grid.getBoundingClientRect();
    const column = offsetIndex(
      columnOffsets(),
      x - rect.left + grid.scrollLeft
    );
    const row = offsetIndex(rowOffsets(), y - rect.top + grid.scrollTop);
    // Offsets start at the first cell after the headers.
    return {
      row: Math.min(rowCount() - 1, row),
      column: Math.min(columnCount() - 1, column),
    };
  }

  function moveTouchHandle() {
    const gesture = touchGesture;
    if (!gesture || gesture.kind === 'tap' || !gesture.moved) return;
    const position = positionAtPoint(gesture.x, gesture.y);
    if (gesture.kind === 'reference') props.onReferenceMove?.(position);
    else props.onSelectRange(gesture.fixed, position);
  }

  function scrollTouchHandle() {
    const gesture = touchGesture;
    if (!gesture || gesture.kind === 'tap' || !gesture.moved) return;
    const rect = grid.getBoundingClientRect();
    const step = (point: number, start: number, end: number) =>
      point < start + 24 ? -10 : point > end - 24 ? 10 : 0;
    const x = step(gesture.x, rect.left + headerWidth(), rect.right);
    const y = step(gesture.y, rect.top + headerHeight(), rect.bottom);
    if (x || y) {
      const previousLeft = grid.scrollLeft;
      const previousTop = grid.scrollTop;
      grid.scrollLeft += x;
      grid.scrollTop += y;
      if (previousLeft !== grid.scrollLeft || previousTop !== grid.scrollTop) {
        setScrollTop(grid.scrollTop);
        moveTouchHandle();
      }
    }
    autoScrollFrame = requestAnimationFrame(scrollTouchHandle);
  }

  function movePointer(event: PointerEvent) {
    if (headerDrag && event.buttons === 1) {
      const position = positionAtPoint(event.clientX, event.clientY);
      selectHeaderRange(
        headerDrag.axis,
        position[headerDrag.axis],
        headerDrag.anchor
      );
      return;
    }
    const gesture = touchGesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (gesture.kind === 'tap') {
      if (
        Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) >
        TOUCH_SLOP
      ) {
        gesture.moved = true;
        lastTap = undefined;
      }
      return;
    }
    event.preventDefault();
    if (!gesture.moved) {
      if (
        Math.hypot(
          event.clientX - gesture.startX,
          event.clientY - gesture.startY
        ) <= TOUCH_SLOP
      )
        return;
      gesture.moved = true;
      lastTap = undefined;
      autoScrollFrame = requestAnimationFrame(scrollTouchHandle);
    }
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    moveTouchHandle();
  }

  const touchRange = () => props.referenceSelection ?? props.selection;
  function startTouchHandle(event: PointerEvent, start: boolean) {
    if (event.button !== 0 || event.isPrimary === false) return;
    event.preventDefault();
    event.stopPropagation();
    const area = selectionBounds(touchRange());
    const fixed = start
      ? { row: area.bottom, column: area.right }
      : { row: area.top, column: area.left };
    const moving = start
      ? { row: area.top, column: area.left }
      : { row: area.bottom, column: area.right };
    const reference = !!props.referenceSelection;
    const rect = grid.getBoundingClientRect();
    const handleX =
      columnOffsets()[start ? area.left : area.right + 1] +
      rect.left -
      grid.scrollLeft;
    const handleY =
      rowOffsets()[start ? area.top : area.bottom + 1] +
      rect.top -
      grid.scrollTop;
    const tapPosition =
      Math.hypot(event.clientX - handleX, event.clientY - handleY) > TOUCH_SLOP
        ? positionAtPoint(event.clientX, event.clientY)
        : undefined;
    keepReferenceFocus =
      reference && (props.onReferenceStart?.(fixed) ?? false);
    if (reference && !keepReferenceFocus) return;
    if (!tapPosition) lastTap = undefined;
    touchGesture = {
      kind: reference ? 'reference' : 'selection',
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      tapPosition,
      fixed,
    };
    if (reference) props.onReferenceMove?.(moving);
    else focusGrid();
    grid.setPointerCapture(event.pointerId);
  }

  // The same grid renders every sheet. A remote deletion can change the active
  // sheet while a pointer remains down, so its gesture must end without writing.
  createEffect(on(() => props.sheetId, cancelPointer, { defer: true }));
  // A tap/handle starts against a specific layout. Remote row/width changes or
  // a zoom command must not reinterpret its original coordinates on release.
  createEffect(
    on(
      () => [props.zoom, props.rowCount, props.columnWidths] as const,
      () => {
        lastTap = undefined;
        if (touchGesture) cancelPointer();
      },
      { defer: true }
    )
  );

  function revealSelection() {
    const selected = grid.querySelector<HTMLElement>(
      `[data-address="${cellAddress(props.selection.focus)}"]`
    );
    selected?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function editKeyDown(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      props.onCancel();
      focusGrid();
    } else if (
      (event.key === 'Enter' && !event.altKey) ||
      event.key === 'Tab'
    ) {
      event.preventDefault();
      props.onCommit();
      props.onMove(
        event.key === 'Enter' ? (event.shiftKey ? -1 : 1) : 0,
        event.key === 'Tab' ? (event.shiftKey ? -1 : 1) : 0
      );
      focusGrid();
      revealSelection();
    }
  }

  onMount(() => {
    props.onGridReady(grid);
    window.addEventListener('pointerup', endPointer);
    window.addEventListener('pointermove', movePointer, { passive: false });
    window.addEventListener('pointercancel', cancelPointer);
    window.addEventListener('blur', cancelPointer);
    onCleanup(() => {
      window.removeEventListener('pointerup', endPointer);
      window.removeEventListener('pointermove', movePointer);
      window.removeEventListener('pointercancel', cancelPointer);
      window.removeEventListener('blur', cancelPointer);
      stopTouchGesture();
    });
  });

  let headerSelection: CellSelection | undefined;
  function selectHeader(
    axis: 'row' | 'column',
    index: number,
    preserve = false
  ) {
    const area = selectionBounds(props.selection);
    if (
      preserve &&
      (axis === 'row'
        ? area.left === 0 &&
          area.right === columnCount() - 1 &&
          index >= area.top &&
          index <= area.bottom
        : area.top === 0 &&
          area.bottom === rowCount() - 1 &&
          index >= area.left &&
          index <= area.right)
    )
      return;
    props.onSelectRange(
      axis === 'row' ? { row: index, column: 0 } : { row: 0, column: index },
      axis === 'row'
        ? { row: index, column: columnCount() - 1 }
        : { row: rowCount() - 1, column: index }
    );
  }
  function openHeader(axis: 'row' | 'column', index: number) {
    selectHeader(axis, index, true);
    headerSelection = {
      anchor: { ...props.selection.anchor },
      focus: { ...props.selection.focus },
    };
  }
  function headerAction(axis: 'row' | 'column', action: HeaderAction) {
    if (headerSelection)
      props.onSelectRange(headerSelection.anchor, headerSelection.focus);
    props.onHeaderAction?.(axis, action);
  }
  let cellMenuSelection: CellSelection | undefined;
  let cellMenuSheet: string | undefined;
  function prepareCellMenu(position: CellPosition) {
    cancelPointer();
    props.onCommit();
    const area = selectionBounds(props.selection);
    if (
      position.row < area.top ||
      position.row > area.bottom ||
      position.column < area.left ||
      position.column > area.right
    )
      props.onSelect(position);
    cellMenuSelection = {
      anchor: { ...props.selection.anchor },
      focus: { ...props.selection.focus },
    };
    cellMenuSheet = props.sheetId;
  }
  function cellAction(action: CellAction) {
    if (cellMenuSheet !== props.sheetId || !cellMenuSelection) return;
    props.onSelectRange(cellMenuSelection.anchor, cellMenuSelection.focus);
    if (action === 'comment') {
      if (props.comments?.canComment())
        props.comments.add(renderedSelectionCell(grid, cellMenuSelection));
    } else if (action === 'copy' || !props.readonly)
      props.onCellAction?.(action);
  }
  return (
    <SpreadsheetCellMenu
      readonly={props.readonly}
      canComment={props.comments?.canComment()}
      hasComments={!!props.comments}
      canFillDown={
        selectionBounds(props.selection).bottom >
        selectionBounds(props.selection).top
      }
      canFillRight={
        selectionBounds(props.selection).right >
        selectionBounds(props.selection).left
      }
      onRestoreFocus={focusGrid}
      onAction={cellAction}
    >
      {(openCellMenu) => (
        <div
          ref={(element) => {
            grid = element;
            setScrollElement(element);
          }}
          role="grid"
          data-keyboard-input
          aria-label="Spreadsheet"
          aria-rowcount={rowCount() + 1}
          aria-colcount={columnCount() + 1}
          aria-multiselectable="true"
          aria-readonly={props.readonly}
          aria-activedescendant={`${id}-${cellAddress(props.selection.anchor)}`}
          tabIndex={0}
          class="relative min-h-0 flex-1 overflow-auto overscroll-contain touch-pan-x touch-pan-y touch-pinch-zoom outline-none bg-panel selection:bg-accent/20"
          style={{
            '--spreadsheet-cell-padding': `${CELL_PADDING_X * scale()}px`,
            '--spreadsheet-cell-padding-y': `${CELL_PADDING_Y * scale()}px`,
          }}
          onScroll={(event) => {
            setScrollTop(event.currentTarget.scrollTop);
            setScrollLeft(event.currentTarget.scrollLeft);
            if (touchGesture?.kind === 'tap') touchGesture.moved = true;
          }}
          onMouseDown={(event) => {
            // iOS still sends compatibility mousedown after cancelled pointerdown.
            if (keepReferenceFocus && !isInput(event.target))
              event.preventDefault();
          }}
          onClick={() => {
            keepReferenceFocus = false;
          }}
          onContextMenu={(event) => {
            if (isInput(event.target)) return;
            const cell = event.target.closest<HTMLElement>('[data-address]');
            if (!cell || !grid.contains(cell)) return;
            const parsed = parseCellAddress(cell.dataset.address ?? '');
            if (!parsed) return;
            event.preventDefault();
            event.stopPropagation();
            prepareCellMenu(parsed);
            openCellMenu(event.clientX, event.clientY);
          }}
          onKeyDown={(event) => {
            // Solid portals retain logical ancestry; menu keys belong to the menu.
            if (
              !event.currentTarget.contains(event.target) ||
              isInput(event.target) ||
              event.target.closest('a[href]')
            )
              return;
            event.stopPropagation();
            if (
              event.key === 'ContextMenu' ||
              (event.shiftKey && event.key === 'F10')
            ) {
              event.preventDefault();
              prepareCellMenu(props.selection.anchor);
              const cell = grid.querySelector<HTMLElement>(
                `[data-address="${cellAddress(props.selection.anchor)}"]`
              );
              const rect =
                cell?.getBoundingClientRect() ?? grid.getBoundingClientRect();
              openCellMenu(rect.left + Math.min(rect.width, 24), rect.bottom);
              return;
            }
            // Excel's shortcut to select drawings; Tab then moves among them.
            if (
              event.altKey &&
              (event.ctrlKey || event.metaKey) &&
              event.code === 'Digit5'
            ) {
              event.preventDefault();
              const first = drawingOrder()[0];
              if (first) revealDrawing(first.id);
              return;
            }
            if (
              event.altKey &&
              event.key === 'ArrowDown' &&
              !props.readonly &&
              props.listItems?.length
            ) {
              event.preventDefault();
              setListOpenAt(cellAddress(props.selection.anchor));
              return;
            }
            const previous = props.selection.focus;
            const selectsAll =
              (event.metaKey || event.ctrlKey) &&
              event.key.toLowerCase() === 'a';
            props.onKeyDown(event);
            // Select all ends at the last cell; revealing it would scroll away
            // from the cells the user is looking at.
            if (
              !selectsAll &&
              !props.editing &&
              (previous.row !== props.selection.focus.row ||
                previous.column !== props.selection.focus.column)
            )
              revealSelection();
          }}
          onCopy={(event) => {
            if (isInput(event.target)) return;
            event.preventDefault();
            event.clipboardData?.setData('text/plain', props.onCopy());
            if (props.onCopyMetadata)
              event.clipboardData?.setData(
                SPREADSHEET_CLIPBOARD_TYPE,
                props.onCopyMetadata()
              );
          }}
          onCut={(event) => {
            if (isInput(event.target)) return;
            if (!event.clipboardData) return;
            event.preventDefault();
            // A viewer can copy with the cut shortcut, but no cells move. Mark its
            // metadata as a copy so formulas still translate on a later paste.
            const cut = !props.readonly;
            event.clipboardData.setData('text/plain', props.onCopy(cut));
            if (props.onCopyMetadata)
              event.clipboardData.setData(
                SPREADSHEET_CLIPBOARD_TYPE,
                props.onCopyMetadata(cut)
              );
            if (cut) props.onClear();
          }}
          onPaste={(event) => {
            if (isInput(event.target)) return;
            event.preventDefault();
            if (
              !props.readonly &&
              event.clipboardData?.types.includes('text/plain')
            )
              props.onPaste(
                event.clipboardData.getData('text/plain'),
                event.clipboardData.getData(SPREADSHEET_CLIPBOARD_TYPE) ||
                  undefined
              );
          }}
        >
          <div
            class="relative min-w-full"
            style={{
              height: `${rowOffsets()[rowCount()]}px`,
              width: `${totalWidth()}px`,
            }}
          >
            <div
              role="row"
              aria-rowindex={1}
              class="sticky top-0 z-20 flex bg-panel text-ink-muted font-medium select-none"
              style={{
                height: `${headerHeight()}px`,
                width: `${totalWidth()}px`,
                'font-size': `${11 * scale()}px`,
              }}
            >
              <div
                role="columnheader"
                aria-label="Select all cells"
                class="sticky left-0 z-30 shrink-0 border-b border-r border-edge bg-panel"
                style={{ width: `${headerWidth()}px` }}
              >
                <button
                  type="button"
                  aria-label="Select all cells"
                  class="size-full hover:bg-hover"
                  onClick={() => {
                    props.onSelectRange(
                      { row: 0, column: 0 },
                      { row: rowCount() - 1, column: columnCount() - 1 }
                    );
                    focusGrid();
                  }}
                >
                  ▦
                </button>
              </div>
              <For each={visibleColumns()}>
                {(column) => (
                  <div
                    role="columnheader"
                    aria-colindex={column + 2}
                    style={{
                      width: width(column),
                      left: `${columnOffsets()[column]}px`,
                    }}
                    class="absolute top-0 bottom-0 border-b border-r border-edge-muted"
                    classList={{
                      'bg-accent-bg text-accent':
                        column >= bounds().left && column <= bounds().right,
                    }}
                  >
                    <SpreadsheetHeaderMenu
                      canChangeStructure={props.canChangeStructure}
                      axis="column"
                      count={bounds().right - bounds().left + 1}
                      readonly={props.readonly}
                      onOpen={() => openHeader('column', column)}
                      onRestoreFocus={focusGrid}
                      onAction={(action) => {
                        if (action === 'autofit') {
                          for (let c = bounds().left; c <= bounds().right; c++)
                            autoFit(c);
                        } else headerAction('column', action);
                      }}
                    >
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-label={`Select column ${columnName(column)}`}
                        class="size-full hover:bg-hover"
                        onPointerDown={(event) =>
                          startHeader(event, 'column', column)
                        }
                        onClick={(event) => {
                          if (event.detail === 0)
                            selectHeaderRange(
                              'column',
                              column,
                              event.shiftKey
                                ? props.selection.anchor.column
                                : column
                            );
                        }}
                      >
                        {columnName(column)}
                      </button>
                    </SpreadsheetHeaderMenu>
                    <Show when={!props.readonly && props.onResizeColumn}>
                      <div
                        role="separator"
                        aria-label={`Resize column ${columnName(column)}`}
                        aria-orientation="vertical"
                        aria-valuenow={
                          props.columnWidths?.[column] ?? DEFAULT_COLUMN_WIDTH
                        }
                        aria-valuemin={MIN_COLUMN_WIDTH}
                        aria-valuemax={MAX_COLUMN_WIDTH}
                        tabIndex={0}
                        title="Drag to resize · Double-click to fit"
                        class="absolute -right-1 top-0 z-[1] h-full w-2 touch-none cursor-col-resize hover:bg-accent/30 focus-visible:bg-accent/30 outline-none"
                        onPointerDown={(event) => {
                          if (event.button !== 0) return;
                          event.preventDefault();
                          event.stopPropagation();
                          resizeStart = {
                            x: event.clientX,
                            width:
                              props.columnWidths?.[column] ??
                              DEFAULT_COLUMN_WIDTH,
                          };
                          setResizing({ column, width: resizeStart.width });
                          event.currentTarget.setPointerCapture(
                            event.pointerId
                          );
                        }}
                        onPointerMove={(event) => {
                          if (!resizeStart || resizing()?.column !== column)
                            return;
                          setResizing({
                            column,
                            width: Math.max(
                              MIN_COLUMN_WIDTH,
                              Math.min(
                                MAX_COLUMN_WIDTH,
                                resizeStart.width +
                                  (event.clientX - resizeStart.x) / scale()
                              )
                            ),
                          });
                        }}
                        onDblClick={() => autoFit(column)}
                        onKeyDown={(event) => {
                          event.stopPropagation();
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            autoFit(column);
                          }
                          if (
                            event.key === 'ArrowLeft' ||
                            event.key === 'ArrowRight'
                          ) {
                            event.preventDefault();
                            props.onResizeColumn?.(
                              column,
                              (props.columnWidths?.[column] ??
                                DEFAULT_COLUMN_WIDTH) +
                                (event.key === 'ArrowRight' ? 16 : -16)
                            );
                          }
                        }}
                      />
                    </Show>
                  </div>
                )}
              </For>
            </div>
            <For each={visibleRows()}>
              {(row) => (
                <div
                  role="row"
                  aria-rowindex={row + 2}
                  class="absolute left-0 flex"
                  style={{
                    top: `${rowOffsets()[row]}px`,
                    height: `${rowHeights()[row]}px`,
                    width: `${totalWidth()}px`,
                  }}
                >
                  <div
                    role="rowheader"
                    class="sticky left-0 z-10 shrink-0 border-b border-r border-edge-muted bg-panel text-center text-ink-muted select-none"
                    style={{
                      width: `${headerWidth()}px`,
                      'font-size': `${11 * scale()}px`,
                    }}
                    classList={{
                      'bg-accent-bg text-accent':
                        row >= bounds().top && row <= bounds().bottom,
                    }}
                  >
                    <SpreadsheetHeaderMenu
                      canChangeStructure={props.canChangeStructure}
                      axis="row"
                      count={bounds().bottom - bounds().top + 1}
                      readonly={props.readonly}
                      onOpen={() => openHeader('row', row)}
                      onRestoreFocus={focusGrid}
                      onAction={(action) => headerAction('row', action)}
                    >
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-label={`Select row ${row + 1}`}
                        class="size-full hover:bg-hover"
                        onPointerDown={(event) =>
                          startHeader(event, 'row', row)
                        }
                        onClick={(event) => {
                          if (event.detail === 0)
                            selectHeaderRange(
                              'row',
                              row,
                              event.shiftKey ? props.selection.anchor.row : row
                            );
                        }}
                      >
                        {row + 1}
                      </button>
                    </SpreadsheetHeaderMenu>
                    <Show when={!props.readonly && props.onResizeRow}>
                      <div
                        role="separator"
                        aria-label={`Resize row ${row + 1}`}
                        aria-orientation="horizontal"
                        aria-valuenow={rowHeights()[row] / scale()}
                        aria-valuemin={ROW_HEIGHT}
                        aria-valuemax={1000}
                        tabIndex={0}
                        title="Drag to resize · Double-click to fit"
                        class="absolute -bottom-1 left-0 z-[1] h-2 w-full touch-none cursor-row-resize hover:bg-accent/30 focus-visible:bg-accent/30 outline-none"
                        onPointerDown={(event) => {
                          if (event.button !== 0) return;
                          event.preventDefault();
                          event.stopPropagation();
                          rowResizeStart = {
                            y: event.clientY,
                            height: rowHeights()[row] / scale(),
                          };
                          setResizingRow({
                            row,
                            height: rowResizeStart.height,
                          });
                          event.currentTarget.setPointerCapture(
                            event.pointerId
                          );
                        }}
                        onPointerMove={(event) => {
                          if (!rowResizeStart || resizingRow()?.row !== row)
                            return;
                          setResizingRow({
                            row,
                            height: Math.max(
                              ROW_HEIGHT,
                              Math.min(
                                1000,
                                rowResizeStart.height +
                                  (event.clientY - rowResizeStart.y) / scale()
                              )
                            ),
                          });
                        }}
                        onDblClick={() => props.onResizeRow?.(row, undefined)}
                        onKeyDown={(event) => {
                          event.stopPropagation();
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            props.onResizeRow?.(row, undefined);
                          } else if (
                            event.key === 'ArrowUp' ||
                            event.key === 'ArrowDown'
                          ) {
                            event.preventDefault();
                            props.onResizeRow?.(
                              row,
                              Math.max(
                                ROW_HEIGHT,
                                Math.min(
                                  1000,
                                  rowHeights()[row] / scale() +
                                    (event.key === 'ArrowDown' ? 8 : -8)
                                )
                              )
                            );
                          }
                        }}
                      />
                    </Show>
                  </div>
                  <For each={visibleColumns()}>
                    {(column) => {
                      const address = cellAddress({ row, column });
                      const position = { row, column };
                      const active = () => activeCell(address);
                      const selected = () => selectedCell(position);
                      const value = () => props.values[address];
                      const cell = () => props.cells[address];
                      // Conditional formatting draws over the cell's style.
                      const look = () => value()?.conditional;
                      const fill = () => look()?.fillColor ?? cell()?.fillColor;
                      const border = (
                        edge: 'Top' | 'Right' | 'Bottom' | 'Left'
                      ) => {
                        if (!cell()?.[`border${edge}`]) return undefined;
                        const style = cell()?.[`border${edge}Style`] || 'thin';
                        const width =
                          style === 'double' || style === 'thick'
                            ? 3
                            : style.startsWith('medium')
                              ? 2
                              : 1;
                        const line =
                          style === 'double'
                            ? 'double'
                            : style.toLowerCase().includes('dash')
                              ? 'dashed'
                              : style === 'dotted'
                                ? 'dotted'
                                : 'solid';
                        return `${width}px ${line} ${cellBorderColor(cell()?.[`border${edge}Color`], fill())}`;
                      };
                      // A fill covers the gridlines around its cell, as in
                      // Excel; the right and bottom lines are drawn here.
                      const gridline = (edge: 'Right' | 'Bottom') => {
                        const next = cellAddress(
                          edge === 'Right'
                            ? { row, column: column + 1 }
                            : { row: row + 1, column }
                        );
                        return props.showGridlines === false ||
                          fill() ||
                          props.values[next]?.conditional?.fillColor ||
                          props.cells[next]?.fillColor
                          ? '1px solid transparent'
                          : undefined;
                      };
                      // Before calculation reports it, a literal number
                      // still aligns as one.
                      const numeric = () =>
                        value()
                          ? value()!.number !== undefined
                          : literalNumber(cell()) !== undefined;
                      const horizontalAlign = () => {
                        const align = cell()?.horizontalAlign;
                        return align && align !== 'auto'
                          ? align
                          : numeric() &&
                              !(
                                props.showFormulas &&
                                cell()?.value.startsWith('=')
                              )
                            ? 'right'
                            : 'left';
                      };
                      const pending = () =>
                        !!props.pendingFormulas &&
                        !value() &&
                        !props.showFormulas &&
                        !!cell()?.value.startsWith('=') &&
                        cell()?.format !== 'text';
                      const decorated = () =>
                        !!props.mentions &&
                        !(
                          cell()?.value.startsWith('=') &&
                          cell()?.format !== 'text'
                        ) &&
                        /<m-(?:user|document|date)-mention>|https?:\/\/|www\.|[^\s@]+@[^\s@]+\.[^\s@]+/i.test(
                          cell()?.value ?? ''
                        );
                      return (
                        <div
                          id={`${id}-${address}`}
                          role="gridcell"
                          aria-colindex={column + 2}
                          aria-label={`${address}${display(address) ? `: ${display(address)}` : ''}`}
                          aria-selected={selected()}
                          data-address={address}
                          aria-description={
                            [
                              props.comments?.hasComment(address)
                                ? 'Has comments'
                                : '',
                              props.notes?.[address]
                                ? `Note: ${props.notes[address]}`
                                : '',
                            ]
                              .filter(Boolean)
                              .join('. ') || undefined
                          }
                          onMouseEnter={(event) => {
                            if (
                              !props.editing &&
                              !props.formulaEditing &&
                              !event.buttons
                            )
                              props.comments?.enter(
                                address,
                                event.currentTarget
                              );
                          }}
                          onMouseLeave={() => props.comments?.leave()}
                          title={
                            value()?.error ??
                            value()?.warning ??
                            (decorated()
                              ? undefined
                              : cellPlainText(
                                  props.cells[address]?.value ?? ''
                                ).replace(/^'/, ''))
                          }
                          style={{
                            width: width(column),
                            left: `${columnOffsets()[column]}px`,
                            'scroll-margin-top': `${headerHeight()}px`,
                            'scroll-margin-left': `${headerWidth()}px`,
                            'border-top': border('Top'),
                            'border-right':
                              border('Right') ?? gridline('Right'),
                            'border-bottom':
                              border('Bottom') ?? gridline('Bottom'),
                            'border-left': border('Left'),
                            'background-color': cellBackground(fill()),
                            color: cellForeground(
                              look()?.textColor ?? cell()?.textColor,
                              fill()
                            ),
                            'font-family': fontFamily(cell()),
                            'font-size': `${fontPixels(cell(), defaultFontSize()) * scale()}px`,
                            'font-style':
                              (look()?.italic ?? cell()?.italic)
                                ? 'italic'
                                : undefined,
                            'text-decoration-line':
                              [
                                (look()?.underline ?? cell()?.underline)
                                  ? 'underline'
                                  : '',
                                (look()?.strikethrough ?? cell()?.strikethrough)
                                  ? 'line-through'
                                  : '',
                              ]
                                .filter(Boolean)
                                .join(' ') || undefined,
                            'text-align': horizontalAlign(),
                            'justify-content':
                              cell()?.verticalAlign === 'top'
                                ? 'flex-start'
                                : cell()?.verticalAlign === 'bottom'
                                  ? 'flex-end'
                                  : 'center',
                            'padding-block':
                              'var(--spreadsheet-cell-padding-y)',
                            'line-height': CELL_LINE_HEIGHT,
                          }}
                          class="absolute top-0 bottom-0 flex flex-col border-b border-r border-edge-muted bg-panel text-ink select-none"
                          classList={{
                            'font-semibold': look()?.bold ?? cell()?.bold,
                            'tabular-nums': numeric(),
                            'text-failure': !!value()?.error,
                          }}
                          onPointerDown={(event) => {
                            if (
                              event.button !== 0 ||
                              event.ctrlKey ||
                              isInput(event.target)
                            )
                              return;
                            setSelectedDrawing(undefined);
                            setTouchMode(event.pointerType === 'touch');
                            if (event.pointerType === 'touch') {
                              if (event.isPrimary === false) {
                                cancelPointer();
                                return;
                              }
                              // Defer selection until a tap is known; native panning
                              // owns movement and pointercancel without changing cells.
                              touchGesture = {
                                kind: 'tap',
                                pointerId: event.pointerId,
                                x: event.clientX,
                                y: event.clientY,
                                position,
                                moved: false,
                              };
                              keepReferenceFocus = !!(
                                props.editing || props.formulaEditing
                              );
                              return;
                            }
                            event.preventDefault();
                            keepReferenceFocus =
                              props.onReferenceStart?.({ row, column }) ??
                              false;
                            if (keepReferenceFocus) return;
                            dragging = true;
                            props.onSelect({ row, column }, event.shiftKey);
                            focusGrid();
                          }}
                          onPointerEnter={(event) => {
                            if (event.pointerType === 'touch') return;
                            if (props.pickingReference && event.buttons === 1) {
                              props.onReferenceMove?.({ row, column });
                              return;
                            }
                            if (fillSource && event.buttons === 1) {
                              previewFill({ row, column });
                              return;
                            }
                            if (dragging && event.buttons === 1)
                              props.onSelect({ row, column }, true);
                            else dragging = false;
                          }}
                          onDblClick={() => {
                            if (!touchMode() && !props.referenceSelection)
                              props.onEdit();
                          }}
                        >
                          <Show when={look()?.dataBar}>
                            {(bar) => (
                              <span
                                aria-hidden="true"
                                data-data-bar
                                class="pointer-events-none absolute inset-y-0.5"
                                style={{
                                  left: `${Math.min(bar().axis, bar().value) * 100}%`,
                                  width: `${Math.abs(bar().value - bar().axis) * 100}%`,
                                  background: dataBarBackground(bar()),
                                }}
                              />
                            )}
                          </Show>
                          <Show when={look()?.icon}>
                            {(icon) => (
                              <ConditionalIcon
                                name={icon().name}
                                color={icon().color}
                              />
                            )}
                          </Show>
                          <Show
                            when={active() && props.editing}
                            fallback={
                              <div
                                class="relative w-full min-h-0 overflow-hidden text-ellipsis px-[var(--spreadsheet-cell-padding)]"
                                classList={{ 'pl-5': !!look()?.icon }}
                                style={{
                                  'white-space': cell()?.wrap
                                    ? 'pre-wrap'
                                    : 'nowrap',
                                  'overflow-wrap': cell()?.wrap
                                    ? 'anywhere'
                                    : undefined,
                                }}
                              >
                                <Show
                                  when={!pending()}
                                  fallback={
                                    // Results are usually figures, so default to the right.
                                    <div
                                      class="skeleton-shimmer h-2 w-1/2 max-w-16 rounded-full bg-skeleton"
                                      classList={{
                                        'ml-auto':
                                          cell()?.horizontalAlign !== 'left',
                                        'mr-auto':
                                          cell()?.horizontalAlign === 'left' ||
                                          cell()?.horizontalAlign === 'center',
                                      }}
                                      aria-hidden="true"
                                    />
                                  }
                                >
                                  {look()?.showValue === false
                                    ? ''
                                    : decorated()
                                      ? props.mentions!.renderText(
                                          cell()!.value.replace(/^'/, '')
                                        )
                                      : display(address)}
                                </Show>
                              </div>
                            }
                          >
                            <FormulaInput
                              mentions={props.mentions}
                              label={`Edit ${address}`}
                              autoFocus
                              complete={props.complete}
                              readonly={props.readonly}
                              selectionRequest={props.editorSelection}
                              references={props.draftReferences}
                              pickingReference={
                                props.pickingReference ||
                                (isTouchDevice() && !!props.referenceSelection)
                              }
                              onSelectionChange={props.onTextSelection}
                              class="absolute inset-0 size-full resize-none overflow-hidden bg-panel px-[var(--spreadsheet-cell-padding)] py-[var(--spreadsheet-cell-padding-y)] font-normal text-left text-ink outline-none select-text"
                              value={props.draft}
                              onInput={props.onDraft}
                              onKeyDown={editKeyDown}
                              onBlur={() => {
                                if (props.editing) props.onCommit();
                              }}
                            />
                          </Show>
                          <Show when={props.notes?.[address]}>
                            <span
                              aria-hidden="true"
                              data-note-marker
                              class="pointer-events-none absolute right-0 top-0 size-0 border-t-[6px] border-l-[6px] border-t-failure border-l-transparent"
                            />
                          </Show>
                          <Show when={props.comments?.hasComment(address)}>
                            <button
                              type="button"
                              aria-label={`Comments on ${address}`}
                              onKeyDown={(event) => event.stopPropagation()}
                              class="absolute right-0 top-0 z-[3] h-3 w-3 bg-transparent p-0 touch:h-5 touch:w-5"
                              onPointerDown={(event) => event.stopPropagation()}
                              onMouseDown={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                              }}
                              onDblClick={(event) => event.stopPropagation()}
                              onClick={(event) => {
                                event.stopPropagation();
                                props.comments?.show(
                                  address,
                                  event.currentTarget.parentElement!
                                );
                              }}
                            >
                              <span class="pointer-events-none absolute right-0 top-0 size-0 border-t-[7px] border-l-[7px] border-t-accent border-l-transparent" />
                            </button>
                          </Show>
                          <Show when={value()?.error}>
                            <span class="absolute right-0.5 top-0.5 size-1 rounded-full bg-failure" />
                          </Show>
                        </div>
                      );
                    }}
                  </For>
                </div>
              )}
            </For>
            <For each={props.remoteCursors}>
              {(cursor) => (
                <>
                  <div
                    data-remote-selection={cursor.peerId}
                    class="absolute pointer-events-none z-[2] border-2"
                    style={{
                      ...rangeStyle(selectionBounds(cursor.selection)),
                      'border-color': cursor.color,
                      background: `color-mix(in srgb, ${cursor.color} 8%, transparent)`,
                    }}
                  />
                  <div
                    data-remote-cursor={cursor.peerId}
                    aria-label={`${cursor.name}: ${cellAddress(cursor.selection.focus)}`}
                    class="absolute pointer-events-none z-[4] border-2"
                    style={{
                      ...rangeStyle(
                        selectionBounds({
                          anchor: cursor.selection.focus,
                          focus: cursor.selection.focus,
                        })
                      ),
                      'border-color': cursor.color,
                    }}
                  >
                    <span
                      data-remote-cursor-name
                      class="absolute left-[-2px] max-w-40 truncate rounded-t-sm px-1.5 py-0.5 text-[11px] font-medium leading-4 text-surface shadow-sm"
                      style={{
                        background: cursor.color,
                        bottom:
                          cursor.selection.focus.row === 0 ? undefined : '100%',
                        top:
                          cursor.selection.focus.row === 0 ? '100%' : undefined,
                      }}
                    >
                      {cursor.name}
                    </span>
                  </div>
                </>
              )}
            </For>
            <Show when={props.drawings?.length && props.chartData}>
              <SheetDrawingLayer
                drawings={props.drawings ?? []}
                place={placeDrawing}
                bounds={{
                  left: columnOffsets()[0],
                  top: rowOffsets()[0],
                }}
                scale={scale()}
                image={(key) => props.image?.(key)}
                chartData={(chart) => props.chartData!(chart)}
                cellText={(reference) => props.cellText?.(reference)}
                font={props.defaultFont?.name}
                selected={selectedDrawing()}
                readonly={props.readonly || !props.onPlaceDrawing}
                onSelect={setSelectedDrawing}
                onDelete={(id) => {
                  setSelectedDrawing(undefined);
                  props.onDeleteDrawing?.(id);
                }}
                onPlace={(id, rect) => {
                  const drawing = props.drawings?.find(
                    (value) => value.id === id
                  );
                  if (drawing)
                    props.onPlaceDrawing?.(id, placementOf(drawing, rect));
                }}
                onEdit={(id) => props.onEditDrawing?.(id)}
                onCycle={(id, backwards) => {
                  const order = drawingOrder();
                  const index = order.findIndex((value) => value.id === id);
                  const next =
                    order[
                      (index + (backwards ? -1 : 1) + order.length) %
                        order.length
                    ];
                  if (next) revealDrawing(next.id);
                }}
                onReturnFocus={focusGrid}
              />
            </Show>
            <div
              aria-hidden="true"
              data-selection-range
              class="pointer-events-none absolute z-[1] border border-accent bg-accent/10"
              style={rangeStyle()}
            />
            <div
              aria-hidden="true"
              data-selection-active
              class="pointer-events-none absolute z-[2] border-2 border-accent"
              style={activeStyle()}
            />
            <Show
              when={
                !props.readonly &&
                !props.editing &&
                !props.formulaEditing &&
                !!props.listItems?.length &&
                props.listItems
              }
            >
              {(items) => {
                const address = () => cellAddress(props.selection.anchor);
                const size = () =>
                  Math.min(
                    rowHeights()[props.selection.anchor.row],
                    LIST_BUTTON_SIZE * scale()
                  );
                return (
                  <CellListMenu
                    address={address()}
                    items={items()}
                    open={listOpenAt() === address()}
                    onOpenChange={(open) =>
                      setListOpenAt(open ? address() : undefined)
                    }
                    style={{
                      left: `${columnOffsets()[props.selection.anchor.column + 1] + 1}px`,
                      top: `${rowOffsets()[props.selection.anchor.row + 1] - size()}px`,
                      width: `${size()}px`,
                      height: `${size()}px`,
                    }}
                    onPick={(item) => props.onPickListItem?.(item)}
                    onRestoreFocus={focusGrid}
                  />
                );
              }}
            </Show>
            <Show
              when={
                !props.editing &&
                !props.pickingReference &&
                listOpenAt() !== cellAddress(props.selection.anchor) &&
                (props.inputMessage ||
                  props.notes?.[cellAddress(props.selection.anchor)])
              }
            >
              <div
                data-cell-note
                class="pointer-events-none absolute z-[5] max-w-64 whitespace-pre-wrap break-words rounded-md border border-edge-muted bg-surface px-2 py-1.5 text-xs leading-4 text-ink shadow-md"
                style={{
                  left: `${columnOffsets()[props.selection.anchor.column] + 8}px`,
                  top: `${rowOffsets()[props.selection.anchor.row + 1] + 4}px`,
                }}
              >
                <Show when={props.inputMessage}>
                  {(message) => (
                    <p>
                      <Show when={message().title}>
                        <strong class="block font-semibold">
                          {message().title}
                        </strong>
                      </Show>
                      {message().message}
                    </p>
                  )}
                </Show>
                <Show when={props.notes?.[cellAddress(props.selection.anchor)]}>
                  {(note) => (
                    <p
                      classList={{
                        'mt-1.5 border-t border-edge-muted pt-1.5':
                          !!props.inputMessage,
                      }}
                    >
                      {note()}
                    </p>
                  )}
                </Show>
              </div>
            </Show>
            <For each={props.referenceHighlights}>
              {(highlight) => (
                <div
                  aria-hidden="true"
                  data-formula-highlight
                  class="pointer-events-none absolute z-[3] border-2"
                  style={{
                    ...rangeStyle(highlight.bounds),
                    'border-color': highlight.color,
                    background: `color-mix(in srgb, ${highlight.color} 10%, transparent)`,
                  }}
                />
              )}
            </For>
            <Show when={props.referenceSelection}>
              {(range) => (
                <div
                  aria-hidden="true"
                  data-formula-reference
                  class="pointer-events-none absolute z-[3] border-2 border-dashed border-accent bg-accent/10"
                  style={rangeStyle(selectionBounds(range()))}
                />
              )}
            </Show>
            <Show
              when={
                !touchMode() &&
                !props.readonly &&
                !props.editing &&
                !props.formulaEditing &&
                props.onFill
              }
            >
              <button
                type="button"
                tabIndex={-1}
                aria-label="Drag to fill selection"
                title="Drag to fill · ⌘/Ctrl D fills down · ⌘/Ctrl R fills right"
                class="absolute z-[3] size-2.5 border-2 border-surface bg-accent cursor-crosshair touch-none"
                style={{
                  left: `${columnOffsets()[bounds().right + 1] - 5}px`,
                  top: `${rowOffsets()[bounds().bottom + 1] - 5}px`,
                }}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  event.stopPropagation();
                  props.onCommit();
                  fillGeneration++;
                  fillSource = props.selection;
                  setFillTarget(props.selection);
                  focusGrid();
                }}
              />
            </Show>
            <Show
              when={
                touchMode() &&
                (props.referenceSelection ||
                  (!props.editing && !props.formulaEditing))
              }
            >
              <For each={[true, false]}>
                {(start) => (
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={`Move ${props.referenceSelection ? 'reference' : 'selection'} ${start ? 'start' : 'end'}`}
                    class="absolute z-[4] flex size-[44px] touch-none select-none items-center justify-center outline-none"
                    style={{
                      left: `${columnOffsets()[start ? selectionBounds(touchRange()).left : selectionBounds(touchRange()).right + 1] - 22}px`,
                      top: `${rowOffsets()[start ? selectionBounds(touchRange()).top : selectionBounds(touchRange()).bottom + 1] - 22}px`,
                    }}
                    onPointerDown={(event) => startTouchHandle(event, start)}
                    onMouseDown={(event) => event.preventDefault()}
                  >
                    <span class="pointer-events-none size-3 rounded-full border-2 border-surface bg-accent shadow-sm" />
                  </button>
                )}
              </For>
            </Show>
          </div>
        </div>
      )}
    </SpreadsheetCellMenu>
  );
}
