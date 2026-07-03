import { mdStore } from '@block-md/signal/markdownBlockData';
import { ScopedPortal } from '@core/component/ScopedPortal';
import {
  $deleteTableColumnAtSelection,
  $deleteTableRowAtSelection,
  $getTableCellNodeFromLexicalNode,
  $getTableNodeFromLexicalNodeOrThrow,
  $insertTableColumnAtSelection,
  $insertTableRowAtSelection,
  $isTableCellNode,
  $isTableSelection,
  type TableCellNode,
} from '@lexical/table';
import PlusIcon from '@phosphor/plus.svg';
import TrashIcon from '@phosphor/trash-simple.svg';
import { createCallback } from '@solid-primitives/rootless';
import {
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  SELECTION_CHANGE_COMMAND,
} from 'lexical';
import { createMemo, createSignal, onCleanup, Show } from 'solid-js';

const BUTTON_CLASS =
  'fixed z-20 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-edge bg-surface shadow-sm';

/**
 * Touch-friendly replacement for the hover-driven table insert/delete buttons:
 * controls anchor to the cell the selection is in. Pluses sit on all four
 * edges of the focused cell (insert row/column before or after); trashes for
 * the row/column sit just outside the table past the strip's far end, and the
 * whole-table trash sits on the top-left corner.
 */
