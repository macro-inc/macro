import { mdStore } from '@block-md/signal/markdownBlockData';
import { ScopedPortal } from '@core/component/ScopedPortal';
import {
  $computeTableMap,
  $isTableCellNode,
  $isTableRowNode,
  getDOMCellFromTarget,
} from '@lexical/table';
import TrashIcon from '@phosphor/trash-simple.svg';
import { createCallback } from '@solid-primitives/rootless';
import { Layer } from '@ui';
import {
  $getNearestNodeFromDOMNode,
  isHTMLElement,
  type LexicalEditor,
} from 'lexical';
import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import {
  $deleteTableAtHover,
  $selectionDeleteExtent,
} from '../../plugins/tables/tableDelete';
import { tableColumnResizeEdge } from './TableCellResizer';

type DeleteTarget = {
  cellElem: HTMLElement;
  cellLeft: number;
  cellRight: number;
  cellTop: number;
  cellBottom: number;
  tableTop: number;
  tableBottom: number;
  // Clamped to the visible span of the scroll wrapper.
  tableLeft: number;
  tableRight: number;
  // Pointer proximity to the border each button sits on.
  nearTop: boolean;
  nearLeft: boolean;
  // Expanded to the table selection when it covers the hovered row/column.
  deleteRowTop: number;
  deleteRowBottom: number;
  deleteColLeft: number;
  deleteColRight: number;
  selectedRowCount: number;
  selectedColumnCount: number;
};

// How far (px) inside the table's top/left border the pointer still counts
// as hovering that border.
const EDGE_PROXIMITY_PX = 20;

const BUTTON_CLASS =
  'fixed z-20 flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-edge bg-surface text-ink-muted shadow-sm hover:border-failure hover:bg-failure hover:text-surface';

function readSelectionDeletePixels(
  editor: LexicalEditor,
  cellElem: HTMLElement,
  cellRect: DOMRect
): Pick<
  DeleteTarget,
  | 'deleteRowTop'
  | 'deleteRowBottom'
  | 'deleteColLeft'
  | 'deleteColRight'
  | 'selectedRowCount'
  | 'selectedColumnCount'
> {
  const fallback = {
    deleteRowTop: cellRect.top,
    deleteRowBottom: cellRect.bottom,
    deleteColLeft: cellRect.left,
    deleteColRight: cellRect.right,
    selectedRowCount: 1,
    selectedColumnCount: 1,
  };
  return editor.read(() => {
    const cellNode = $getNearestNodeFromDOMNode(cellElem);
    if (!$isTableCellNode(cellNode) || !cellNode.isAttached()) return fallback;
    const extent = $selectionDeleteExtent(cellNode);
    if (!extent) return fallback;

    const next = { ...fallback };
    if (extent.expandRows) {
      const minRowNode = extent.table.getChildAtIndex(extent.minRow);
      const maxRowNode = extent.table.getChildAtIndex(extent.maxRow);
      const minEl =
        minRowNode && $isTableRowNode(minRowNode)
          ? editor.getElementByKey(minRowNode.getKey())
          : null;
      const maxEl =
        maxRowNode && $isTableRowNode(maxRowNode)
          ? editor.getElementByKey(maxRowNode.getKey())
          : null;
      if (minEl && maxEl) {
        const minR = minEl.getBoundingClientRect();
        const maxR = maxEl.getBoundingClientRect();
        next.deleteRowTop = Math.min(minR.top, maxR.top);
        next.deleteRowBottom = Math.max(minR.bottom, maxR.bottom);
        next.selectedRowCount = extent.maxRow - extent.minRow + 1;
      }
    }
    if (extent.expandColumns) {
      const [map, pos] = $computeTableMap(extent.table, cellNode, cellNode);
      const minCell = map[pos.startRow]?.[extent.minColumn]?.cell;
      const maxCell = map[pos.startRow]?.[extent.maxColumn]?.cell;
      const minEl = minCell ? editor.getElementByKey(minCell.getKey()) : null;
      const maxEl = maxCell ? editor.getElementByKey(maxCell.getKey()) : null;
      if (minEl && maxEl) {
        const minR = minEl.getBoundingClientRect();
        const maxR = maxEl.getBoundingClientRect();
        next.deleteColLeft = Math.min(minR.left, maxR.left);
        next.deleteColRight = Math.max(minR.right, maxR.right);
        next.selectedColumnCount = extent.maxColumn - extent.minColumn + 1;
      }
    }
    return next;
  });
}

