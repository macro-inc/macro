/**
 * @file Column and row resize handles for tables. On pointer devices an
 * invisible strip along the hovered cell's right edge resizes that column,
 * and one along the bottom edge resizes that row. Touch has no row handle
 * (vertical movement stays a scroll) and no column handle either: a
 * horizontal swipe that starts near a column border resizes it. The first
 * touchmove decides the gesture — mostly-vertical movement is left to the
 * browser as a scroll, and a still finger disarms before the long-press
 * cell selection fires. The new size applies live while dragging, with the
 * pointer captured so the drag survives leaving the editor; Escape /
 * pointercancel restores the pre-drag width or height.
 */
import { mdStore } from '@block-md/signal/markdownBlockData';
import { ScopedPortal } from '@core/component/ScopedPortal';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { $isTableCellNode, getDOMCellFromTarget } from '@lexical/table';
import { calculateZoomLevel } from '@lexical/utils';
import { $getNearestNodeFromDOMNode } from 'lexical';
import { createMemo, createSignal, onCleanup, Show } from 'solid-js';
import { registerEditorWidthObserver } from '../../plugins/shared/utils';
import {
  $applyResizeDrag,
  $applyRowResizeDrag,
  $captureResizeDrag,
  $captureRowResizeDrag,
  $revertResizeDrag,
  $revertRowResizeDrag,
  type ResizeEdge as ColumnResizeEdge,
  type ResizeDragSnapshot,
  type RowResizeDragSnapshot,
} from '../../plugins/tables/tableCellResize';
import { createLayoutTick } from './createLayoutTick';

// Width of the pointer-device hit strip along a cell edge.
const HIT_ZONE_PX = 9;
// Touch counts as starting on a border within this distance of it.
const TOUCH_EDGE_PX = 12;
// A still finger is a long-press (cell selection), not a resize; disarm
// before tableTouchSelection's 400ms long-press fires.
const TOUCH_ARM_TIMEOUT_MS = 350;

type ResizeEdge = ColumnResizeEdge | 'bottom';

function isColumnEdge(edge: ResizeEdge): edge is ColumnResizeEdge {
  return edge === 'left' || edge === 'right';
}

// Set while dragging; names the border of the active cell being dragged.
// Module scope: at most one drag runs across all editors, and the other
// floating table controls (insert/delete buttons) hide themselves on it —
// their hover tracking freezes while the resize captures the pointer.
const [dragEdge, setDragEdge] = createSignal<ResizeEdge>();
export const tableColumnResizeEdge = dragEdge;

