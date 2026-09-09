/**
 * Generic kanban over any set of items bucketed by a single-valued key: one
 * column per `columns` entry plus the items whose key matches none of them,
 * which land in the column whose key is `emptyKey` (`''` by default).
 *
 * The board owns layout (whole-column snapping, horizontal overflow), native
 * HTML5 drag between columns, and the optimistic overlay that keeps a
 * dropped card in its new column until the item's own data catches up.
 * Everything domain-specific is injected: how an item resolves to a column,
 * whether a column's cards may be dragged, how a move is persisted, and
 * how a card renders. The Customers board (`CompanyKanban`) is the first
 * consumer, over companies keyed on the active deal-stage definition; the
 * same component serves any other pipeline whose items carry a select-like
 * value (list entries, contacts, tasks) without knowing what they are.
 */

import { CustomScrollbar } from '@core/component/CustomScrollbar';
import CircleDashed from '@phosphor/circle-dashed.svg';
import { createElementSize } from '@solid-primitives/resize-observer';
import { cn } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  Show,
} from 'solid-js';

/** Minimum column width the snapping layout will shrink to. */
const MIN_COLUMN_WIDTH = 224;
/** gap-3 between columns. */
const COLUMN_GAP = 12;
/** p-3 on each side of the column row. */
const BOARD_PADDING_X = 24;

export type PipelineColumn = {
  /** Value an item resolves to when it belongs in this column. */
  key: string;
  label: string;
};

/** Drag wiring the board hands to each card renderer. */
export type PipelineCardHandle = {
  draggable: boolean;
  dragging: boolean;
  onDragStart: (event: DragEvent) => void;
  onDragEnd: () => void;
};

export type PipelineBoardProps<T> = {
  /** Columns in display order. Items resolving to no column fall into `emptyKey`. */
  columns: PipelineColumn[];
  items: T[];
  itemKey: (item: T) => string;
  /**
   * The column an item belongs in according to its own data. Return
   * `emptyKey` (or any unknown key) for "not set".
   */
  itemColumn: (item: T) => string;
  /** Column key that collects unset items. Defaults to `''`. */
  emptyKey?: string;
  /** Whether cards currently in this column may be picked up. Default: all. */
  canDragFrom?: (columnKey: string) => boolean;
  /**
   * Persist a drop. The card stays in its new column until `itemColumn`
   * agrees; a rejected promise sends it back (unless a newer drag of the
   * same card has since landed elsewhere).
   */
  onMove: (item: T, columnKey: string) => Promise<unknown> | void;
  /** Column header icon. Defaults to a dashed circle for the empty column only. */
  columnIcon?: (column: PipelineColumn, index: number) => JSX.Element;
  card: (item: T, handle: PipelineCardHandle) => JSX.Element;
};

