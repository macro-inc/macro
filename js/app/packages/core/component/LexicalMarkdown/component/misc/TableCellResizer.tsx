import { mdStore } from '@block-md/signal/markdownBlockData';
import { createBlockSignal } from '@core/block';
import { ScopedPortal } from '@core/component/ScopedPortal';
import type { TableCellNode, TableDOMCell, TableMapType } from '@lexical/table';
import {
  $computeTableMapSkipCellCheck,
  $getTableNodeFromLexicalNodeOrThrow,
  $getTableRowIndexFromTableCellNode,
  $isTableCellNode,
  $isTableRowNode,
  getDOMCellFromTarget,
  getTableElement,
} from '@lexical/table';
import { calculateZoomLevel } from '@lexical/utils';
import { createCallback } from '@solid-primitives/rootless';
import { $getNearestNodeFromDOMNode, isHTMLElement } from 'lexical';
import { createMemo, createSignal, type JSX, onCleanup, Show } from 'solid-js';
import { registerEditorWidthObserver } from '../../plugins/shared/utils';

// Constants
export const MIN_ROW_HEIGHT = 35;
export const MIN_COLUMN_WIDTH = 120;

// Types
type PointerPosition = {
  x: number;
  y: number;
};

type PointerDraggingDirection = 'right' | 'bottom';