export function TableMobileControls() {
  const mdData = mdStore.get;
  const editor = () => mdData.editor;

  const [cellKey, setCellKey] = createSignal<string>();
  // Bumped on scroll/resize/updates to recompute viewport-fixed positions.
  const [layoutTick, setLayoutTick] = createSignal(0);
  const bumpLayout = () => setLayoutTick((t) => t + 1);

  const trackSelection = createCallback(() => {
    const currentEditor = editor();
    if (!currentEditor) return;
    currentEditor.read(() => {
      const selection = $getSelection();
      const cell =
        $isRangeSelection(selection) || $isTableSelection(selection)
          ? $getTableCellNodeFromLexicalNode(selection.anchor.getNode())
          : null;
      setCellKey(cell?.getKey());
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

  document.addEventListener('scroll', bumpLayout, {
    capture: true,
    passive: true,
  });
  window.addEventListener('resize', bumpLayout);

  onCleanup(() => {
    removeSelectionListener?.();
    removeUpdateListener?.();
    document.removeEventListener('scroll', bumpLayout, { capture: true });
    window.removeEventListener('resize', bumpLayout);
  });

  const positions = createMemo(() => {
    layoutTick();
    const key = cellKey();
    const currentEditor = editor();
    if (!key || !currentEditor) return;

    const cellElem = currentEditor.getElementByKey(key);
    const tableElem = cellElem?.closest('table');
    if (!cellElem || !tableElem) return;

    const cell = cellElem.getBoundingClientRect();
    const table = tableElem.getBoundingClientRect();
    const wrapperRect = tableElem
      .closest('.md-table-scrollable-wrapper')
      ?.getBoundingClientRect();
    const visibleLeft = Math.max(table.left, wrapperRect?.left ?? -Infinity);
    const visibleRight = Math.min(table.right, wrapperRect?.right ?? Infinity);

    const cellCenterX = (cell.left + cell.right) / 2;
    const cellCenterY = (cell.top + cell.bottom) / 2;

    return {
      insertColumnLeft: { x: cell.left, y: cellCenterY },
      insertColumnRight: { x: cell.right, y: cellCenterY },
      insertRowAbove: { x: cellCenterX, y: cell.top },
      insertRowBelow: { x: cellCenterX, y: cell.bottom },
      // Trashes sit past the table edges so they can't collide with the
      // pluses when the focused cell is in the last row/column.
      deleteRow: {
        x: Math.min(visibleRight + 26, window.innerWidth - 12),
        y: cellCenterY,
      },
      deleteColumn: {
        x: cellCenterX,
        y: Math.min(table.bottom + 26, window.innerHeight - 12),
      },
      deleteTable: { x: visibleLeft, y: Math.max(table.top, 12) },
    };
  });

  // Re-anchor the selection in the tracked cell if it drifted (e.g. the
  // button tap blurred the editor) so the selection-based helpers act on it.
  const $anchoredCell = (): TableCellNode | null => {
    const selection = $getSelection();
    if ($isRangeSelection(selection) || $isTableSelection(selection)) {
      const cell = $getTableCellNodeFromLexicalNode(selection.anchor.getNode());
      if (cell) return cell;
    }
    const key = cellKey();
    const cell = key ? $getNodeByKey(key) : null;
    if ($isTableCellNode(cell) && cell.isAttached()) {
      cell.selectStart();
      return cell;
    }
    return null;
  };

  const runAction = createCallback(
    (action: (cell: TableCellNode) => void, clears: boolean) => {
      editor()?.update(() => {
        const cell = $anchoredCell();
        if (cell) action(cell);
      });
      if (clears) setCellKey(undefined);
    }
  );

  return (
    <Show when={positions()}>
      {(pos) => (
        <ScopedPortal scope="split">
          <button
            type="button"
            aria-label="Insert column left"
            class={`${BUTTON_CLASS} text-ink-muted active:border-accent active:bg-accent active:text-surface`}
            style={{
              left: `${pos().insertColumnLeft.x}px`,
              top: `${pos().insertColumnLeft.y}px`,
            }}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() =>
              runAction(() => $insertTableColumnAtSelection(false), false)
            }
          >
            <PlusIcon class="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Insert column right"
            class={`${BUTTON_CLASS} text-ink-muted active:border-accent active:bg-accent active:text-surface`}
            style={{
              left: `${pos().insertColumnRight.x}px`,
              top: `${pos().insertColumnRight.y}px`,
            }}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() =>
              runAction(() => $insertTableColumnAtSelection(true), false)
            }
          >
            <PlusIcon class="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Insert row above"
            class={`${BUTTON_CLASS} text-ink-muted active:border-accent active:bg-accent active:text-surface`}
            style={{
              left: `${pos().insertRowAbove.x}px`,
              top: `${pos().insertRowAbove.y}px`,
            }}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() =>
              runAction(() => $insertTableRowAtSelection(false), false)
            }
          >
            <PlusIcon class="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Insert row below"
            class={`${BUTTON_CLASS} text-ink-muted active:border-accent active:bg-accent active:text-surface`}
            style={{
              left: `${pos().insertRowBelow.x}px`,
              top: `${pos().insertRowBelow.y}px`,
            }}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() =>
              runAction(() => $insertTableRowAtSelection(true), false)
            }
          >
            <PlusIcon class="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Delete row"
            class={`${BUTTON_CLASS} text-failure active:border-failure active:bg-failure active:text-surface`}
            style={{
              left: `${pos().deleteRow.x}px`,
              top: `${pos().deleteRow.y}px`,
            }}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => runAction($deleteTableRowAtSelection, true)}
          >
            <TrashIcon class="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Delete column"
            class={`${BUTTON_CLASS} text-failure active:border-failure active:bg-failure active:text-surface`}
            style={{
              left: `${pos().deleteColumn.x}px`,
              top: `${pos().deleteColumn.y}px`,
            }}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => runAction($deleteTableColumnAtSelection, true)}
          >
            <TrashIcon class="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Delete table"
            class={`${BUTTON_CLASS} text-failure active:border-failure active:bg-failure active:text-surface`}
            style={{
              left: `${pos().deleteTable.x}px`,
              top: `${pos().deleteTable.y}px`,
            }}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() =>
              runAction(
                (cell) => $getTableNodeFromLexicalNodeOrThrow(cell).remove(),
                true
              )
            }
          >
            <TrashIcon class="size-3.5" />
          </button>
        </ScopedPortal>
      )}
    </Show>
  );
}
