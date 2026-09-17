import { isTouchDevice } from '@core/mobile/isTouchDevice';
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
import { SPREADSHEET_CLIPBOARD_TYPE } from '../core/cell-copy';
import type { FormulaTextSelection } from '../core/formula-reference';
import {
  type CellPosition,
  type CellSelection,
  cellAddress,
  GRID_COLUMNS,
  GRID_ROWS,
  selectionBounds,
} from '../core/grid-selection';
import {
  DEFAULT_COLUMN_WIDTH,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  parseCellAddress,
  type SpreadsheetCell,
  type SpreadsheetCells,
} from '../core/spreadsheet-document';
import type { SpreadsheetCursor } from '../core/spreadsheet-presence';
import type { CompleteFormula } from '../primitives/create-formula-assistance';
import { FormulaInput } from './FormulaInput';

export type GridValue = { display: string; number?: number; error?: string };

const ROW_HEIGHT = 21;
const COLUMN_HEADER_HEIGHT = 24;
const ROW_HEADER_WIDTH = 46;
const CELL_PADDING_X = 3;
const CELL_PADDING_Y = 2;
const CELL_LINE_HEIGHT = 1.2;
const MAX_ROW_HEIGHT = 160;
const TOUCH_SLOP = 8;

function fontPixels(cell?: SpreadsheetCell) {
  return ((cell?.fontSize ?? 10) * 4) / 3;
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
  sheetId?: string;
  complete?: CompleteFormula;
  rowCount?: number;
  columnWidths?: Record<number, number>;
  zoom?: number;
  showGridlines?: boolean;
  showFormulas?: boolean;
  onResizeColumn?: (column: number, width: number) => void;
  onFill?: (source: CellSelection, target: CellSelection) => void;
  onCopyMetadata?: (cut?: boolean) => string;
  values: Record<string, GridValue>;
  remoteCursors: SpreadsheetCursor[];
  selection: CellSelection;
  editing: boolean;
  formulaEditing?: boolean;
  editorSelection?: FormulaTextSelection;
  referenceSelection?: CellSelection;
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
  const [touchMode, setTouchMode] = createSignal(isTouchDevice());
  const scale = () => Math.max(0.5, Math.min(2, (props.zoom ?? 100) / 100));
  const headerHeight = () => COLUMN_HEADER_HEIGHT * scale();
  const headerWidth = () => ROW_HEADER_WIDTH * scale();
  const rowCount = () => props.rowCount ?? GRID_ROWS;
  const columns = Array.from({ length: GRID_COLUMNS }, (_, index) => index);
  const [fillTarget, setFillTarget] = createSignal<CellSelection>();
  const [resizing, setResizing] = createSignal<{
    column: number;
    width: number;
  }>();
  let fillSource: CellSelection | undefined;
  let resizeStart: { x: number; width: number } | undefined;
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
  const display = (address: string) =>
    props.showFormulas && props.cells[address]?.value.startsWith('=')
      ? props.cells[address].value
      : (props.values[address]?.display ?? props.cells[address]?.value ?? '');
  const rootStyle = getComputedStyle(document.documentElement);
  const fontFamilies = {
    sans: rootStyle.getPropertyValue('--font-sans') || 'sans-serif',
    serif: rootStyle.getPropertyValue('--font-serif') || 'serif',
    mono: rootStyle.getPropertyValue('--font-mono') || 'monospace',
  };
  const fontFamily = (cell?: SpreadsheetCell) =>
    fontFamilies[cell?.fontFamily ?? 'sans'];
  // No cell measurement runs on pointer movement: only document, calculation,
  // column width, and zoom changes invalidate row geometry.
  const context =
    typeof CanvasRenderingContext2D === 'undefined'
      ? null
      : document.createElement('canvas').getContext('2d');
  const rowHeights = createMemo(() => {
    const heights = Array<number>(rowCount()).fill(ROW_HEIGHT);
    // Gridlines stay one CSS pixel wide when the workbook is zoomed.
    const borderInset = 1 / scale();
    for (const [address, cell] of Object.entries(props.cells)) {
      const position = parseCellAddress(address);
      if (!position || position.row >= heights.length) continue;
      const pixels = fontPixels(cell);
      const lineHeight = pixels * CELL_LINE_HEIGHT;
      const verticalInset = CELL_PADDING_Y * 2 + borderInset;
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
    return heights.map((height) => height * scale());
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
    for (let row = 0; row < rowCount(); row++) {
      if (offsets[row + 1] >= top && offsets[row] <= bottom) visible.push(row);
    }
    return visible;
  });
  const visibleRows = createMemo(() =>
    [
      ...new Set([
        ...viewportRows(),
        props.selection.anchor.row,
        props.selection.focus.row,
      ]),
    ].sort((a, b) => a - b)
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
    for (const column of columns)
      offsets.push(offsets[column] + Number.parseFloat(width(column)));
    return offsets;
  });
  const rangeStyle = (area = bounds()) => {
    const offsets = columnOffsets();
    return {
      left: `${offsets[area.left]}px`,
      top: `${rowOffsets()[area.top]}px`,
      width: `${offsets[area.right + 1] - offsets[area.left]}px`,
      height: `${rowOffsets()[area.bottom + 1] - rowOffsets()[area.top]}px`,
    };
  };
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
    props.onReferenceEnd?.();
    const target = fillTarget();
    if (fillSource && target && !props.readonly)
      props.onFill?.(fillSource, target);
    fillSource = undefined;
    setFillTarget(undefined);
    const resize = resizing();
    if (resize && !props.readonly)
      props.onResizeColumn?.(resize.column, resize.width);
    setResizing(undefined);
    resizeStart = undefined;
  }

  function cancelPointer() {
    stopTouchGesture();
    lastTap = undefined;
    dragging = false;
    keepReferenceFocus = false;
    props.onReferenceEnd?.();
    fillSource = undefined;
    setFillTarget(undefined);
    setResizing(undefined);
    resizeStart = undefined;
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
    let measured = MIN_COLUMN_WIDTH;
    for (let row = 0; row < rowCount(); row++) {
      const address = cellAddress({ row, column });
      const cell = props.cells[address];
      context.font = `${cell?.italic ? 'italic ' : ''}${cell?.bold ? 600 : 400} ${fontPixels(cell)}px ${fontFamily(cell)}`;
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
    target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
  const focusGrid = () => grid.focus({ preventScroll: true });

  function positionAtPoint(x: number, y: number): CellPosition {
    const rect = grid.getBoundingClientRect();
    const column = columnOffsets().findIndex(
      (offset) => offset > x - rect.left + grid.scrollLeft
    );
    const row = rowOffsets().findIndex(
      (offset) => offset > y - rect.top + grid.scrollTop
    );
    return {
      row: Math.max(0, row < 0 ? rowCount() - 1 : row - 1),
      column: Math.max(0, column < 0 ? GRID_COLUMNS - 1 : column - 1),
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

  return (
    <div
      ref={(element) => {
        grid = element;
        setScrollElement(element);
      }}
      role="grid"
      aria-label="Spreadsheet"
      aria-rowcount={rowCount() + 1}
      aria-colcount={GRID_COLUMNS + 1}
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
      onKeyDown={(event) => {
        if (isInput(event.target)) return;
        event.stopPropagation();
        props.onKeyDown(event);
        if (!props.editing) revealSelection();
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
            event.clipboardData.getData(SPREADSHEET_CLIPBOARD_TYPE) || undefined
          );
      }}
    >
      <div
        class="relative w-max min-w-full"
        style={{ height: `${rowOffsets()[rowCount()]}px` }}
      >
        <div
          role="row"
          aria-rowindex={1}
          class="sticky top-0 z-20 flex bg-panel text-ink-muted font-medium select-none"
          style={{
            height: `${headerHeight()}px`,
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
                  { row: rowCount() - 1, column: GRID_COLUMNS - 1 }
                );
                focusGrid();
              }}
            >
              ▦
            </button>
          </div>
          <For each={columns}>
            {(column) => (
              <div
                role="columnheader"
                aria-colindex={column + 2}
                style={{ width: width(column) }}
                class="relative shrink-0 border-b border-r border-edge-muted"
                classList={{
                  'bg-accent-bg text-accent':
                    column >= bounds().left && column <= bounds().right,
                }}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={`Select column ${String.fromCharCode(65 + column)}`}
                  class="size-full hover:bg-hover"
                  onClick={() => {
                    props.onSelectRange(
                      { row: 0, column },
                      { row: rowCount() - 1, column }
                    );
                    focusGrid();
                  }}
                >
                  {String.fromCharCode(65 + column)}
                </button>
                <Show when={!props.readonly && props.onResizeColumn}>
                  <div
                    role="separator"
                    aria-label={`Resize column ${String.fromCharCode(65 + column)}`}
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
                          props.columnWidths?.[column] ?? DEFAULT_COLUMN_WIDTH,
                      };
                      setResizing({ column, width: resizeStart.width });
                      event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                    onPointerMove={(event) => {
                      if (!resizeStart || resizing()?.column !== column) return;
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
              class="absolute left-0 flex w-max min-w-full"
              style={{
                top: `${rowOffsets()[row]}px`,
                height: `${rowHeights()[row]}px`,
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
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={`Select row ${row + 1}`}
                  class="size-full hover:bg-hover"
                  onClick={() => {
                    props.onSelectRange(
                      { row, column: 0 },
                      { row, column: GRID_COLUMNS - 1 }
                    );
                    focusGrid();
                  }}
                >
                  {row + 1}
                </button>
              </div>
              <For each={columns}>
                {(column) => {
                  const address = cellAddress({ row, column });
                  const position = { row, column };
                  const active = () => activeCell(address);
                  const selected = () => selectedCell(position);
                  const value = () => props.values[address];
                  const cell = () => props.cells[address];
                  const borders = () => {
                    const shadows = [];
                    if (cell()?.borderTop)
                      shadows.push('inset 0 1px 0 var(--color-ink)');
                    if (cell()?.borderRight)
                      shadows.push('inset -1px 0 0 var(--color-ink)');
                    if (cell()?.borderBottom)
                      shadows.push('inset 0 -1px 0 var(--color-ink)');
                    if (cell()?.borderLeft)
                      shadows.push('inset 1px 0 0 var(--color-ink)');
                    return shadows.join(', ') || undefined;
                  };
                  const horizontalAlign = () => {
                    const align = cell()?.horizontalAlign;
                    return align && align !== 'auto'
                      ? align
                      : value()?.number !== undefined &&
                          !(props.showFormulas && cell()?.value.startsWith('='))
                        ? 'right'
                        : 'left';
                  };
                  return (
                    <div
                      id={`${id}-${address}`}
                      role="gridcell"
                      aria-colindex={column + 2}
                      aria-label={`${address}${display(address) ? `: ${display(address)}` : ''}`}
                      aria-selected={selected()}
                      data-address={address}
                      title={value()?.error ?? props.cells[address]?.value}
                      style={{
                        width: width(column),
                        'scroll-margin-top': `${headerHeight()}px`,
                        'scroll-margin-left': `${headerWidth()}px`,
                        'box-shadow': borders(),
                        'border-color':
                          props.showGridlines === false
                            ? 'transparent'
                            : undefined,
                        'background-color': cell()?.fillColor || undefined,
                        color: cell()?.textColor || undefined,
                        'font-family': fontFamily(cell()),
                        'font-size': `${fontPixels(cell()) * scale()}px`,
                        'font-style': cell()?.italic ? 'italic' : undefined,
                        'text-decoration-line':
                          [
                            cell()?.underline ? 'underline' : '',
                            cell()?.strikethrough ? 'line-through' : '',
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
                        'padding-block': 'var(--spreadsheet-cell-padding-y)',
                        'line-height': CELL_LINE_HEIGHT,
                      }}
                      class="relative flex flex-col shrink-0 border-b border-r border-edge-muted bg-surface text-ink select-none"
                      classList={{
                        'font-semibold': cell()?.bold,
                        'tabular-nums': value()?.number !== undefined,
                        'text-failure': !!value()?.error,
                      }}
                      onPointerDown={(event) => {
                        if (event.button !== 0 || isInput(event.target)) return;
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
                          props.onReferenceStart?.({ row, column }) ?? false;
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
                      <Show
                        when={active() && props.editing}
                        fallback={
                          <div
                            class="w-full min-h-0 overflow-hidden text-ellipsis px-[var(--spreadsheet-cell-padding)]"
                            style={{
                              'white-space': cell()?.wrap
                                ? 'pre-wrap'
                                : 'nowrap',
                              'overflow-wrap': cell()?.wrap
                                ? 'anywhere'
                                : undefined,
                            }}
                          >
                            {display(address)}
                          </div>
                        }
                      >
                        <FormulaInput
                          label={`Edit ${address}`}
                          autoFocus
                          complete={props.complete}
                          readonly={props.readonly}
                          selectionRequest={props.editorSelection}
                          pickingReference={
                            props.pickingReference ||
                            (isTouchDevice() && !!props.referenceSelection)
                          }
                          onSelectionChange={props.onTextSelection}
                          class="absolute inset-0 size-full resize-none overflow-hidden bg-surface px-[var(--spreadsheet-cell-padding)] py-[var(--spreadsheet-cell-padding-y)] font-normal text-left text-ink outline-none select-text"
                          value={props.draft}
                          onInput={props.onDraft}
                          onKeyDown={editKeyDown}
                          onBlur={props.onCommit}
                        />
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
                    top: cursor.selection.focus.row === 0 ? '100%' : undefined,
                  }}
                >
                  {cursor.name}
                </span>
              </div>
            </>
          )}
        </For>
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
  );
}
