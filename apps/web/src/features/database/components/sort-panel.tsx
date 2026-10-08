import GripIcon from '@phosphor/dots-six-vertical.svg';
import PlusIcon from '@phosphor/plus.svg';
import XIcon from '@phosphor/x.svg';
import type { DatabaseView } from '@service-storage/generated/schemas/databaseView';
import { Key } from '@solid-primitives/keyed';
import { DragDropProvider, DragOverlay } from '@thisbeyond/solid-dnd';
import { Button } from '@ui/components/Button';
import { createSignal, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { createReorderItem } from '../../../components/drag-drop/create-reorder';
import { createVerticalReorder } from '../../../components/drag-drop/create-vertical-reorder';
import { DragSessionSensors } from '../../../components/drag-drop/drag-session-sensors';
import { VerticalInsertionLine } from '../../../components/drag-drop/insertion-line';
import type { SortKey } from '../../../lib/core/database-sql/generated/types';
import type { DatabaseViewColumn } from '../core/database-view';
import { withSort, withSortMoved } from '../core/view-query';
import type { ViewChange } from '../core/view-state';
import { ViewSelect } from './view-select';

/** A view's sort levels, first first; drag a level's handle to change its priority. */
export function SortPanel(props: {
  columns: DatabaseViewColumn[];
  view: DatabaseView;
  onChange: (change: ViewChange) => void;
}) {
  const [list, setList] = createSignal<HTMLElement>();
  const sort = () => props.view.query.sort ?? [];
  const setSort = (next: SortKey[]) =>
    props.onChange({ query: { ...props.view.query, sort: next } });
  const changeKey = (column: string, change: Partial<SortKey>) =>
    setSort(
      sort().map((key) => (key.column === column ? { ...key, ...change } : key))
    );
  const reorder = createVerticalReorder({
    order: () => sort().map((key) => key.column),
    getViewport: list,
    enabled: () => sort().length > 1,
    previewMarker: 'data-sort-drag-preview',
    onDrop: (column, target, edge) => {
      const moved = withSortMoved(sort(), column, target, edge);
      if (moved) setSort(moved);
    },
  });
  /** Arrow keys on a handle move its level one place. */
  const moveBy = (column: string, step: -1 | 1) => {
    const columns = sort().map((key) => key.column);
    const target = columns[columns.indexOf(column) + step];
    const moved =
      target &&
      withSortMoved(sort(), column, target, step < 0 ? 'before' : 'after');
    if (moved) setSort(moved);
  };
  return (
    <div class="w-80 max-w-full">
      <DragDropProvider
        collisionDetector={reorder.collisionDetector}
        onDragStart={reorder.onDragStart}
        onDragEnd={reorder.onDragEnd}
      >
        <DragSessionSensors
          getViewport={list}
          axis="both"
          onCancel={reorder.cancel}
        />
        <div ref={setList} class="relative flex flex-col gap-2">
          <Key each={sort()} by="column">
            {(key) => {
              const item = createReorderItem(key().column, {
                canDrag: () => sort().length > 1,
                ignore: 'button:not([data-sort-handle])',
                start: reorder.start,
              });
              return (
                <div
                  ref={item.ref}
                  class="flex items-center gap-1.5"
                  classList={{ 'opacity-40': item.dragging() }}
                >
                  <button
                    type="button"
                    data-sort-handle
                    aria-label="Reorder sort"
                    aria-keyshortcuts="ArrowUp ArrowDown"
                    title="Drag to reorder"
                    disabled={sort().length < 2}
                    onMouseDown={item.onMouseDown}
                    onKeyDown={(event) => {
                      const step = match(event.key)
                        .returnType<-1 | 1 | undefined>()
                        .with('ArrowUp', () => -1)
                        .with('ArrowDown', () => 1)
                        .otherwise(() => undefined);
                      if (step === undefined) return;
                      event.preventDefault();
                      moveBy(key().column, step);
                    }}
                    class="flex h-8 w-4 shrink-0 items-center justify-center text-ink-placeholder hover:text-ink-muted disabled:opacity-40"
                  >
                    <GripIcon class="size-3.5" />
                  </button>
                  <ViewSelect
                    label="Sort property"
                    value={key().column}
                    options={props.columns
                      .filter(
                        (column) =>
                          !column.relation &&
                          (column.id === key().column ||
                            !sort().some((other) => other.column === column.id))
                      )
                      .map((column) => ({
                        value: column.id,
                        label: column.name,
                      }))}
                    onChange={(column) => changeKey(key().column, { column })}
                  />
                  <ViewSelect
                    label="Sort direction"
                    value={key().direction}
                    class="w-28"
                    options={[
                      { value: 'ascending', label: 'Ascending' },
                      { value: 'descending', label: 'Descending' },
                    ]}
                    onChange={(direction) =>
                      changeKey(key().column, { direction })
                    }
                  />
                  <Button
                    size="icon-sm"
                    label="Remove sort"
                    tooltipDisabled
                    onClick={() =>
                      setSort(withSort(sort(), key().column, null))
                    }
                  >
                    <XIcon class="size-3.5" />
                  </Button>
                </div>
              );
            }}
          </Key>
          <Show when={reorder.drop()}>
            {(drop) => (
              <VerticalInsertionLine
                drop={drop()}
                class="inset-x-0"
                data-sort-drop-indicator
              />
            )}
          </Show>
        </div>
        <DragOverlay
          class="pointer-events-none select-none rounded-md bg-panel shadow-md"
          style={{ 'z-index': 1000 }}
        >
          {reorder.preview()}
        </DragOverlay>
      </DragDropProvider>
      <Button
        size="sm"
        variant="ghost"
        class="mt-3"
        disabled={
          !props.columns.some(
            (column) =>
              !column.relation &&
              !sort().some((key) => key.column === column.id)
          )
        }
        onClick={() => {
          const column = props.columns.find(
            (item) =>
              !item.relation && !sort().some((key) => key.column === item.id)
          );
          if (column)
            setSort([...sort(), { column: column.id, direction: 'ascending' }]);
        }}
      >
        <PlusIcon class="size-3.5" /> Add sort
      </Button>
    </div>
  );
}
