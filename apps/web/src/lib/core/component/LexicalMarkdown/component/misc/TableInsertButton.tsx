import { mdStore } from '@block-md/signal/markdownBlockData';
import { ScopedPortal } from '@core/component/ScopedPortal';
import {
  $computeTableMapSkipCellCheck,
  $getTableNodeFromLexicalNodeOrThrow,
  $insertTableColumnAtSelection,
  $insertTableRowAtSelection,
  $isTableCellNode,
  getDOMCellFromTarget,
  getTableElement,
} from '@lexical/table';
import PlusIcon from '@phosphor/plus.svg';
import { createCallback } from '@solid-primitives/rootless';
import { Layer } from '@ui';
import {
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  isHTMLElement,
} from 'lexical';
import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import { tableColumnResizeEdge } from './TableCellResizer';

// How close (px) the pointer must be to a row/column border for the button to show.
const BORDER_PROXIMITY = 6;

type InsertTarget = {
  type: 'row' | 'column';
  // Cell whose trailing edge is the hovered border; insertion happens after it.
  cellKey: string;
  // Button center, viewport coordinates.
  x: number;
  y: number;
  // Extent of the border line (x-range for rows, y-range for columns).
  lineFrom: number;
  lineTo: number;
};

export function TableInsertButton() {
  const mdData = mdStore.get;
  const editor = () => mdData.editor;

  const [insertTarget, setInsertTarget] = createSignal<InsertTarget>();
  const [buttonHovered, setButtonHovered] = createSignal(false);

  const clear = () => {
    if (!buttonHovered()) setInsertTarget(undefined);
  };

  // A column resize captures the pointer, so no pointermove would ever
  // clear a stale button; hide it for the duration of the drag.
  createEffect(() => {
    if (tableColumnResizeEdge()) {
      setButtonHovered(false);
      setInsertTarget(undefined);
    }
  });

  const onPointerMove = createCallback((event: PointerEvent) => {
    if (tableColumnResizeEdge()) return;
    const currentEditor = editor();
    const target = event.target;
    if (!currentEditor || !isHTMLElement(target)) return;

    const domCell = getDOMCellFromTarget(target);
    if (!domCell) return clear();

    const rect = domCell.elem.getBoundingClientRect();
    const edge = (
      [
        {
          type: 'row',
          side: 'end',
          dist: Math.abs(event.clientY - rect.bottom),
          pos: rect.bottom,
        },
        {
          type: 'row',
          side: 'start',
          dist: Math.abs(event.clientY - rect.top),
          pos: rect.top,
        },
        {
          type: 'column',
          side: 'end',
          dist: Math.abs(event.clientX - rect.right),
          pos: rect.right,
        },
        {
          type: 'column',
          side: 'start',
          dist: Math.abs(event.clientX - rect.left),
          pos: rect.left,
        },
      ] as const
    )
      .filter((e) => e.dist <= BORDER_PROXIMITY)
      .sort((a, b) => a.dist - b.dist)[0];

    if (!edge) return clear();

    currentEditor.read(() => {
      const cellNode = $getNearestNodeFromDOMNode(domCell.elem);
      if (!$isTableCellNode(cellNode)) return clear();

      const tableNode = $getTableNodeFromLexicalNodeOrThrow(cellNode);

      // The border is the trailing edge of some cell; for leading edges resolve
      // the neighboring cell before it. The outer top/left edges have no
      // neighbor and get no button (we only insert after).
      let referenceCell = cellNode;
      if (edge.side === 'start') {
        const [gridMap, cellMap] = $computeTableMapSkipCellCheck(
          tableNode,
          cellNode,
          null
        );
        if (!cellMap) return clear();
        const { startRow, startColumn } = cellMap;
        const neighbor =
          edge.type === 'row'
            ? startRow > 0
              ? gridMap[startRow - 1][startColumn]
              : undefined
            : startColumn > 0
              ? gridMap[startRow][startColumn - 1]
              : undefined;
        if (!neighbor) return clear();
        referenceCell = neighbor.cell;
      }

      const tableElem = getTableElement(
        tableNode,
        currentEditor.getElementByKey(tableNode.getKey())
      );
      if (!tableElem) return clear();

      const tableRect = tableElem.getBoundingClientRect();
      const wrapperRect = tableElem
        .closest('.md-table-scrollable-wrapper')
        ?.getBoundingClientRect();

      if (edge.type === 'row') {
        const left = Math.max(tableRect.left, wrapperRect?.left ?? -Infinity);
        const right = Math.min(tableRect.right, wrapperRect?.right ?? Infinity);
        setInsertTarget({
          type: 'row',
          cellKey: referenceCell.getKey(),
          x: (rect.left + rect.right) / 2,
          y: edge.pos,
          lineFrom: left,
          lineTo: right,
        });
      } else {
        const top = Math.max(tableRect.top, 0);
        const bottom = Math.min(tableRect.bottom, window.innerHeight);
        setInsertTarget({
          type: 'column',
          cellKey: referenceCell.getKey(),
          x: edge.pos,
          y: (rect.top + rect.bottom) / 2,
          lineFrom: top,
          lineTo: bottom,
        });
      }
    });
  });

  const onInsert = createCallback(() => {
    const target = insertTarget();
    const currentEditor = editor();
    if (!target || !currentEditor) return;

    currentEditor.update(() => {
      const cell = $getNodeByKey(target.cellKey);
      if (!$isTableCellNode(cell) || !cell.isAttached()) return;

      // The insert helpers operate on the selection, so anchor it in the
      // cell whose trailing edge was hovered.
      cell.selectStart();
      if (target.type === 'row') {
        const newRow = $insertTableRowAtSelection(true);
        const firstCell = newRow?.getFirstChild();
        if ($isTableCellNode(firstCell)) firstCell.selectStart();
      } else {
        $insertTableColumnAtSelection(true);
      }
    });

    setButtonHovered(false);
    setInsertTarget(undefined);
  });

  const removeRootListener = editor()?.registerRootListener(
    (rootElement, prevRootElement) => {
      prevRootElement?.removeEventListener('pointermove', onPointerMove);
      rootElement?.addEventListener('pointermove', onPointerMove);
    }
  );

  // Positions go stale on any scroll; just hide.
  const onScroll = () => {
    setInsertTarget(undefined);
    setButtonHovered(false);
  };
  document.addEventListener('scroll', onScroll, {
    capture: true,
    passive: true,
  });

  onCleanup(() => {
    removeRootListener?.();
    document.removeEventListener('scroll', onScroll, { capture: true });
  });

  return (
    <Show when={insertTarget()}>
      {(target) => (
        <ScopedPortal scope="split">
          {/* Same elevated surface as the other floating bars. */}
          <Layer depth={2}>
            <Show when={buttonHovered()}>
              <div
                class="fixed z-10 pointer-events-none bg-accent"
                style={
                  target().type === 'row'
                    ? {
                        left: `${target().lineFrom}px`,
                        width: `${target().lineTo - target().lineFrom}px`,
                        top: `${target().y - 1}px`,
                        height: '2px',
                      }
                    : {
                        top: `${target().lineFrom}px`,
                        height: `${target().lineTo - target().lineFrom}px`,
                        left: `${target().x - 1}px`,
                        width: '2px',
                      }
                }
              />
            </Show>
            <button
              type="button"
              class="fixed z-20 flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-edge bg-surface text-ink-muted shadow-sm hover:border-accent hover:bg-accent hover:text-surface"
              style={{ left: `${target().x}px`, top: `${target().y}px` }}
              aria-label={
                target().type === 'row' ? 'Insert row' : 'Insert column'
              }
              onPointerDown={(e) => e.preventDefault()}
              onPointerEnter={() => setButtonHovered(true)}
              onPointerLeave={() => {
                setButtonHovered(false);
                setInsertTarget(undefined);
              }}
              onClick={onInsert}
            >
              <PlusIcon class="size-3" />
            </button>
          </Layer>
        </ScopedPortal>
      )}
    </Show>
  );
}
