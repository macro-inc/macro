import { fireAndForget } from '@core/util/fireAndForget';
import { createMemo, createSignal, onCleanup } from 'solid-js';
import { match } from 'ts-pattern';

export type CellAddress = { rowId: string; columnId: string };
export type CellRange = { anchor: CellAddress; focus: CellAddress };

/** Resolve identity-based corners against the current view, including reversed drags. */
export function cellRangeBounds(
  range: CellRange,
  rows: Map<string, number>,
  columns: Map<string, number>
) {
  const a = rows.get(range.anchor.rowId);
  const b = rows.get(range.focus.rowId);
  const x = columns.get(range.anchor.columnId);
  const y = columns.get(range.focus.columnId);
  if (a === undefined || b === undefined || x === undefined || y === undefined)
    return;
  return {
    top: Math.min(a, b),
    bottom: Math.max(a, b),
    left: Math.min(x, y),
    right: Math.max(x, y),
  };
}

export type CellRangeMove = {
  key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End';
  /** Cmd/Ctrl: run to the edge of the data. */
  toEdge: boolean;
};

const RANGE_KEYS = new Set<string>([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
]);

/** Move a range's focus corner like a spreadsheet's Shift+key, keeping its anchor and stopping at the grid's edges. */
export function extendCellRange(
  range: CellRange,
  move: CellRangeMove,
  rows: string[],
  columns: string[]
): CellRange {
  const row = rows.indexOf(range.focus.rowId);
  const column = columns.indexOf(range.focus.columnId);
  if (row < 0 || column < 0) return range;
  const lastRow = rows.length - 1;
  const lastColumn = columns.length - 1;
  const [nextRow, nextColumn] = match(move)
    .with({ key: 'Home' }, () => [row, 0])
    .with({ key: 'End' }, () => [row, lastColumn])
    .with({ key: 'ArrowUp', toEdge: true }, () => [0, column])
    .with({ key: 'ArrowUp' }, () => [Math.max(row - 1, 0), column])
    .with({ key: 'ArrowDown', toEdge: true }, () => [lastRow, column])
    .with({ key: 'ArrowDown' }, () => [Math.min(row + 1, lastRow), column])
    .with({ key: 'ArrowLeft', toEdge: true }, () => [row, 0])
    .with({ key: 'ArrowLeft' }, () => [row, Math.max(column - 1, 0)])
    .with({ key: 'ArrowRight', toEdge: true }, () => [row, lastColumn])
    .with({ key: 'ArrowRight' }, () => [row, Math.min(column + 1, lastColumn)])
    .exhaustive();
  return {
    anchor: range.anchor,
    focus: { rowId: rows[nextRow]!, columnId: columns[nextColumn]! },
  };
}