export function PipelineBoard<T>(props: PipelineBoardProps<T>) {
  const emptyKey = () => props.emptyKey ?? '';

  // Moves whose persistence hasn't reached the item's data yet. Search-fed
  // sources bypass optimistic caches entirely, so without this overlay a
  // drop wouldn't move the card at all.
  const [overrides, setOverrides] = createSignal<ReadonlyMap<string, string>>(
    new Map()
  );

  const setOverride = (id: string, columnKey: string) => {
    setOverrides((prev) => new Map(prev).set(id, columnKey));
  };

  // Drop an override, optionally only when it still points at `columnKey`
  // (so a failed save doesn't undo a newer drag of the same card).
  const clearOverride = (id: string, columnKey?: string) => {
    setOverrides((prev) => {
      if (columnKey !== undefined && prev.get(id) !== columnKey) return prev;
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  };

  const columnKeys = createMemo(
    () => new Set(props.columns.map((column) => column.key))
  );

  /** The column an item renders in: pending drag moves win over its data. */
  const effectiveColumn = (item: T) => {
    const key = overrides().get(props.itemKey(item)) ?? props.itemColumn(item);
    return columnKeys().has(key) ? key : emptyKey();
  };

  // Retire overrides the item's own data has caught up with, so later
  // remote changes aren't masked by a stale overlay.
  createEffect(() => {
    const pending = overrides();
    if (pending.size === 0) return;
    for (const item of props.items) {
      const id = props.itemKey(item);
      const override = pending.get(id);
      if (override !== undefined && props.itemColumn(item) === override) {
        clearOverride(id);
      }
    }
  });

  const buckets = createMemo(() => {
    const map = new Map<string, T[]>(
      props.columns.map((column) => [column.key, []])
    );
    for (const item of props.items) {
      map.get(effectiveColumn(item))?.push(item);
    }
    return props.columns.map((column) => ({
      ...column,
      items: map.get(column.key) ?? [],
    }));
  });

  const canDragFrom = (columnKey: string) =>
    props.canDragFrom?.(columnKey) ?? true;

  const [draggedId, setDraggedId] = createSignal<string>();
  const [dropTarget, setDropTarget] = createSignal<string>();
  const [scrollRef, setScrollRef] = createSignal<HTMLDivElement>();

  // Columns snap to a whole-column layout: as many columns as fit at the
  // minimum width, each widened to exactly fill the viewport. Growing the
  // board snaps in the next column once there's room; the rest scroll.
  const boardSize = createElementSize(scrollRef);
  const columnWidth = createMemo(() => {
    const width = boardSize.width;
    const count = props.columns.length;
    if (!width || count === 0) return undefined;
    const usable = width - BOARD_PADDING_X;
    const fit = Math.max(
      1,
      Math.min(
        count,
        Math.floor((usable + COLUMN_GAP) / (MIN_COLUMN_WIDTH + COLUMN_GAP))
      )
    );
    // Floored so rounding can't overflow the viewport by a pixel and
    // phantom-trigger the horizontal scrollbar.
    return Math.floor((usable - (fit - 1) * COLUMN_GAP) / fit);
  });

  const move = async (id: string, columnKey: string) => {
    const item = props.items.find((entry) => props.itemKey(entry) === id);
    if (!item) return;
    if (effectiveColumn(item) === columnKey) return;

    setOverride(id, columnKey);
    try {
      await props.onMove(item, columnKey);
    } catch {
      clearOverride(id, columnKey);
    }
  };

  const columnIcon = (column: PipelineColumn, index: number) => {
    if (props.columnIcon) return props.columnIcon(column, index);
    return (
      <Show when={column.key === emptyKey()}>
        <CircleDashed class="size-3.5 text-ink-extra-muted" />
      </Show>
    );
  };

  return (
    // Relative wrapper anchors the horizontal scrollbar to the board's
    // bottom edge when the split is too narrow for all columns.
    <div class="relative size-full min-w-0">
      <div
        ref={setScrollRef}
        class="size-full overflow-x-auto overflow-y-hidden scrollbar-hidden"
      >
        <div class="flex h-full gap-3 p-3">
          <For each={buckets()}>
            {(column, columnIndex) => (
              <div
                class={cn(
                  // Fallback sizing until the board is measured; after
                  // that the snapping columnWidth() takes over.
                  'flex h-full min-w-56 flex-1 flex-col rounded-lg border border-edge-muted bg-surface',
                  dropTarget() === column.key &&
                    draggedId() &&
                    'border-accent/50 bg-accent/5'
                )}
                style={
                  columnWidth() !== undefined
                    ? { width: `${columnWidth()}px`, flex: 'none' }
                    : undefined
                }
                onDragOver={(e) => {
                  if (!draggedId()) return;
                  e.preventDefault();
                  setDropTarget(column.key);
                }}
                onDragLeave={(e) => {
                  if (
                    e.relatedTarget instanceof Node &&
                    e.currentTarget.contains(e.relatedTarget)
                  ) {
                    return;
                  }
                  if (dropTarget() === column.key) setDropTarget(undefined);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const id =
                    draggedId() ?? e.dataTransfer?.getData('text/plain');
                  setDropTarget(undefined);
                  setDraggedId(undefined);
                  if (id) void move(id, column.key);
                }}
              >
                <div class="flex items-center gap-2 px-3 py-2.5 text-xs font-semibold text-ink-muted">
                  {columnIcon(column, columnIndex())}
                  <span class="truncate">{column.label}</span>
                </div>
                <div class="min-h-0 flex-1 overflow-y-auto scrollbar-hidden flex flex-col gap-2 px-2 pb-2">
                  <For each={column.items}>
                    {(item) => {
                      const id = props.itemKey(item);
                      return (
                        // Consumers may wrap cards in h-full triggers (sized
                        // for list rows); an auto-height wrapper resolves that
                        // to the card's content height instead of the column's.
                        <div class="shrink-0">
                          {props.card(item, {
                            get draggable() {
                              return canDragFrom(column.key);
                            },
                            get dragging() {
                              return draggedId() === id;
                            },
                            onDragStart: (e) => {
                              e.dataTransfer?.setData('text/plain', id);
                              if (e.dataTransfer) {
                                e.dataTransfer.effectAllowed = 'move';
                              }
                              setDraggedId(id);
                            },
                            onDragEnd: () => {
                              setDraggedId(undefined);
                              setDropTarget(undefined);
                            },
                          })}
                        </div>
                      );
                    }}
                  </For>
                </div>
              </div>
            )}
          </For>
        </div>
      </div>
      {/* watchContent: columns mount after the initial measurement, so
          overflow must be re-detected as they load in. */}
      <CustomScrollbar
        scrollContainer={scrollRef}
        horizontal
        revealZone={48}
        gutterSize={20}
        watchContent
      />
    </div>
  );
}