export function TableDeleteButtons() {
  const mdData = mdStore.get;
  const editor = () => mdData.editor;

  const [target, setTarget] = createSignal<DeleteTarget>();
  const [hovered, setHovered] = createSignal<'row' | 'column' | 'table'>();

  const clear = () => {
    if (!hovered()) setTarget(undefined);
  };

  // A column resize captures the pointer, so no pointermove would ever
  // clear stale buttons; hide them for the duration of the drag.
  createEffect(() => {
    if (tableColumnResizeEdge()) {
      setHovered(undefined);
      setTarget(undefined);
    }
  });

  const onPointerMove = createCallback((event: PointerEvent) => {
    if (tableColumnResizeEdge()) return;
    const eventTarget = event.target;
    if (!editor() || !isHTMLElement(eventTarget)) return;

    const domCell = getDOMCellFromTarget(eventTarget);
    if (!domCell) return clear();

    const tableElem = domCell.elem.closest('table');
    if (!tableElem) return clear();

    const rect = domCell.elem.getBoundingClientRect();
    const tableRect = tableElem.getBoundingClientRect();
    const wrapperRect = tableElem
      .closest('.md-table-scrollable-wrapper')
      ?.getBoundingClientRect();

    const tableLeft = Math.max(tableRect.left, wrapperRect?.left ?? -Infinity);
    const nearTop = event.clientY - tableRect.top <= EDGE_PROXIMITY_PX;
    const nearLeft = event.clientX - tableLeft <= EDGE_PROXIMITY_PX;
    if (!nearTop && !nearLeft) return clear();

    const currentEditor = editor();
    const selectionPixels = currentEditor
      ? readSelectionDeletePixels(currentEditor, domCell.elem, rect)
      : {
          deleteRowTop: rect.top,
          deleteRowBottom: rect.bottom,
          deleteColLeft: rect.left,
          deleteColRight: rect.right,
          selectedRowCount: 1,
          selectedColumnCount: 1,
        };

    setTarget({
      cellElem: domCell.elem,
      cellLeft: rect.left,
      cellRight: rect.right,
      cellTop: rect.top,
      cellBottom: rect.bottom,
      tableTop: tableRect.top,
      tableBottom: tableRect.bottom,
      tableLeft,
      tableRight: Math.min(tableRect.right, wrapperRect?.right ?? Infinity),
      nearTop,
      nearLeft,
      ...selectionPixels,
    });
  });

  const deleteAt = createCallback((type: 'row' | 'column' | 'table') => {
    const currentTarget = target();
    const currentEditor = editor();
    if (!currentTarget || !currentEditor) return;

    currentEditor.update(() => {
      const cellNode = $getNearestNodeFromDOMNode(currentTarget.cellElem);
      if (!$isTableCellNode(cellNode) || !cellNode.isAttached()) return;
      $deleteTableAtHover(cellNode, type);
    });

    setHovered(undefined);
    setTarget(undefined);
  });

  const removeRootListener = editor()?.registerRootListener(
    (rootElement, prevRootElement) => {
      prevRootElement?.removeEventListener('pointermove', onPointerMove);
      rootElement?.addEventListener('pointermove', onPointerMove);
    }
  );

  // Positions go stale on any scroll; just hide.
  const onScroll = () => {
    setTarget(undefined);
    setHovered(undefined);
  };
  document.addEventListener('scroll', onScroll, {
    capture: true,
    passive: true,
  });

  onCleanup(() => {
    removeRootListener?.();
    document.removeEventListener('scroll', onScroll, { capture: true });
  });

  const onButtonLeave = () => {
    setHovered(undefined);
    setTarget(undefined);
  };

  return (
    <Show when={target()}>
      {(t) => (
        <ScopedPortal scope="split">
          {/* Same elevated surface as the other floating bars. */}
          <Layer depth={2}>
            {/* Highlight of the row/column about to be deleted. */}
            <Show when={hovered()}>
              {(h) => (
                <div
                  class="fixed z-10 pointer-events-none bg-failure/15"
                  style={{
                    left:
                      h() === 'column'
                        ? `${t().deleteColLeft}px`
                        : `${t().tableLeft}px`,
                    width:
                      h() === 'column'
                        ? `${t().deleteColRight - t().deleteColLeft}px`
                        : `${t().tableRight - t().tableLeft}px`,
                    top:
                      h() === 'row'
                        ? `${t().deleteRowTop}px`
                        : `${t().tableTop}px`,
                    height:
                      h() === 'row'
                        ? `${t().deleteRowBottom - t().deleteRowTop}px`
                        : `${t().tableBottom - t().tableTop}px`,
                  }}
                />
              )}
            </Show>
            <Show when={t().nearTop}>
              <button
                type="button"
                aria-label={
                  t().selectedColumnCount > 1
                    ? 'Delete selected columns'
                    : 'Delete column'
                }
                class={BUTTON_CLASS}
                style={{
                  left: `${(t().cellLeft + t().cellRight) / 2}px`,
                  top: `${Math.max(t().tableTop, 12)}px`,
                }}
                onPointerDown={(e) => e.preventDefault()}
                onPointerEnter={() => setHovered('column')}
                onPointerLeave={onButtonLeave}
                onClick={() => deleteAt('column')}
              >
                <TrashIcon class="size-3" />
              </button>
            </Show>
            <Show when={t().nearLeft}>
              <button
                type="button"
                aria-label={
                  t().selectedRowCount > 1
                    ? 'Delete selected rows'
                    : 'Delete row'
                }
                class={BUTTON_CLASS}
                style={{
                  left: `${t().tableLeft}px`,
                  top: `${(t().cellTop + t().cellBottom) / 2}px`,
                }}
                onPointerDown={(e) => e.preventDefault()}
                onPointerEnter={() => setHovered('row')}
                onPointerLeave={onButtonLeave}
                onClick={() => deleteAt('row')}
              >
                <TrashIcon class="size-3" />
              </button>
            </Show>
            <Show when={t().nearTop && t().nearLeft}>
              <button
                type="button"
                aria-label="Delete table"
                class={BUTTON_CLASS}
                style={{
                  left: `${t().tableLeft}px`,
                  top: `${t().tableTop}px`,
                }}
                onPointerDown={(e) => e.preventDefault()}
                onPointerEnter={() => setHovered('table')}
                onPointerLeave={onButtonLeave}
                onClick={() => deleteAt('table')}
              >
                <TrashIcon class="size-3" />
              </button>
            </Show>
          </Layer>
        </ScopedPortal>
      )}
    </Show>
  );
}
