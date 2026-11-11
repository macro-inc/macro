import { ScopedPortal } from '@core/component/ScopedPortal';
import TrashIcon from '@icon/system/regular/trash-simple.svg';
import { createCallback } from '@solid-primitives/rootless';
import { Layer } from '@ui';
import {
  createEffect,
  createSignal,
  onCleanup,
  Show,
  useContext,
} from 'solid-js';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';
import { createLexicalTableDeleteHost } from '../../editing/overlay-hosts/lexical-table-delete';
import type {
  TableDeleteAxis,
  TableDeleteHost,
  TableDeletePixels,
} from '../../editing/overlay-hosts/table-delete';
import type { TableInsertHit } from '../../editing/overlay-hosts/table-insert';
import { tableColumnResizeEdge } from './TableCellResizer';

type DeleteTarget<Hit> = TableDeletePixels & {
  cell: Hit;
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
};

// How far (px) inside the table's top/left border the pointer still counts
// as hovering that border.
const EDGE_PROXIMITY_PX = 20;

const BUTTON_CLASS =
  'fixed z-20 flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-edge bg-surface text-ink-muted shadow-sm hover:border-failure hover:bg-failure hover:text-surface';

export function TableDeleteButtons() {
  const lexicalWrapper = useContext(LexicalWrapperContext);
  const editor = () => lexicalWrapper?.editor;
  return (
    <HostedTableDeleteButtons host={createLexicalTableDeleteHost(editor)} />
  );
}

export function HostedTableDeleteButtons<Hit extends TableInsertHit>(props: {
  host: TableDeleteHost<Hit>;
}) {
  const [target, setTarget] = createSignal<DeleteTarget<Hit>>();
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
    const cell = props.host.cellFromTarget(event.target);
    if (cell === null) return;
    if (!cell) return clear();

    const tableElem = cell.element.closest('table');
    if (!tableElem) return clear();

    const rect = cell.element.getBoundingClientRect();
    const tableRect = tableElem.getBoundingClientRect();
    const wrapperRect = tableElem
      .closest('.md-table-scrollable-wrapper')
      ?.getBoundingClientRect();

    const tableLeft = Math.max(tableRect.left, wrapperRect?.left ?? -Infinity);
    const nearTop = event.clientY - tableRect.top <= EDGE_PROXIMITY_PX;
    const nearLeft = event.clientX - tableLeft <= EDGE_PROXIMITY_PX;
    if (!nearTop && !nearLeft) return clear();

    const selectionPixels = props.host.selectionPixels(cell, rect);

    setTarget({
      cell,
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

  const deleteAt = createCallback((type: TableDeleteAxis) => {
    const current = target();
    if (!current || props.host.deleteAt(current.cell, type) === 'keep-target')
      return;
    setHovered(undefined);
    setTarget(undefined);
  });

  const removeRootListener = props.host.registerRoot(onPointerMove);

  // Positions go stale on any scroll; just hide.
  const onScroll = () => {
    setTarget(undefined);
    setHovered(undefined);
  };
  const removeScrollListener = props.host.registerScroll(onScroll);

  onCleanup(() => {
    removeRootListener?.();
    removeScrollListener();
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
