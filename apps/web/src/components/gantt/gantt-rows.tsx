import { Key } from '@solid-primitives/keyed';
import {
  createVirtualizer,
  defaultRangeExtractor,
  type Range,
} from '@tanstack/solid-virtual';
import { cn } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  type JSX,
  on,
  Show,
  splitProps,
} from 'solid-js';
import { HEADER_HEIGHT, useGantt } from './gantt-context';
import {
  GanttGroupDrop,
  type GanttGroupMove,
  useGanttGroupDrag,
} from './gantt-group-drag';
import { GanttSidebarPanelRow } from './gantt-sidebar';

type RowsProps<T> = {
  items: readonly T[];
  getKey: (item: T) => string | number;
  /** Consecutive sidebar rows with the same key form one visual panel. */
  getPanelKey?: (item: T) => string | number | undefined;
  virtualize?: boolean;
  children: (item: T) => JSX.Element;
};

function VirtualRows<T>(props: RowsProps<T>) {
  const gantt = useGantt();
  const drag = useGanttGroupDrag();
  const [focusedKey, setFocusedKey] = createSignal<string | number>();
  const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    get count() {
      return props.items.length;
    },
    get getItemKey() {
      const keys = props.items.map(props.getKey);
      return (index: number) => keys[index];
    },
    getScrollElement: () => gantt.viewport() ?? null,
    estimateSize: () => gantt.rowHeight(),
    scrollMargin: HEADER_HEIGHT,
    overscan: 8,
    get rangeExtractor() {
      const key = drag?.active()?.key ?? focusedKey();
      const pinned =
        key === undefined
          ? -1
          : props.items.findIndex((item) => props.getKey(item) === key);
      return (range: Range) => {
        const indexes = defaultRangeExtractor(range);
        return pinned < 0 || indexes.includes(pinned)
          ? indexes
          : [...indexes, pinned].sort((a, b) => a - b);
      };
    },
  });
  createEffect(
    on(gantt.rowHeight, () => virtualizer.measure(), { defer: true })
  );
  return (
    <div
      class="relative"
      style={{
        height: `${virtualizer.getTotalSize()}px`,
        width: `${gantt.width()}px`,
      }}
      onFocusIn={(event) => {
        const row = event.target.closest<HTMLElement>('[data-gantt-row-index]');
        const index = Number(row?.dataset.ganttRowIndex);
        const item = props.items[index];
        if (item !== undefined) setFocusedKey(props.getKey(item));
      }}
      onFocusOut={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        )
          setFocusedKey(undefined);
      }}
    >
      <Key each={virtualizer.getVirtualItems()} by="key">
        {(virtualRow) => (
          <div
            data-gantt-row-index={virtualRow().index}
            class="absolute left-0"
            style={{ top: `${virtualRow().start - HEADER_HEIGHT}px` }}
          >
            <GanttSidebarPanelRow
              items={props.items}
              index={virtualRow().index}
              getPanelKey={props.getPanelKey}
            >
              <For
                each={props.items.slice(
                  virtualRow().index,
                  virtualRow().index + 1
                )}
              >
                {(item) => props.children(item)}
              </For>
            </GanttSidebarPanelRow>
          </div>
        )}
      </Key>
    </div>
  );
}

/** Only this slot chooses virtualization; consumers keep ownership of their data and rows. */
function Rows<T>(props: RowsProps<T>) {
  return (
    <Show
      when={props.virtualize}
      fallback={
        <div class="relative">
          {/* Keep occurrence keys, but refresh the renderer when an immutable item is replaced. */}
          <Key each={props.items} by={props.getKey}>
            {(item, index) => (
              <GanttSidebarPanelRow
                items={props.items}
                index={index()}
                getPanelKey={props.getPanelKey}
              >
                <For each={[item()]}>
                  {(current) => props.children(current)}
                </For>
              </GanttSidebarPanelRow>
            )}
          </Key>
        </div>
      }
    >
      <VirtualRows {...props} />
    </Show>
  );
}

export function GanttRow(
  props: Omit<JSX.HTMLAttributes<HTMLDivElement>, 'style'>
) {
  const gantt = useGantt();
  const [local, rest] = splitProps(props, ['children', 'class']);
  return (
    <div
      {...rest}
      class={cn(
        'relative border-b border-edge-muted/60 text-sm text-ink',
        local.class
      )}
      style={{ width: `${gantt.width()}px`, height: `${gantt.rowHeight()}px` }}
    >
      {local.children}
    </div>
  );
}

type RowEntry<T> = {
  key: string | number;
  panelKey: string | number | undefined;
} & ({ kind: 'item'; item: T } | { kind: 'preview'; move: GanttGroupMove });

/** Insertion previews share the row model, so virtualized rows and scroll height stay aligned. */
export function GanttRows<T>(
  props: RowsProps<T> & {
    renderDropPreview?: (move: GanttGroupMove) => JSX.Element;
  }
) {
  const drag = useGanttGroupDrag();
  const previewKey = `gantt-preview:${createUniqueId()}`;
  const normal = createMemo<RowEntry<T>[]>((previous) => {
    const activeKey = drag?.active()?.key;
    const existing = new Map(previous?.map((row) => [row.key, row]));
    const rows = props.items.map((item): RowEntry<T> => {
      const key = props.getKey(item);
      const row = existing.get(key);
      const panelKey = props.getPanelKey ? props.getPanelKey(item) : '';
      if (
        row?.kind === 'item' &&
        (key === activeKey || (row.item === item && row.panelKey === panelKey))
      )
        return row;
      return { kind: 'item', item, key, panelKey };
    });
    // Keep the drag source registered through immutable updates and page replacement.
    const source =
      activeKey === undefined ? undefined : existing.get(activeKey);
    if (source && !rows.some((row) => row.key === activeKey)) {
      rows.splice(Math.min(previous!.indexOf(source), rows.length), 0, source);
    }
    return rows;
  });
  const entries = createMemo(() => {
    const rows = normal().slice();
    const move = drag?.move();
    const placement = drag?.placement();
    if (!move || !placement || !props.renderDropPreview) return rows;
    rows.splice(
      Math.max(0, Math.min(rows.length, placement.index)),
      placement.replace ? 1 : 0,
      {
        kind: 'preview',
        key: previewKey,
        panelKey: move.toGroup,
        move,
      }
    );
    return rows;
  });
  return (
    <Rows
      items={entries()}
      getKey={(row) => row.key}
      getPanelKey={(row) => row.panelKey}
      virtualize={props.virtualize}
    >
      {(row) =>
        row.kind === 'item' ? (
          props.children(row.item)
        ) : (
          <GanttRow data-gantt-drop-preview="" aria-hidden="true" inert>
            <GanttGroupDrop id={previewKey} groupId={row.move.toGroup} />
            {props.renderDropPreview?.(row.move)}
          </GanttRow>
        )
      }
    </Rows>
  );
}