export function TableCellResizer() {
  // State and references
  const mdData = mdStore.get;
  const editor = () => mdData.editor;

  let targetRef: HTMLElement | undefined;
  let resizerRef: HTMLDivElement | undefined;
  let tableRectRef: DOMRect | undefined;
  let pointerStartPosRef: PointerPosition | undefined;

  const [pointerCurrentPos, setPointerCurrentPos] = createBlockSignal<
    PointerPosition | undefined
  >(undefined);

  const [activeCell, setActiveCell] = createBlockSignal<
    TableDOMCell | undefined
  >(undefined);

  const [draggingDirection, setDraggingDirection] = createBlockSignal<
    PointerDraggingDirection | undefined
  >(undefined);

  // Helper functions
  const resetState = createCallback(() => {
    setActiveCell(undefined);
    setDraggingDirection(undefined);
    targetRef = undefined;
    pointerStartPosRef = undefined;
    tableRectRef = undefined;
  });

  const isHeightChanging = (direction: PointerDraggingDirection) => {
    return direction === 'bottom';
  };

  const getCellNodeHeight = (cell: TableCellNode): number | undefined => {
    const domCellNode = editor()?.getElementByKey(cell.getKey());
    return domCellNode?.clientHeight;
  };

  const getCellColumnIndex = (
    tableCellNode: TableCellNode,
    tableMap: TableMapType
  ) => {
    for (let row = 0; row < tableMap.length; row++) {
      for (let column = 0; column < tableMap[row].length; column++) {
        if (tableMap[row][column].cell === tableCellNode) {
          return column;
        }
      }
    }
  };

  // Update handlers
  const updateRowHeight = createCallback((heightChange: number) => {
    const _activeCell = activeCell();
    if (!_activeCell) {
      throw new Error('TableCellResizer: Expected active cell.');
    }

    editor()?.update(
      () => {
        const tableCellNode = $getNearestNodeFromDOMNode(_activeCell.elem);
        if (!$isTableCellNode(tableCellNode)) {
          throw new Error('TableCellResizer: Table cell node not found.');
        }

        const tableNode = $getTableNodeFromLexicalNodeOrThrow(tableCellNode);
        const baseRowIndex = $getTableRowIndexFromTableCellNode(tableCellNode);
        const tableRows = tableNode.getChildren();

        // Determine if this is a full row merge by checking colspan
        const isFullRowMerge =
          tableCellNode.getColSpan() === tableNode.getColumnCount();

        // For full row merges, apply to first row. For partial merges, apply to last row
        const tableRowIndex = isFullRowMerge
          ? baseRowIndex
          : baseRowIndex + tableCellNode.getRowSpan() - 1;

        if (tableRowIndex >= tableRows.length || tableRowIndex < 0) {
          throw new Error('Expected table cell to be inside of table row.');
        }

        const tableRow = tableRows[tableRowIndex];
        if (!$isTableRowNode(tableRow)) {
          throw new Error('Expected table row');
        }

        let height = tableRow.getHeight();
        if (height === undefined) {
          const rowCells = tableRow.getChildren<TableCellNode>();
          height = Math.min(
            ...rowCells.map((cell) => getCellNodeHeight(cell) ?? Infinity)
          );
        }

        const newHeight = Math.max(height + heightChange, MIN_ROW_HEIGHT);
        tableRow.setHeight(newHeight);
      },
      { tag: 'skip-scroll-into-view' }
    );
  });

  const updateColumnWidth = createCallback((widthChange: number) => {
    const _activeCell = activeCell();
    if (!_activeCell) {
      throw new Error('TableCellResizer: Expected active cell.');
    }

    editor()?.update(
      () => {
        const tableCellNode = $getNearestNodeFromDOMNode(_activeCell.elem);
        if (!$isTableCellNode(tableCellNode)) {
          throw new Error('TableCellResizer: Table cell node not found.');
        }

        const tableNode = $getTableNodeFromLexicalNodeOrThrow(tableCellNode);
        const [tableMap] = $computeTableMapSkipCellCheck(tableNode, null, null);
        const columnIndex = getCellColumnIndex(tableCellNode, tableMap);

        if (columnIndex === undefined) {
          throw new Error('TableCellResizer: Table column not found.');
        }

        const colWidths = tableNode.getColWidths();
        if (!colWidths) {
          return;
        }

        const width = colWidths[columnIndex];
        if (width === undefined) {
          return;
        }

        const newColWidths = [...colWidths];
        const newWidth = Math.max(width + widthChange, MIN_COLUMN_WIDTH);
        newColWidths[columnIndex] = newWidth;
        tableNode.setColWidths(newColWidths);
      },
      { tag: 'skip-scroll-into-view' }
    );
  });

  // Event handlers
  const pointerUpHandler = createCallback(
    (direction: PointerDraggingDirection) => {
      const handler = (event: PointerEvent) => {
        event.preventDefault();
        event.stopPropagation();

        const _activeCell = activeCell();
        if (!_activeCell) {
          throw new Error('TableCellResizer: Expected active cell.');
        }

        if (pointerStartPosRef) {
          const { x, y } = pointerStartPosRef;
          if (!_activeCell) {
            return;
          }

          const zoom = calculateZoomLevel(event.target as Element);
          if (isHeightChanging(direction)) {
            const heightChange = (event.clientY - y) / zoom;
            updateRowHeight(heightChange);
          } else {
            const widthChange = (event.clientX - x) / zoom;
            updateColumnWidth(widthChange);
          }

          resetState();
          document.removeEventListener('pointerup', handler);
        }
      };
      return handler;
    }
  );

  const toggleResize = createCallback(
    (direction: PointerDraggingDirection): ((event: PointerEvent) => void) =>
      (event) => {
        event.preventDefault();
        event.stopPropagation();

        const _activeCell = activeCell();
        if (!_activeCell) {
          throw new Error('TableCellResizer: Expected active cell.');
        }

        pointerStartPosRef = {
          x: event.clientX,
          y: event.clientY,
        };

        setPointerCurrentPos(pointerStartPosRef);
        setDraggingDirection(direction);
        document.addEventListener('pointerup', pointerUpHandler(direction));
      }
  );

  const onPointerMove = (event: PointerEvent) => {
    const target = event.target;
    if (!isHTMLElement(target)) {
      return;
    }

    if (draggingDirection()) {
      event.preventDefault();
      event.stopPropagation();
      setPointerCurrentPos({
        x: event.clientX,
        y: event.clientY,
      });
      return;
    }

    if (resizerRef && resizerRef.contains(target)) {
      return;
    }

    if (targetRef !== target) {
      targetRef = target;
      const cell = getDOMCellFromTarget(target);

      if (cell && activeCell() !== cell) {
        editor()?.read(() => {
          const tableCellNode = $getNearestNodeFromDOMNode(cell.elem);
          if (!tableCellNode) {
            throw new Error('TableCellResizer: Table cell node not found.');
          }

          const tableNode = $getTableNodeFromLexicalNodeOrThrow(tableCellNode);
          const tableElement = getTableElement(
            tableNode,
            editor()?.getElementByKey(tableNode.getKey()) ?? null
          );

          if (!tableElement) {
            throw new Error('TableCellResizer: Table element not found.');
          }

          targetRef = target as HTMLElement;
          tableRectRef = tableElement.getBoundingClientRect();
          setActiveCell(cell);
        });
      } else if (!cell) {
        resetState();
      }
    }
  };

  const onPointerDown = (event: PointerEvent) => {
    const isTouchEvent = event.pointerType === 'touch';
    if (isTouchEvent) {
      onPointerMove(event);
    }
  };

  // Event listeners setup
  const resizerContainer = resizerRef;
  resizerContainer?.addEventListener('pointermove', onPointerMove, {
    capture: true,
  });

  const removeRootListener = editor()?.registerRootListener(
    (rootElement, prevRootElement) => {
      prevRootElement?.removeEventListener('pointermove', onPointerMove);
      prevRootElement?.removeEventListener('pointerdown', onPointerDown);
      rootElement?.addEventListener('pointermove', onPointerMove);
      rootElement?.addEventListener('pointerdown', onPointerDown);
    }
  );

  const [editorWidth, setEditorWidth] = createSignal(Infinity);
  let cleanUpWidthObserver = () => {};
  if (editor()) {
    cleanUpWidthObserver = registerEditorWidthObserver(editor()!, (width) => {
      setEditorWidth(width);
    });
  }

  onCleanup(() => {
    removeRootListener?.();
    cleanUpWidthObserver();
    resizerContainer?.removeEventListener('pointermove', onPointerMove);
  });

  // UI related
  const getResizers = createMemo(() => {
    const _activeCell = activeCell();
    editorWidth(); // Make this memo reactive on editor width change.
    const rootEl = editor()?.getRootElement();
    // let rootRect = rootEl ? containedClientRect(rootEl!) : null;
    // let containerRect = rootEl ? getContainerRect(rootEl) : null;
    let rootRect = rootEl ? rootEl.getBoundingClientRect() : null;
    if (_activeCell) {
      // const cellRect = containedClientRect(_activeCell.elem);
      const cellRect = _activeCell.elem.getBoundingClientRect();
      const zoneWidth = 5; // Pixel width of the zone where you can drag the edge

      const styles: Record<string, JSX.CSSProperties> = {
        bottom: {
          'background-color': 'transparent',
          cursor: 'var(--cursor-row-resize)',
          height: `${zoneWidth}px`,
          left: `${cellRect.left}px`,
          top: `${cellRect.top + cellRect.height - zoneWidth / 2}px`,
          width: `${cellRect.width}px`,
          position: 'fixed', // Use fixed positioning based on viewport coordinates
        },
        right: {
          'background-color': 'transparent',
          cursor: 'var(--cursor-col-resize)',
          height: `${cellRect.height}px`,
          left: `${cellRect.left + cellRect.width - zoneWidth / 2}px`,
          top: `${cellRect.top}px`,
          width: `${zoneWidth}px`,
          position: 'fixed', // Use fixed positioning based on viewport coordinates
        },
      };

      const tableRect = tableRectRef;
      const _draggingDirection = draggingDirection();
      const _pointerCurrentPos = pointerCurrentPos();

      if (_draggingDirection && _pointerCurrentPos && tableRect) {
        const compensatedMousePos = {
          x: _pointerCurrentPos.x,
          y: _pointerCurrentPos.y,
        };
        if (isHeightChanging(_draggingDirection)) {
          styles[_draggingDirection].left = `${tableRect.left}px`;
          styles[_draggingDirection].top = `${compensatedMousePos.y}px`;
          styles[_draggingDirection].height = '3px';
          styles[_draggingDirection].width = `${tableRect.width}px`;

          // Do not let the resizer go outside of the root element;
          if (rootRect) {
            styles[_draggingDirection].left =
              `${Math.max(rootRect.left, tableRect.left)}px`;
            styles[_draggingDirection].width =
              `${Math.min(rootRect.width, tableRect.width)}px`;
          }
        } else {
          styles[_draggingDirection].top = `${tableRect.top}px`;
          styles[_draggingDirection].left = `${compensatedMousePos.x}px`;
          styles[_draggingDirection].width = '3px';
          styles[_draggingDirection].height = `${tableRect.height}px`;
        }

        styles[_draggingDirection]['background-color'] =
          'var(--color-accent-bg)';
      }

      return styles;
    }

    return {
      bottom: undefined,
      left: undefined,
      right: undefined,
      top: undefined,
    };
  });

  return (
    <Show when={activeCell()}>
      <ScopedPortal scope="split">
        <div ref={resizerRef}>
          <Show when={getResizers().right}>
            <div
              class="touch-none pointer-course"
              style={{
                ...(getResizers().right || {}),
              }}
              onPointerDown={toggleResize('right')}
            />
          </Show>
          <Show when={getResizers().bottom}>
            <div
              class="touch-none pointer-course"
              style={getResizers().bottom || undefined}
              onPointerDown={toggleResize('bottom')}
            />
          </Show>
        </div>
      </ScopedPortal>
    </Show>
  );
}