/** Mouse and keyboard ranges leave ordinary clicks and open cell editors to their existing controls. */
export function createCellSelection(options: {
  rows: () => string[];
  columns: () => string[];
  /** Rows a range may take in, e.g. not the blank new-record row. */
  canSelectRow: (rowId: string) => boolean;
  cellAt: (target: EventTarget | null) => CellAddress | undefined;
  onChange: (range: CellRange | undefined) => void;
  focus: () => void;
  /** Focus, and so scroll to, the corner a keyboard range moved to. */
  focusCell: (cell: CellAddress) => void;
  onClear?: (rows: string[], columns: string[]) => Promise<boolean>;
}) {
  const [range, setRange] = createSignal<CellRange>();
  const rowIndex = createMemo(
    () => new Map(options.rows().map((id, index) => [id, index]))
  );
  const columnIndex = createMemo(
    () => new Map(options.columns().map((id, index) => [id, index]))
  );
  const selectableRows = createMemo(() =>
    options.rows().filter(options.canSelectRow)
  );
  const bounds = createMemo(() => {
    const selected = range();
    return selected && cellRangeBounds(selected, rowIndex(), columnIndex());
  });
  let anchor: CellAddress | undefined;
  let drag:
    | { start: CellAddress; x: number; y: number; active: boolean }
    | undefined;
  let suppressClick = false;
  let clearing = false;
  const select = (next: CellRange | undefined) => {
    setRange(next);
    options.onChange(next);
  };
  const isEditor = (target: EventTarget | null) =>
    target instanceof Element &&
    !!target.closest(
      'input:not([type="checkbox"]), textarea, [contenteditable="true"], [role="menu"], [role="dialog"]'
    );
  const pointerDown = (event: PointerEvent) => {
    if (
      event.button !== 0 ||
      event.pointerType === 'touch' ||
      isEditor(event.target)
    )
      return;
    const cell = options.cellAt(event.target);
    if (!cell) return;
    if (event.shiftKey && anchor) {
      event.preventDefault();
      event.stopPropagation();
      suppressClick = true;
      select({ anchor, focus: cell });
      (event.target as HTMLElement)
        .closest<HTMLElement>('[data-grid-cell]')
        ?.focus();
      return;
    }
    anchor = cell;
    if (range()) select(undefined);
    drag = { start: cell, x: event.clientX, y: event.clientY, active: false };
  };
  const pointerMove = (event: PointerEvent) => {
    if (!drag) return;
    const cell = options.cellAt(
      document.elementFromPoint(event.clientX, event.clientY)
    );
    if (
      !cell ||
      (!drag.active &&
        Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5)
    )
      return;
    drag.active = true;
    suppressClick = true;
    event.preventDefault();
    document.getSelection()?.removeAllRanges();
    select({ anchor: drag.start, focus: cell });
  };
  const pointerUp = () => {
    if (drag?.active) {
      options.focus();
    }
    drag = undefined;
    setTimeout(() => {
      suppressClick = false;
    }, 0);
  };
  document.addEventListener('pointermove', pointerMove, {
    capture: true,
    passive: false,
  });
  document.addEventListener('pointerup', pointerUp, true);
  document.addEventListener('pointercancel', pointerUp, true);
  onCleanup(() => {
    document.removeEventListener('pointermove', pointerMove, true);
    document.removeEventListener('pointerup', pointerUp, true);
    document.removeEventListener('pointercancel', pointerUp, true);
  });
  return {
    range,
    clear: () => select(undefined),
    bounds,
    rowIndex,
    columnIndex,
    contains: (row: number, column: number) => {
      const current = bounds();
      return (
        !!current &&
        row >= current.top &&
        row <= current.bottom &&
        column >= current.left &&
        column <= current.right
      );
    },
    pointerDown,
    click: (event: MouseEvent) => {
      if (!suppressClick) return;
      event.preventDefault();
      event.stopPropagation();
      suppressClick = false;
    },
    keyDown: (event: KeyboardEvent) => {
      if (event.isComposing || isEditor(event.target)) return;
      const command = event.metaKey || event.ctrlKey;
      if (
        command &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === 'a' &&
        options.cellAt(event.target)
      ) {
        const rows = selectableRows();
        const columns = options.columns();
        if (!rows.length || !columns.length) return;
        event.preventDefault();
        event.stopPropagation();
        anchor = { rowId: rows[0]!, columnId: columns[0]! };
        select({
          anchor,
          focus: { rowId: rows.at(-1)!, columnId: columns.at(-1)! },
        });
        return;
      }
      if (event.shiftKey && !event.altKey && RANGE_KEYS.has(event.key)) {
        const cell = options.cellAt(event.target);
        const current = range() ?? (cell && { anchor: cell, focus: cell });
        if (!current) return;
        event.preventDefault();
        event.stopPropagation();
        const next = extendCellRange(
          current,
          { key: event.key as CellRangeMove['key'], toEdge: command },
          selectableRows(),
          options.columns()
        );
        if (
          !range() &&
          next.focus.rowId === current.focus.rowId &&
          next.focus.columnId === current.focus.columnId
        )
          return;
        anchor = next.anchor;
        select(next);
        options.focusCell(next.focus);
        return;
      }
      // A plain arrow collapses the range; the grid then moves focus as usual.
      if (
        event.key.startsWith('Arrow') &&
        !event.shiftKey &&
        !command &&
        !event.altKey &&
        range()
      ) {
        select(undefined);
        return;
      }
      if (event.key === 'Escape' && range()) {
        event.preventDefault();
        event.stopPropagation();
        select(undefined);
        return;
      }
      if (
        (event.key !== 'Delete' && event.key !== 'Backspace') ||
        !bounds() ||
        !options.onClear
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      if (clearing) return;
      const current = bounds()!;
      clearing = true;
      fireAndForget(
        (async () => {
          try {
            await options.onClear?.(
              options.rows().slice(current.top, current.bottom + 1),
              options.columns().slice(current.left, current.right + 1)
            );
          } finally {
            clearing = false;
          }
        })(),
        'database'
      );
    },
  };
}
