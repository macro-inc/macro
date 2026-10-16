import type { CellBounds } from '@macro-inc/spreadsheet/sheet-rules';
import {
  createEffect,
  createSignal,
  For,
  type JSX,
  on,
  onCleanup,
  Show,
} from 'solid-js';
import { type CellPosition, cellAddress } from '../core/grid-selection';
import { createDragAutoScroll } from './drag-auto-scroll';

/**
 * The selection's border, which drags the selected cells to another place.
 * While dragging, an outline shows where they will land, and the grid scrolls
 * as the pointer nears or passes its edges.
 */
export function SelectionMoveHandle(props: {
  bounds: CellBounds;
  rowCount: number;
  columnCount: number;
  rangeStyle: (area: CellBounds) => JSX.CSSProperties;
  positionAtPoint: (x: number, y: number) => CellPosition;
  /** The scrolling grid, whose sticky headers cover its top and left edges. */
  scroller: HTMLElement;
  headerWidth: number;
  headerHeight: number;
  /** A drag ends without moving when the sheet changes. */
  sheetId?: string;
  onClick: (position: CellPosition, extend: boolean) => void;
  onDblClick: () => void;
  onMove: (rows: number, columns: number) => void;
}) {
  const [offset, setOffset] = createSignal<{ rows: number; columns: number }>();
  let drag:
    | {
        element: HTMLElement;
        pointerId: number;
        /** The grabbed cell, from the selection's top-left cell. */
        grab: CellPosition;
      }
    | undefined;

  const destination = () => {
    const moved = offset();
    return (
      moved && {
        top: props.bounds.top + moved.rows,
        left: props.bounds.left + moved.columns,
        bottom: props.bounds.bottom + moved.rows,
        right: props.bounds.right + moved.columns,
      }
    );
  };

  function follow(x: number, y: number) {
    if (!drag) return;
    // Past an edge, the cells land at the last visible row or column.
    const rect = props.scroller.getBoundingClientRect();
    const position = props.positionAtPoint(
      Math.max(
        rect.left + props.headerWidth,
        Math.min(rect.left + props.scroller.clientWidth - 1, x)
      ),
      Math.max(
        rect.top + props.headerHeight,
        Math.min(rect.top + props.scroller.clientHeight - 1, y)
      )
    );
    const { top, left, bottom, right } = props.bounds;
    const row = Math.max(
      0,
      Math.min(
        props.rowCount - 1 - (bottom - top),
        position.row - drag.grab.row
      )
    );
    const column = Math.max(
      0,
      Math.min(
        props.columnCount - 1 - (right - left),
        position.column - drag.grab.column
      )
    );
    const moved = { rows: row - top, columns: column - left };
    // The outline appears once the cells would land somewhere else.
    if (offset() || moved.rows || moved.columns) setOffset(moved);
  }

  // Scrolls only once the pointer has moved, so pressing the border near an
  // edge does not scroll before a drag starts.
  const autoScroll = createDragAutoScroll({
    element: () => props.scroller,
    inset: () => ({ left: props.headerWidth, top: props.headerHeight }),
    axis: () => undefined,
    onEdge: follow,
    onLostRelease: end,
  });

  function cancelOnEscape(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    end();
  }

  function end() {
    const current = drag;
    drag = undefined;
    setOffset(undefined);
    autoScroll.stop();
    window.removeEventListener('keydown', cancelOnEscape, true);
    if (current?.element.hasPointerCapture(current.pointerId))
      current.element.releasePointerCapture(current.pointerId);
  }

  createEffect(on(() => props.sheetId, end, { defer: true }));
  onCleanup(end);

  return (
    <>
      <div
        aria-hidden="true"
        class="pointer-events-none absolute z-[2]"
        style={props.rangeStyle(props.bounds)}
      >
        <For each={['top', 'right', 'bottom', 'left'] as const}>
          {(edge) => (
            <div
              data-selection-move={edge}
              class="pointer-events-auto absolute cursor-move touch-none"
              style={{
                top: edge === 'bottom' ? 'calc(100% - 3px)' : '-3px',
                left: edge === 'right' ? 'calc(100% - 3px)' : '-3px',
                width:
                  edge === 'top' || edge === 'bottom'
                    ? 'calc(100% + 6px)'
                    : '6px',
                height:
                  edge === 'left' || edge === 'right'
                    ? 'calc(100% + 6px)'
                    : '6px',
              }}
              onPointerDown={(event) => {
                if (event.button !== 0 || event.pointerType === 'touch') return;
                event.preventDefault();
                event.stopPropagation();
                const position = props.positionAtPoint(
                  event.clientX,
                  event.clientY
                );
                const { top, left, bottom, right } = props.bounds;
                drag = {
                  element: event.currentTarget,
                  pointerId: event.pointerId,
                  grab: {
                    row: Math.max(top, Math.min(bottom, position.row)) - top,
                    column:
                      Math.max(left, Math.min(right, position.column)) - left,
                  },
                };
                event.currentTarget.setPointerCapture(event.pointerId);
                window.addEventListener('keydown', cancelOnEscape, true);
                autoScroll.follow(event);
              }}
              onPointerMove={(event) => {
                if (drag?.pointerId !== event.pointerId) return;
                follow(event.clientX, event.clientY);
                autoScroll.move(event);
              }}
              onPointerUp={(event) => {
                if (drag?.pointerId !== event.pointerId) return;
                const moved = offset();
                end();
                if (moved && (moved.rows || moved.columns))
                  props.onMove(moved.rows, moved.columns);
                else if (!moved)
                  props.onClick(
                    props.positionAtPoint(event.clientX, event.clientY),
                    event.shiftKey
                  );
              }}
              onPointerCancel={end}
              onLostPointerCapture={end}
              onDblClick={() => props.onDblClick()}
            />
          )}
        </For>
      </div>
      <Show when={destination()}>
        {(area) => (
          <div
            aria-hidden="true"
            data-move-destination
            class="pointer-events-none absolute z-[3] border-2 border-dashed border-accent"
            style={props.rangeStyle(area())}
          >
            <span class="absolute left-[-2px] top-full mt-0.5 whitespace-nowrap rounded-sm bg-accent px-1 text-[11px] font-medium leading-4 text-surface shadow-sm">
              {cellAddress({ row: area().top, column: area().left })}
              {area().bottom > area().top || area().right > area().left
                ? `:${cellAddress({ row: area().bottom, column: area().right })}`
                : ''}
            </span>
          </div>
        )}
      </Show>
    </>
  );
}
