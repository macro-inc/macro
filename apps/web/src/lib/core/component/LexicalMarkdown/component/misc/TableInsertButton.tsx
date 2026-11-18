import { ScopedPortal } from '@core/component/ScopedPortal';
import PlusIcon from '@icon/system/regular/plus.svg';
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
import { createLexicalTableInsertHost } from '../../editing/overlay-hosts/lexical-table-insert';
import type {
  TableInsertHit,
  TableInsertHost,
} from '../../editing/overlay-hosts/table-insert';
import { tableColumnResizeEdge } from './TableCellResizer';

// How close (px) the pointer must be to a row/column border for the button to show.
const BORDER_PROXIMITY = 6;

type InsertTarget<Key> = {
  type: 'row' | 'column';
  // Cell whose trailing edge is the hovered border; insertion happens after it.
  cellKey: Key;
  // Button center, viewport coordinates.
  x: number;
  y: number;
  // Extent of the border line (x-range for rows, y-range for columns).
  lineFrom: number;
  lineTo: number;
};

export function TableInsertButton() {
  const lexicalWrapper = useContext(LexicalWrapperContext);
  const editor = () => lexicalWrapper?.editor;

  return (
    <HostedTableInsertButton host={createLexicalTableInsertHost(editor)} />
  );
}

export function HostedTableInsertButton<
  Key,
  Hit extends TableInsertHit,
>(props: { host: TableInsertHost<Key, Hit> }) {
  const [insertTarget, setInsertTarget] = createSignal<InsertTarget<Key>>();
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
    const domCell = props.host.cellFromTarget(event.target);
    if (domCell === null) return;
    if (domCell === undefined) return clear();
    const rect = domCell.element.getBoundingClientRect();
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

    const reference = props.host.referenceForBorder(
      domCell,
      edge.type,
      edge.side
    );
    if (!reference) return clear();
    const tableElem = reference.table;
    const tableRect = tableElem.getBoundingClientRect();
    const wrapperRect = tableElem
      .closest('.md-table-scrollable-wrapper')
      ?.getBoundingClientRect();

    if (edge.type === 'row') {
      const left = Math.max(tableRect.left, wrapperRect?.left ?? -Infinity);
      const right = Math.min(tableRect.right, wrapperRect?.right ?? Infinity);
      setInsertTarget({
        type: 'row',
        cellKey: reference.key,
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
        cellKey: reference.key,
        x: edge.pos,
        y: (rect.top + rect.bottom) / 2,
        lineFrom: top,
        lineTo: bottom,
      });
    }
  });

  const onInsert = createCallback(() => {
    const target = insertTarget();
    if (!target) return;
    if (props.host.insertAfter(target.cellKey, target.type) === 'keep-target')
      return;

    setButtonHovered(false);
    setInsertTarget(undefined);
  });

  const removeRootListener = props.host.registerRoot(onPointerMove);

  // Positions go stale on any scroll; just hide.
  const onScroll = () => {
    setInsertTarget(undefined);
    setButtonHovered(false);
  };
  const removeScrollListener = props.host.registerScroll(onScroll);

  onCleanup(() => {
    removeRootListener?.();
    removeScrollListener();
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
