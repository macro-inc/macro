import { mdStore } from '@block-md/signal/markdownBlockData';
import { ScopedPortal } from '@core/component/ScopedPortal';
import clickOutside from '@core/directive/clickOutside';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import {
  $computeTableMap,
  $deleteTableColumnAtSelection,
  $deleteTableRowAtSelection,
  $getTableCellNodeFromLexicalNode,
  $getTableNodeFromLexicalNodeOrThrow,
  $insertTableColumnAtSelection,
  $insertTableRowAtSelection,
  $isTableCellNode,
  $isTableSelection,
  getDOMCellFromTarget,
  type TableCellNode,
} from '@lexical/table';
import ColumnsIcon from '@phosphor/columns.svg';
import ColumnsPlusLeftIcon from '@phosphor/columns-plus-left.svg';
import ColumnsPlusRightIcon from '@phosphor/columns-plus-right.svg';
import DotsIcon from '@phosphor/dots-six-vertical.svg';
import RowsIcon from '@phosphor/rows.svg';
import RowsPlusBottomIcon from '@phosphor/rows-plus-bottom.svg';
import RowsPlusTopIcon from '@phosphor/rows-plus-top.svg';
import TableIcon from '@phosphor/table.svg';
import { createCallback } from '@solid-primitives/rootless';
import {
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  BLUR_COMMAND,
  COMMAND_PRIORITY_LOW,
  FOCUS_COMMAND,
  SELECTION_CHANGE_COMMAND,
} from 'lexical';
import {
  type Component,
  type ComponentProps,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from 'solid-js';
import { $moveCellRange } from '../../plugins/tables/tableMove';

false && clickOutside;

const DRAG_THRESHOLD_PX = 4;

type MenuItem = {
  label: string;
  icon: Component<ComponentProps<'svg'>>;
  action: (cell: TableCellNode) => void;
  // Spans both grid columns.
  wide?: boolean;
};

const INSERT_ITEMS: MenuItem[] = [
  {
    label: 'Column left',
    icon: ColumnsPlusLeftIcon,
    action: () => $insertTableColumnAtSelection(false),
  },
  {
    label: 'Column right',
    icon: ColumnsPlusRightIcon,
    action: () => $insertTableColumnAtSelection(true),
  },
  {
    label: 'Row above',
    icon: RowsPlusTopIcon,
    action: () => $insertTableRowAtSelection(false),
  },
  {
    label: 'Row below',
    icon: RowsPlusBottomIcon,
    action: () => $insertTableRowAtSelection(true),
  },
];

const DELETE_ITEMS: MenuItem[] = [
  {
    label: 'Delete row',
    icon: RowsIcon,
    action: () => $deleteTableRowAtSelection(),
  },
  {
    label: 'Delete column',
    icon: ColumnsIcon,
    action: () => $deleteTableColumnAtSelection(),
  },
  {
    label: 'Delete table',
    icon: TableIcon,
    wide: true,
    action: (cell) => $getTableNodeFromLexicalNodeOrThrow(cell).remove(),
  },
];

const MENU_WIDTH_PX = 232;
const MENU_MAX_HEIGHT_PX = 200;

type DropTarget = {
  cellElem: HTMLElement;
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;
};

type DragShape = {
  rows: number;
  columns: number;
};

/**
 * Grab handle pinned to the top-right corner of the cell (or multi-cell
 * selection) the cursor is in. Dragging it moves the selected cells'
 * contents to the cell dropped on, via the same grid-overlay pipeline as
 * pasting a copied range.
 */
export function TableMoveHandle() {
  const mdData = mdStore.get;
  const editor = () => mdData.editor;

  const [anchorCellKey, setAnchorCellKey] = createSignal<string>();
  const [focusCellKey, setFocusCellKey] = createSignal<string>();
  // Bumped on scroll/resize/updates to recompute viewport-fixed positions.
  const [layoutTick, setLayoutTick] = createSignal(0);
  const bumpLayout = () => setLayoutTick((t) => t + 1);

  const [dragging, setDragging] = createSignal(false);
  const [dropTarget, setDropTarget] = createSignal<DropTarget>();
  // Touch-only dropdown with insert/delete actions, opened by tapping the
  // handle without dragging it.
  const [menuOpen, setMenuOpen] = createSignal(false);

  const initialRootElement = editor()?.getRootElement();
  const [editorFocused, setEditorFocused] = createSignal(
    !!initialRootElement && initialRootElement.contains(document.activeElement)
  );

  const trackSelection = createCallback(() => {
    // Keep the handle (and the selection it represents) frozen mid-drag.
    if (dragging()) return;
    const currentEditor = editor();
    if (!currentEditor) return;
    currentEditor.read(() => {
      const selection = $getSelection();
      if ($isTableSelection(selection)) {
        const anchorCell = $getTableCellNodeFromLexicalNode(
          selection.anchor.getNode()
        );
        const focusCell = $getTableCellNodeFromLexicalNode(
          selection.focus.getNode()
        );
        setAnchorCellKey(anchorCell?.getKey());
        setFocusCellKey(focusCell?.getKey());
        return;
      }
      if ($isRangeSelection(selection)) {
        const cell = $getTableCellNodeFromLexicalNode(
          selection.anchor.getNode()
        );
        setAnchorCellKey(cell?.getKey());
        setFocusCellKey(cell?.getKey());
        return;
      }
      setAnchorCellKey(undefined);
      setFocusCellKey(undefined);
    });
  });

  const removeSelectionListener = editor()?.registerCommand(
    SELECTION_CHANGE_COMMAND,
    () => {
      trackSelection();
      return false;
    },
    COMMAND_PRIORITY_LOW
  );
  const removeUpdateListener = editor()?.registerUpdateListener(() => {
    trackSelection();
    bumpLayout();
  });

  // Escape (via @lexical/rich-text) and clicking elsewhere blur the editor
  // without clearing its selection, which would otherwise leave the handle
  // floating over a selection that is no longer visible.
  const removeFocusListener = editor()?.registerCommand(
    FOCUS_COMMAND,
    () => {
      setEditorFocused(true);
      return false;
    },
    COMMAND_PRIORITY_LOW
  );
  const removeBlurListener = editor()?.registerCommand(
    BLUR_COMMAND,
    () => {
      setEditorFocused(false);
      return false;
    },
    COMMAND_PRIORITY_LOW
  );

  document.addEventListener('scroll', bumpLayout, {
    capture: true,
    passive: true,
  });
  window.addEventListener('resize', bumpLayout);

  onCleanup(() => {
    removeSelectionListener?.();
    removeUpdateListener?.();
    removeFocusListener?.();
    removeBlurListener?.();
    document.removeEventListener('scroll', bumpLayout, { capture: true });
    window.removeEventListener('resize', bumpLayout);
  });

  // Top-right corner of the union of the anchor and focus cells (opposite
  // corners of a table selection; the same cell for a caret selection).
  const handlePosition = createMemo(() => {
    layoutTick();
    if (!editorFocused() && !dragging() && !menuOpen()) return;
    const currentEditor = editor();
    const aKey = anchorCellKey();
    const fKey = focusCellKey();
    if (!currentEditor || !aKey || !fKey) return;

    const anchorElem = currentEditor.getElementByKey(aKey);
    const focusElem = currentEditor.getElementByKey(fKey);
    if (!anchorElem || !focusElem) return;

    const a = anchorElem.getBoundingClientRect();
    const f = focusElem.getBoundingClientRect();
    return {
      x: Math.min(Math.max(a.right, f.right), window.innerWidth),
      y: Math.min(a.top, f.top),
    };
  });

  // Row×column footprint of the dragged range, captured when the drag
  // starts so the drop preview can mirror it.
  const dragShape = createCallback((): DragShape => {
    const fallback: DragShape = { rows: 1, columns: 1 };
    const currentEditor = editor();
    if (!currentEditor) return fallback;
    return currentEditor.read(() => {
      const aKey = anchorCellKey();
      const fKey = focusCellKey();
      const anchorCell = aKey ? $getNodeByKey(aKey) : null;
      const focusCell = fKey ? $getNodeByKey(fKey) : null;
      if (
        !$isTableCellNode(anchorCell) ||
        !$isTableCellNode(focusCell) ||
        !anchorCell.isAttached() ||
        !focusCell.isAttached()
      ) {
        return fallback;
      }
      const table = $getTableNodeFromLexicalNodeOrThrow(anchorCell);
      const [, aPos, fPos] = $computeTableMap(table, anchorCell, focusCell);
      const minRow = Math.min(aPos.startRow, fPos.startRow);
      const maxRow = Math.max(
        aPos.startRow + anchorCell.getRowSpan() - 1,
        fPos.startRow + focusCell.getRowSpan() - 1
      );
      const minColumn = Math.min(aPos.startColumn, fPos.startColumn);
      const maxColumn = Math.max(
        aPos.startColumn + anchorCell.getColSpan() - 1,
        fPos.startColumn + focusCell.getColSpan() - 1
      );
      return {
        rows: maxRow - minRow + 1,
        columns: maxColumn - minColumn + 1,
      };
    });
  });

  // Rect covering the cells the dragged range would land on, anchored at
  // the hovered cell: clipped at the right edge (matching the drop
  // behavior) and extended past the bottom for rows that would be created.
  const previewRect = createCallback(
    (cellElem: HTMLElement, shape: DragShape): DropTarget['rect'] => {
      const cellRect = cellElem.getBoundingClientRect();
      const currentEditor = editor();
      if (!currentEditor) return cellRect;
      return currentEditor.read(() => {
        const targetCell = $getNearestNodeFromDOMNode(cellElem);
        if (!$isTableCellNode(targetCell) || !targetCell.isAttached()) {
          return cellRect;
        }
        const table = $getTableNodeFromLexicalNodeOrThrow(targetCell);
        const [map, targetPos] = $computeTableMap(
          table,
          targetCell,
          targetCell
        );
        const lastRow = map.length - 1;
        const lastColumn = (map[0]?.length ?? 1) - 1;

        const endColumn = Math.min(
          targetPos.startColumn + shape.columns - 1,
          lastColumn
        );
        const wantedEndRow = targetPos.startRow + shape.rows - 1;
        const endRow = Math.min(wantedEndRow, lastRow);

        const endCell = map[endRow]?.[endColumn]?.cell;
        const endElem = endCell
          ? currentEditor.getElementByKey(endCell.getKey())
          : null;
        const endRect = endElem?.getBoundingClientRect() ?? cellRect;

        const left = Math.min(cellRect.left, endRect.left);
        const top = Math.min(cellRect.top, endRect.top);
        const right = Math.max(cellRect.right, endRect.right);
        // Rows the move would append extend the preview past the table.
        const bottom =
          Math.max(cellRect.bottom, endRect.bottom) +
          (wantedEndRow - endRow) * cellRect.height;

        return { left, top, width: right - left, height: bottom - top };
      });
    }
  );

  const performMove = createCallback((targetElem: HTMLElement) => {
    const currentEditor = editor();
    if (!currentEditor) return;

    currentEditor.update(() => {
      const targetCell = $getNearestNodeFromDOMNode(targetElem);
      if (!$isTableCellNode(targetCell) || !targetCell.isAttached()) return;

      const aKey = anchorCellKey();
      const fKey = focusCellKey();
      const anchorCell = aKey ? $getNodeByKey(aKey) : null;
      const focusCell = fKey ? $getNodeByKey(fKey) : null;
      if (
        !$isTableCellNode(anchorCell) ||
        !$isTableCellNode(focusCell) ||
        !anchorCell.isAttached() ||
        !focusCell.isAttached()
      ) {
        return;
      }

      $moveCellRange(currentEditor, anchorCell, focusCell, targetCell);
    });
  });

  const resetDrag = () => {
    setDragging(false);
    setDropTarget(undefined);
  };

  const runMenuAction = createCallback(
    (action: (cell: TableCellNode) => void) => {
      setMenuOpen(false);
      editor()?.update(() => {
        // Prefer the live selection; re-anchor in the tracked cell if the tap
        // blurred the editor. The insert/delete helpers act on the selection.
        const selection = $getSelection();
        let cell =
          $isRangeSelection(selection) || $isTableSelection(selection)
            ? $getTableCellNodeFromLexicalNode(selection.anchor.getNode())
            : null;
        if (!cell) {
          const key = anchorCellKey();
          const tracked = key ? $getNodeByKey(key) : null;
          if ($isTableCellNode(tracked) && tracked.isAttached()) {
            tracked.selectStart();
            cell = tracked;
          }
        }
        if (cell) action(cell);
      });
    }
  );

  const menuItemButton = (item: MenuItem, danger: boolean) => (
    <button
      type="button"
      class="flex items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs ring-1 ring-edge active:bg-accent/10"
      classList={{ 'text-failure': danger, 'col-span-2': item.wide }}
      onClick={() => runMenuAction(item.action)}
    >
      <item.icon class="size-4 shrink-0" />
      {item.label}
    </button>
  );

  const onHandlePointerDown = (downEvent: PointerEvent) => {
    downEvent.preventDefault();
    const handleElem = downEvent.currentTarget;
    if (!(handleElem instanceof HTMLElement)) return;
    handleElem.setPointerCapture(downEvent.pointerId);

    const startX = downEvent.clientX;
    const startY = downEvent.clientY;
    const shape = dragShape();
    let started = false;

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (!started) {
        const distance = Math.hypot(
          moveEvent.clientX - startX,
          moveEvent.clientY - startY
        );
        if (distance < DRAG_THRESHOLD_PX) return;
        started = true;
        setDragging(true);
        setMenuOpen(false);
      }
      const under = document.elementFromPoint(
        moveEvent.clientX,
        moveEvent.clientY
      );
      const domCell = under ? getDOMCellFromTarget(under) : null;
      setDropTarget(
        domCell
          ? {
              cellElem: domCell.elem,
              rect: previewRect(domCell.elem, shape),
            }
          : undefined
      );
    };

    const onPointerUp = () => {
      const target = dropTarget();
      if (started && target) performMove(target.cellElem);
      // A tap (no drag) opens the action menu on touch devices, where the
      // hover-driven insert/delete buttons are unusable.
      else if (!started && isTouchDevice()) setMenuOpen(true);
      cleanup();
    };

    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === 'Escape') cleanup();
    };

    const cleanup = () => {
      handleElem.releasePointerCapture(downEvent.pointerId);
      handleElem.removeEventListener('pointermove', onPointerMove);
      handleElem.removeEventListener('pointerup', onPointerUp);
      handleElem.removeEventListener('pointercancel', cleanup);
      document.removeEventListener('keydown', onKeyDown);
      resetDrag();
    };

    handleElem.addEventListener('pointermove', onPointerMove);
    handleElem.addEventListener('pointerup', onPointerUp);
    handleElem.addEventListener('pointercancel', cleanup);
    document.addEventListener('keydown', onKeyDown);
  };

  return (
    <Show when={handlePosition()}>
      {(pos) => (
        <ScopedPortal scope="split">
          <Show when={dragging() && dropTarget()}>
            {(t) => (
              <div
                class="fixed z-10 pointer-events-none bg-accent/15 ring-1 ring-accent/60"
                style={{
                  left: `${t().rect.left}px`,
                  top: `${t().rect.top}px`,
                  width: `${t().rect.width}px`,
                  height: `${t().rect.height}px`,
                }}
              />
            )}
          </Show>
          <button
            type="button"
            aria-label="Move cells"
            class="fixed z-20 flex size-6 -translate-x-[calc(100%-3px)] -translate-y-[3px] items-center justify-center rounded-full border border-edge bg-surface text-ink-muted shadow-sm touch-none"
            classList={{
              'cursor-grab': !dragging(),
              'cursor-grabbing': dragging(),
            }}
            style={{ left: `${pos().x}px`, top: `${pos().y}px` }}
            onPointerDown={onHandlePointerDown}
          >
            <DotsIcon class="size-3.5" />
          </button>
          <Show when={menuOpen()}>
            <div
              class="fixed z-30 grid -translate-x-full grid-cols-2 gap-1 overflow-y-auto rounded-lg bg-surface p-1.5 shadow-lg ring-1 ring-edge"
              style={{
                width: `${MENU_WIDTH_PX}px`,
                'max-height': `${MENU_MAX_HEIGHT_PX}px`,
                left: `${Math.max(pos().x, MENU_WIDTH_PX + 8)}px`,
                top: `${Math.min(
                  pos().y + 28,
                  window.innerHeight - MENU_MAX_HEIGHT_PX - 8
                )}px`,
              }}
              use:clickOutside={() => setMenuOpen(false)}
              onPointerDown={(e) => e.preventDefault()}
            >
              <For each={INSERT_ITEMS}>
                {(item) => menuItemButton(item, false)}
              </For>
              <div class="col-span-2 my-0.5 h-px shrink-0 bg-edge" />
              <For each={DELETE_ITEMS}>
                {(item) => menuItemButton(item, true)}
              </For>
            </div>
          </Show>
        </ScopedPortal>
      )}
    </Show>
  );
}
