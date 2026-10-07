import { createMemo, createSignal, onCleanup } from 'solid-js';

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

/** Mouse ranges leave ordinary clicks and open cell editors to their existing controls. */
export function createCellSelection(options: {
  rows: () => string[];
  columns: () => string[];
  cellAt: (target: EventTarget | null) => CellAddress | undefined;
  onChange: (range: CellRange | undefined) => void;
  focus: () => void;
  onClear?: (rows: string[], columns: string[]) => Promise<boolean>;
}) {
  const [range, setRange] = createSignal<CellRange>();
  const rowIndex = createMemo(
    () => new Map(options.rows().map((id, index) => [id, index]))
  );
  const columnIndex = createMemo(
    () => new Map(options.columns().map((id, index) => [id, index]))
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
      void (async () => {
        try {
          await options.onClear?.(
            options.rows().slice(current.top, current.bottom + 1),
            options.columns().slice(current.left, current.right + 1)
          );
        } finally {
          clearing = false;
        }
      })();
    },
  };
}