export function TableCellResizer() {
  const mdData = mdStore.get;
  const editor = () => mdData.editor;

  // Cell whose border carries the handle: the hovered cell on pointer
  // devices, the touched cell during a touch drag. `activeCellKey` is set
  // for the duration of a drag so we can re-resolve the element after
  // Lexical recreates a row's DOM when height changes.
  const [activeCellElem, setActiveCellElem] = createSignal<HTMLElement>();
  const [activeCellKey, setActiveCellKey] = createSignal<string>();
  const { layoutTick, bumpLayout } = createLayoutTick();
  // Kept across a row-height drag so the handle stays mounted while Lexical
  // recreates the <tr> (updateDOM returns true when height changes).
  let lastCellRect: DOMRect | undefined;

  const startResize = (
    cellElem: HTMLElement,
    edge: ResizeEdge,
    down: {
      pointerId: number;
      clientX: number;
      clientY: number;
      pointerType: string;
    },
    captureTarget: HTMLElement
  ) => {
    const currentEditor = editor();
    if (!currentEditor) return;
    const zoom = calculateZoomLevel(cellElem);
    const isRow = edge === 'bottom';
    const drag = currentEditor.read(() =>
      isRow
        ? $captureRowResizeDrag(currentEditor, cellElem, zoom)
        : $captureResizeDrag(currentEditor, cellElem, edge, zoom)
    );
    if (!drag) return;

    const isTouch = down.pointerType === 'touch';
    try {
      captureTarget.setPointerCapture(down.pointerId);
    } catch {
      // The pointer ended between the down event and here.
      return;
    }
    setActiveCellElem(cellElem);
    setActiveCellKey(
      currentEditor.read(() => {
        const node = $getNearestNodeFromDOMNode(cellElem);
        return $isTableCellNode(node) ? node.getKey() : undefined;
      })
    );
    setDragEdge(edge);

    const previousCursor = document.body.style.cursor;
    if (!isTouch) {
      document.body.style.cursor = isRow ? 'row-resize' : 'col-resize';
    }

    let frame = 0;
    let delta = 0;
    // The first live update pushes one history entry; the rest merge into
    // it so the whole drag undoes in a single step.
    let pushedHistory = false;

    const applyDelta = () => {
      frame = 0;
      const tag = pushedHistory
        ? ['skip-scroll-into-view', 'history-merge']
        : ['skip-scroll-into-view'];
      pushedHistory = true;
      currentEditor.update(
        () => {
          if (isRow) $applyRowResizeDrag(drag as RowResizeDragSnapshot, delta);
          else $applyResizeDrag(drag as ResizeDragSnapshot, delta);
        },
        { tag }
      );
    };

    const onPointerMove = (move: PointerEvent) => {
      if (move.pointerId !== down.pointerId) return;
      move.preventDefault();
      delta = isRow
        ? (move.clientY - down.clientY) / zoom
        : (move.clientX - down.clientX) / zoom;
      if (!frame) frame = requestAnimationFrame(applyDelta);
    };

    // pointermove can't stop the page from panning; only preventDefault
    // from a non-passive touchmove listener can.
    const blockScroll = (event: TouchEvent) => event.preventDefault();

    const onPointerUp = (up: PointerEvent) => {
      if (up.pointerId !== down.pointerId) return;
      if (frame) {
        cancelAnimationFrame(frame);
        applyDelta();
      }
      cleanup();
    };
    const cancelDrag = () => {
      if (pushedHistory) {
        currentEditor.update(
          () => {
            if (isRow) $revertRowResizeDrag(drag as RowResizeDragSnapshot);
            else $revertResizeDrag(drag as ResizeDragSnapshot);
          },
          {
            tag: ['skip-scroll-into-view', 'history-merge'],
          }
        );
      }
      cleanup();
    };
    const onPointerCancel = (event: PointerEvent) => {
      if (event.pointerId !== down.pointerId) return;
      cancelDrag();
    };
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === 'Escape') cancelDrag();
    };

    const cleanup = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      if (captureTarget.hasPointerCapture(down.pointerId)) {
        captureTarget.releasePointerCapture(down.pointerId);
      }
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onPointerCancel);
      document.removeEventListener('touchmove', blockScroll);
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.cursor = previousCursor;
      setDragEdge(undefined);
      setActiveCellKey(undefined);
      if (isTouch) setActiveCellElem(undefined);
    };

    // Document-level listeners see the captured events by bubbling, so one
    // set serves both the desktop strip and the touch gesture.
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerCancel);
    if (isTouch) {
      document.addEventListener('touchmove', blockScroll, { passive: false });
    }
    document.addEventListener('keydown', onKeyDown);
  };

  // Hover activation (mouse/pen). Touch never hovers; its activation is the
  // swipe gesture below.
  let lastHoverTarget: EventTarget | null = null;
  const onRootPointerMove = (event: PointerEvent) => {
    if (event.pointerType === 'touch' || dragEdge()) return;
    if (event.target === lastHoverTarget) return;
    lastHoverTarget = event.target;
    const cell =
      event.target instanceof Node ? getDOMCellFromTarget(event.target) : null;
    setActiveCellElem(cell?.elem);
  };

  const onRootPointerDown = (down: PointerEvent) => {
    if (down.pointerType !== 'touch' || !down.isPrimary) return;
    if (!editor()?.isEditable() || dragEdge()) return;
    const cell =
      down.target instanceof Node ? getDOMCellFromTarget(down.target) : null;
    if (!cell) return;
    const rect = cell.elem.getBoundingClientRect();
    const edge: ColumnResizeEdge | undefined =
      Math.abs(down.clientX - rect.right) <= TOUCH_EDGE_PX
        ? 'right'
        : Math.abs(down.clientX - rect.left) <= TOUCH_EDGE_PX
          ? 'left'
          : undefined;
    if (!edge) return;

    const { pointerId, clientX: startX, clientY: startY, pointerType } = down;
    let timer = 0;
    const cancelArmed = () => {
      window.clearTimeout(timer);
      document.removeEventListener('touchmove', onArmedTouchMove);
      document.removeEventListener('pointerup', cancelArmed);
      document.removeEventListener('pointercancel', cancelArmed);
    };
    // Deciding on the first touchmove (while it is still cancelable) is what
    // lets a horizontal swipe beat the browser's pan gesture.
    const onArmedTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      cancelArmed();
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      // Mostly-vertical first movement is a scroll; leave it to the browser.
      if (Math.abs(dx) <= Math.abs(dy)) return;
      event.preventDefault();
      startResize(
        cell.elem,
        edge,
        { pointerId, clientX: startX, clientY: startY, pointerType },
        cell.elem
      );
    };
    timer = window.setTimeout(cancelArmed, TOUCH_ARM_TIMEOUT_MS);
    document.addEventListener('touchmove', onArmedTouchMove, {
      passive: false,
    });
    document.addEventListener('pointerup', cancelArmed);
    document.addEventListener('pointercancel', cancelArmed);
  };

  let cleanupRoot: (() => void) | null = null;
  const removeRootListener = editor()?.registerRootListener((root) => {
    cleanupRoot?.();
    cleanupRoot = null;
    if (!root) return;
    root.addEventListener('pointermove', onRootPointerMove);
    root.addEventListener('pointerdown', onRootPointerDown);
    cleanupRoot = () => {
      root.removeEventListener('pointermove', onRootPointerMove);
      root.removeEventListener('pointerdown', onRootPointerDown);
    };
  });

  const removeUpdateListener = editor()?.registerUpdateListener(bumpLayout);

  let cleanupWidthObserver = () => {};
  const widthObserverEditor = editor();
  if (widthObserverEditor) {
    cleanupWidthObserver = registerEditorWidthObserver(
      widthObserverEditor,
      bumpLayout
    );
  }

  onCleanup(() => {
    removeRootListener?.();
    removeUpdateListener?.();
    cleanupRoot?.();
    cleanupWidthObserver();
  });

  const cellRect = createMemo(() => {
    layoutTick();
    const currentEditor = editor();
    const key = activeCellKey();
    const elem =
      (key && currentEditor?.getElementByKey(key)) || activeCellElem();
    if (elem?.isConnected) {
      lastCellRect = elem.getBoundingClientRect();
      return lastCellRect;
    }
    if (dragEdge()) return lastCellRect;
    lastCellRect = undefined;
    return undefined;
  });

  const onColumnStripPointerDown = (down: PointerEvent) => {
    if (down.pointerType === 'mouse' && down.button !== 0) return;
    const cellElem = activeCellElem();
    const strip = down.currentTarget;
    if (!cellElem || !(strip instanceof HTMLElement)) return;
    down.preventDefault();
    down.stopPropagation();
    startResize(cellElem, 'right', down, strip);
  };

  const onRowStripPointerDown = (down: PointerEvent) => {
    if (down.pointerType === 'mouse' && down.button !== 0) return;
    const cellElem = activeCellElem();
    const strip = down.currentTarget;
    if (!cellElem || !(strip instanceof HTMLElement)) return;
    down.preventDefault();
    down.stopPropagation();
    startResize(cellElem, 'bottom', down, strip);
  };

  // The strip doubles as the drag indicator on touch, pinned to whichever
  // border is being dragged.
  const stripX = (rect: DOMRect) =>
    dragEdge() === 'left' ? rect.left : rect.right;

  const showColumnStrip = () => {
    const edge = dragEdge();
    if (isTouchDevice()) return edge === 'left' || edge === 'right';
    return !edge || isColumnEdge(edge);
  };

  const showRowStrip = () => {
    if (isTouchDevice()) return false;
    const edge = dragEdge();
    return !edge || edge === 'bottom';
  };

  const rowStripWidth = (rect: DOMRect) =>
    dragEdge() === 'bottom'
      ? rect.width
      : Math.max(0, rect.width - HIT_ZONE_PX);

  return (
    <Show when={cellRect()}>
      {(rect) => (
        <ScopedPortal scope="split">
          <Show when={showColumnStrip()}>
            <div
              class="group fixed z-20 flex cursor-col-resize touch-none justify-center"
              style={{
                left: `${stripX(rect()) - HIT_ZONE_PX / 2}px`,
                top: `${rect().top}px`,
                width: `${HIT_ZONE_PX}px`,
                height: `${rect().height}px`,
              }}
              onPointerDown={onColumnStripPointerDown}
            >
              <div
                class="h-full w-[3px] bg-accent transition-opacity"
                classList={{
                  'opacity-100': !!dragEdge(),
                  'opacity-0 group-hover:opacity-70': !dragEdge(),
                }}
              />
            </div>
          </Show>
          <Show when={showRowStrip()}>
            <div
              class="group fixed z-20 flex cursor-row-resize touch-none items-center"
              style={{
                left: `${rect().left}px`,
                top: `${rect().bottom - HIT_ZONE_PX / 2}px`,
                width: `${rowStripWidth(rect())}px`,
                height: `${HIT_ZONE_PX}px`,
              }}
              onPointerDown={onRowStripPointerDown}
            >
              <div
                class="h-[3px] w-full bg-accent transition-opacity"
                classList={{
                  'opacity-100': dragEdge() === 'bottom',
                  'opacity-0 group-hover:opacity-70': dragEdge() !== 'bottom',
                }}
              />
            </div>
          </Show>
        </ScopedPortal>
      )}
    </Show>
  );
}
