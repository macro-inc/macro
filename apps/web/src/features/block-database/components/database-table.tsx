import {
  ContextMenuContent,
  MenuItem,
  MenuSeparator,
} from '@core/component/ContextMenu';
import { ContextMenu } from '@kobalte/core/context-menu';
import ArrowSquareOutIcon from '@phosphor/arrow-square-out.svg';
import CopyIcon from '@phosphor/copy.svg';
import PencilIcon from '@phosphor/pencil-simple.svg';
import TrashIcon from '@phosphor/trash.svg';
import { Key } from '@solid-primitives/keyed';
import {
  createDraggable,
  createDroppable,
  DragDropProvider,
  DragDropSensors,
  DragOverlay,
  useDragDropContext,
} from '@thisbeyond/solid-dnd';
import {
  type Accessor,
  createEffect,
  createSignal,
  For,
  type JSX,
  on,
  onCleanup,
  Show,
} from 'solid-js';
import { createDragAutoScroll } from '../../../components/drag-drop/create-drag-auto-scroll';
import type {
  GridCellControl,
  GridCellEditorOptions,
} from '../component/GridCell';
import type { DatabaseColumnTypeChange } from '../core/column-schema';
import type {
  DatabaseViewColumn,
  DatabaseViewConfig,
} from '../core/database-view';
import { canEditCell, type DatabaseRow } from '../core/table';
import type { DatabaseColumnHeaderProps } from './database-column-header';
import { DatabaseColumnHeader } from './database-column-header';

export function DatabaseTable(props: {
  name: string;
  rows: DatabaseRow[];
  columns: DatabaseViewColumn[];
  titleColumnId?: string;
  isUnsavedRow?: (rowId: string) => boolean;
  onRowFocus?: (rowId: string | undefined) => void;
  view: DatabaseViewConfig;
  canEdit: boolean;
  canCreateRecord: boolean;
  pending: boolean;
  addColumn: JSX.Element;
  emptyState?: JSX.Element;
  editCell?: { rowId: string; columnId: string };
  renderCell: (
    row: Accessor<DatabaseRow>,
    column: Accessor<DatabaseViewColumn>,
    options?: GridCellEditorOptions
  ) => JSX.Element;
  getRowTitle: (row: DatabaseRow) => string;
  onOpen: (rowId: string) => void;
  onCreate: () => void;
  onDuplicate?: (rowId: string) => Promise<boolean>;
  onRequestDelete?: (rowId: string) => void;
  editColumn?: string;
  relationTables?: { id: string; name: string }[];
  onChangeColumnType?: (
    columnId: string,
    change: DatabaseColumnTypeChange
  ) => Promise<void>;
  onDeleteColumn?: (columnId: string) => Promise<void>;
  onReorderColumn?: (
    columnId: string,
    targetId: string,
    edge: 'before' | 'after'
  ) => Promise<void>;
  onRenameColumn?: (
    columnId: string,
    name: string,
    previousName: string
  ) => Promise<void>;
  onSort: (columnId: string, direction: 'asc' | 'desc' | null) => void;
  onHide?: (columnId: string) => void;
  onMove?: (columnId: string, direction: 'left' | 'right') => void;
}) {
  const [columnPreview, setColumnPreview] = createSignal<HTMLElement>();
  const [columnDrop, setColumnDrop] = createSignal<{
    targetId: string;
    edge: 'before' | 'after';
    left: number;
  }>();
  let pointerOrigin: { x: number; y: number } | undefined;
  let scrollContainer!: HTMLDivElement;
  let gridElement!: HTMLDivElement;
  const headerRenames = new Map<string, () => void>();
  let requestedHeader: string | undefined;
  const focusHeader = () => {
    const rename = requestedHeader
      ? headerRenames.get(requestedHeader)
      : undefined;
    if (rename) {
      requestedHeader = undefined;
      queueMicrotask(rename);
    }
  };
  createEffect(
    on(
      () => props.editColumn,
      (id) => {
        requestedHeader = id;
        focusHeader();
      }
    )
  );
  const controls = new Map<string, Map<string, GridCellControl>>();
  let pendingEdit: { rowId: string; columnId: string } | undefined;
  const control = (rowId: string, columnId: string) =>
    controls.get(rowId)?.get(columnId);
  const editRequestedCell = () => {
    if (!pendingEdit || !props.canEdit) return;
    const editor = control(pendingEdit.rowId, pendingEdit.columnId);
    if (!editor) return;
    pendingEdit = undefined;
    editor.edit();
  };
  createEffect(
    on(
      () => props.editCell,
      (requested) => {
        pendingEdit = requested;
        editRequestedCell();
      }
    )
  );
  const register = (
    rowId: string,
    columnId: string,
    editor: GridCellControl | undefined
  ) => {
    if (!editor) {
      const row = controls.get(rowId);
      row?.delete(columnId);
      if (!row?.size) controls.delete(rowId);
      return;
    }
    let row = controls.get(rowId);
    if (!row) {
      row = new Map();
      controls.set(rowId, row);
    }
    row.set(columnId, editor);
    editRequestedCell();
  };
  const navigate = (rowId: string, columnId: string, direction: 1 | -1) => {
    if (!props.canEdit) return false;
    const columns = props.columns.filter(canEditCell);
    const rowIndex = props.rows.findIndex((row) => row.rowId === rowId);
    const columnIndex = columns.findIndex((column) => column.id === columnId);
    if (rowIndex < 0 || columnIndex < 0 || !columns.length) return false;
    const nextIndex = rowIndex * columns.length + columnIndex + direction;
    if (nextIndex < 0 || nextIndex >= props.rows.length * columns.length)
      return false;
    const row = props.rows[Math.floor(nextIndex / columns.length)];
    const column = columns[nextIndex % columns.length];
    pendingEdit = { rowId: row.rowId, columnId: column.id };
    editRequestedCell();
    return true;
  };
  const template = () =>
    `2.75rem ${props.columns.map((_, index) => (index === 0 ? 'min(var(--database-title-column-width, 18rem), max(9rem, calc(100cqw - 11.5rem)))' : '12rem')).join(' ')} ${props.canEdit ? '8.75rem' : ''}`;
  function moveFocus(event: KeyboardEvent) {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.keyCode === 229 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return;
    const target = event.target;
    if (
      !(target instanceof HTMLElement) ||
      target.closest(
        'input:not([type="checkbox"]), textarea, [contenteditable="true"], [role="menu"]'
      )
    )
      return;
    const cell = target.closest<HTMLElement>('[data-grid-cell]');
    const grid = cell?.closest<HTMLElement>('[data-grid]');
    if (!cell || !grid) return;
    if (
      event.key === 'ContextMenu' ||
      (event.shiftKey && event.key === 'F10')
    ) {
      event.preventDefault();
      event.stopPropagation();
      const bounds = cell.getBoundingClientRect();
      target.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: bounds.left + 8,
          clientY: bounds.bottom,
        })
      );
      return;
    }
    const deltas: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const delta = deltas[event.key];
    if (!delta) return;
    const rowIndex = Number(cell.dataset.gridRow) + delta[0];
    const columnIndex = Number(cell.dataset.gridColumn) + delta[1];
    const next = grid.querySelector<HTMLElement>(
      `[data-grid-row="${rowIndex}"][data-grid-column="${columnIndex}"]`
    );
    event.preventDefault();
    event.stopPropagation();
    if (!next) return;
    const row = props.rows[rowIndex];
    const column = props.columns[columnIndex - 1];
    const nextControl =
      row && column ? control(row.rowId, column.id) : undefined;
    if (nextControl) nextControl.focus();
    else
      (
        next.querySelector<HTMLElement>('button, input, [tabindex]') ?? next
      ).focus();
  }
  return (
    <DragDropProvider
      collisionDetector={(draggable, droppables) => {
        if (!pointerOrigin || !props.canEdit) {
          setColumnDrop(undefined);
          return null;
        }
        const x = pointerOrigin.x + draggable.transform.x;
        const y = pointerOrigin.y + draggable.transform.y;
        const viewport = scrollContainer.getBoundingClientRect();
        if (
          x < viewport.left ||
          x > viewport.right ||
          y < viewport.top ||
          y > viewport.bottom
        ) {
          setColumnDrop(undefined);
          return null;
        }
        const headers = droppables
          .map((droppable) => ({
            droppable,
            bounds: droppable.node.getBoundingClientRect(),
          }))
          .sort((a, b) => a.bounds.left - b.bounds.left);
        const target = (
          headers.find(({ bounds }) => x <= bounds.right) ?? headers.at(-1)
        )?.droppable;
        if (!target) {
          setColumnDrop(undefined);
          return null;
        }
        const bounds = target.node.getBoundingClientRect();
        const edge = x < bounds.left + bounds.width / 2 ? 'before' : 'after';
        const boundary = edge === 'before' ? bounds.left : bounds.right;
        if (boundary < viewport.left || boundary > viewport.right) {
          setColumnDrop(undefined);
          return null;
        }
        const from = props.columns.findIndex(
          (column) => column.id === String(draggable.id)
        );
        const to = props.columns.findIndex(
          (column) => column.id === String(target.id)
        );
        const insertion = to + Number(edge === 'after');
        if (
          from < 0 ||
          to < 0 ||
          insertion === from ||
          insertion === from + 1
        ) {
          setColumnDrop(undefined);
          return null;
        }
        setColumnDrop({
          targetId: String(target.id),
          edge,
          left: boundary - gridElement.getBoundingClientRect().left,
        });
        return target;
      }}
      onDragStart={({ draggable }) => {
        const bounds = draggable.node.getBoundingClientRect();
        const copy = draggable.node.cloneNode(true) as HTMLElement;
        copy.removeAttribute('id');
        copy
          .querySelectorAll('[id]')
          .forEach((node) => node.removeAttribute('id'));
        copy.style.width = `${bounds.width}px`;
        copy.style.height = `${bounds.height}px`;
        copy.style.opacity = '1';
        copy.style.margin = '0';
        copy.style.boxSizing = 'border-box';
        copy.inert = true;
        copy.setAttribute('aria-hidden', 'true');
        copy.setAttribute('data-column-drag-preview', '');
        setColumnPreview(copy);
      }}
      onDragEnd={({ draggable }) => {
        const drop = columnDrop();
        setColumnDrop(undefined);
        setColumnPreview(undefined);
        pointerOrigin = undefined;
        if (props.canEdit && drop)
          void props.onReorderColumn?.(
            String(draggable.id),
            drop.targetId,
            drop.edge
          );
      }}
    >
      <ColumnDragSensors
        onCancel={() => setColumnDrop(undefined)}
        scrollContainer={() => scrollContainer}
      />
      <div
        ref={scrollContainer}
        class="@container/database-grid min-h-0 flex-1 overflow-auto"
      >
        <div
          ref={(grid) => {
            gridElement = grid;
            // Closed select triggers also use arrows. The grid owns those keys
            // until an editor or its menu has opened.
            const navigateArrows = (event: KeyboardEvent) => {
              if (event.key.startsWith('Arrow')) moveFocus(event);
            };
            grid.addEventListener('keydown', navigateArrows, true);
            onCleanup(() =>
              grid.removeEventListener('keydown', navigateArrows, true)
            );
          }}
          role="grid"
          aria-label={props.name}
          aria-rowcount={props.rows.length + 1}
          aria-colcount={props.columns.length + 1 + Number(props.canEdit)}
          data-grid
          class="relative flex min-h-full min-w-fit flex-col"
          onKeyDown={moveFocus}
          onFocusIn={(event) => {
            const rowId =
              event.target instanceof HTMLElement
                ? event.target.closest<HTMLElement>('[data-grid-row-id]')
                    ?.dataset.gridRowId
                : undefined;
            if (rowId) props.onRowFocus?.(rowId);
          }}
          onFocusOut={(event) => {
            const grid = event.currentTarget;
            queueMicrotask(() => {
              const active = document.activeElement;
              if (
                active instanceof HTMLElement &&
                active !== document.body &&
                !grid.contains(active) &&
                !active.closest('[role="menu"]')
              )
                props.onRowFocus?.(undefined);
            });
          }}
        >
          <div
            role="row"
            aria-rowindex={1}
            class="sticky top-0 z-1 grid min-h-10 border-b border-edge-muted bg-panel"
            style={{ 'grid-template-columns': template() }}
          >
            <div
              role="columnheader"
              aria-label="Open record"
              class="flex items-center justify-center border-r border-edge-muted/50 text-[10px] text-ink-placeholder"
            >
              #
            </div>
            <Key each={props.columns} by="id">
              {(column, index) => (
                <DraggableColumnHeader
                  registerRename={(rename) => {
                    if (rename) headerRenames.set(column().id, rename);
                    else headerRenames.delete(column().id);
                    focusHeader();
                  }}
                  canDrag={props.canEdit && !!props.onReorderColumn}
                  onDragPointerDown={(event) => {
                    pointerOrigin = { x: event.clientX, y: event.clientY };
                  }}
                  relationTables={props.relationTables}
                  onChangeType={props.onChangeColumnType}
                  onDelete={props.onDeleteColumn}
                  column={column()}
                  sortDirection={
                    props.view.sorts.find(
                      (sort) => sort.columnId === column().id
                    )?.direction
                  }
                  canRename={props.canEdit}
                  onRename={props.onRenameColumn}
                  onSort={props.onSort}
                  onHide={props.onHide}
                  onMove={props.onMove}
                  canMoveLeft={index() > 0}
                  canMoveRight={index() < props.columns.length - 1}
                />
              )}
            </Key>
            <Show when={props.canEdit}>
              <div
                role="columnheader"
                class="flex items-center justify-start px-2"
              >
                {props.addColumn}
              </div>
            </Show>
          </div>
          <Key each={props.rows} by="rowId">
            {(row, index) => {
              const [contextColumn, setContextColumn] = createSignal<string>();
              let afterClose: (() => void) | undefined;
              let rowButton: HTMLButtonElement | undefined;
              const deferAction = (action: () => void) => {
                afterClose = action;
              };
              const contextField = () =>
                props.columns.find((column) => column.id === contextColumn());
              const renameField = () =>
                props.columns.find(
                  (column) =>
                    column.id === props.titleColumnId && canEditCell(column)
                );
              const captureContext = (event: MouseEvent, columnId?: string) => {
                if (
                  event.target instanceof HTMLElement &&
                  event.target.closest(
                    'input:not([type="checkbox"]), textarea, [contenteditable="true"]'
                  )
                ) {
                  event.stopPropagation();
                  return;
                }
                setContextColumn(columnId);
              };
              return (
                <ContextMenu>
                  <ContextMenu.Trigger
                    as="div"
                    role="row"
                    data-grid-row-id={row().rowId}
                    aria-rowindex={index() + 2}
                    class="group grid min-h-10 border-b border-edge-muted/60 hover:bg-hover/50"
                    style={{ 'grid-template-columns': template() }}
                  >
                    <div
                      role="gridcell"
                      aria-colindex={1}
                      tabindex={-1}
                      class="flex items-center justify-center border-r border-edge-muted/40 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ink/50"
                      data-grid-cell
                      data-grid-row={index()}
                      data-grid-column={0}
                      onContextMenu={(event) => captureContext(event)}
                    >
                      <Show
                        when={!props.isUnsavedRow?.(row().rowId)}
                        fallback={
                          <span class="text-[10px] tabular-nums text-ink-placeholder">
                            {index() + 1}
                          </span>
                        }
                      >
                        <button
                          ref={rowButton}
                          type="button"
                          class="relative grid size-7 place-items-center rounded text-[10px] tabular-nums text-ink-placeholder outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ink/50"
                          aria-label={`Open ${props.getRowTitle(row())}`}
                          title="Open record"
                          onClick={() => props.onOpen(row().rowId)}
                        >
                          <span class="group-hover:opacity-0 group-focus-within:opacity-0">
                            {index() + 1}
                          </span>
                          <ArrowSquareOutIcon class="absolute size-3.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100" />
                        </button>
                      </Show>
                    </div>
                    <Key each={props.columns} by="id">
                      {(column, columnIndex) => (
                        <div
                          role="gridcell"
                          aria-colindex={columnIndex() + 2}
                          tabindex={-1}
                          class="min-w-0 border-r border-edge-muted/40 px-0.5 py-0.5 outline-none focus-within:ring-1 focus-within:ring-inset focus-within:ring-ink/40 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ink/50"
                          data-grid-cell
                          data-grid-row={index()}
                          data-grid-column={columnIndex() + 1}
                          onContextMenu={(event) =>
                            captureContext(event, column().id)
                          }
                        >
                          {props.renderCell(row, column, {
                            onReady: (editor) =>
                              register(row().rowId, column().id, editor),
                            onNavigate: (direction) =>
                              navigate(row().rowId, column().id, direction),
                          })}
                        </div>
                      )}
                    </Key>
                    <Show when={props.canEdit}>
                      <div
                        role="gridcell"
                        onContextMenu={(event) => captureContext(event)}
                      />
                    </Show>
                  </ContextMenu.Trigger>
                  <ContextMenu.Portal>
                    <ContextMenuContent
                      class="min-w-44"
                      onCloseAutoFocus={(event) => {
                        event.preventDefault();
                        const action = afterClose;
                        afterClose = undefined;
                        queueMicrotask(() => {
                          if (action) {
                            action();
                            return;
                          }
                          const columnId = contextColumn();
                          const cell = columnId
                            ? control(row().rowId, columnId)
                            : undefined;
                          if (cell) cell.focus();
                          else rowButton?.focus();
                        });
                      }}
                    >
                      <Show
                        when={
                          props.canEdit &&
                          contextField() &&
                          canEditCell(contextField()!)
                        }
                      >
                        <MenuItem
                          closeOnSelect
                          icon={PencilIcon}
                          text="Edit cell"
                          onClick={() =>
                            deferAction(() =>
                              control(row().rowId, contextColumn()!)?.edit()
                            )
                          }
                        />
                      </Show>
                      <Show when={!props.isUnsavedRow?.(row().rowId)}>
                        <MenuItem
                          closeOnSelect
                          icon={ArrowSquareOutIcon}
                          text="Open record"
                          onClick={() =>
                            deferAction(() => props.onOpen(row().rowId))
                          }
                        />
                        <Show
                          when={
                            props.canEdit &&
                            renameField() &&
                            contextColumn() !== renameField()?.id
                          }
                        >
                          <MenuItem
                            closeOnSelect
                            icon={PencilIcon}
                            text="Rename"
                            onClick={() =>
                              deferAction(() =>
                                control(row().rowId, renameField()!.id)?.edit()
                              )
                            }
                          />
                        </Show>
                        <Show when={props.canEdit && props.onDuplicate}>
                          <MenuItem
                            closeOnSelect
                            icon={CopyIcon}
                            text="Duplicate"
                            disabled={props.pending}
                            onClick={() =>
                              deferAction(() => {
                                void props.onDuplicate?.(row().rowId);
                              })
                            }
                          />
                        </Show>
                        <Show when={props.canEdit && props.onRequestDelete}>
                          <MenuSeparator />
                          <MenuItem
                            closeOnSelect
                            icon={TrashIcon}
                            text="Delete record"
                            class="text-failure"
                            disabled={props.pending}
                            onClick={() =>
                              deferAction(() =>
                                props.onRequestDelete?.(row().rowId)
                              )
                            }
                          />
                        </Show>
                      </Show>
                    </ContextMenuContent>
                  </ContextMenu.Portal>
                </ContextMenu>
              );
            }}
          </Key>
          <Show when={props.rows.length === 0}>{props.emptyState}</Show>
          <div
            aria-hidden="true"
            class="grid min-h-40 flex-1"
            data-empty-grid
            style={{
              'grid-template-columns': template(),
              'background-image':
                'repeating-linear-gradient(to bottom, transparent 0px, transparent 39px, color-mix(in srgb, var(--color-edge-muted) 60%, transparent) 39px, color-mix(in srgb, var(--color-edge-muted) 60%, transparent) 40px)',
            }}
          >
            <div class="border-r border-edge-muted/40" />
            <For each={props.columns}>
              {() => <div class="border-r border-edge-muted/40" />}
            </For>
            <Show when={props.canEdit}>
              <div />
            </Show>
          </div>
          <Show when={columnDrop()}>
            {(drop) => (
              <div
                aria-hidden="true"
                data-column-drop-indicator
                data-drop-target={drop().targetId}
                data-drop-edge={drop().edge}
                class="pointer-events-none absolute inset-y-0 z-2 w-0.5 -translate-x-1/2 bg-accent"
                style={{ left: `${drop().left}px` }}
              />
            )}
          </Show>
        </div>
      </div>
      <DragOverlay
        class="pointer-events-none select-none bg-panel shadow-md"
        style={{ 'z-index': 1000 }}
      >
        {columnPreview()}
      </DragOverlay>
    </DragDropProvider>
  );
}

function DraggableColumnHeader(
  props: DatabaseColumnHeaderProps & {
    canDrag: boolean;
    onDragPointerDown: (event: MouseEvent) => void;
  }
) {
  const draggable = createDraggable(props.column.id);
  const droppable = createDroppable(props.column.id);
  return (
    <DatabaseColumnHeader
      {...props}
      headerRef={(element) => {
        draggable.ref(element);
        droppable.ref(element);
      }}
      dragHandle={
        props.canDrag
          ? {
              onMouseDown: (event) => {
                if (
                  event.button !== 0 ||
                  (event.target instanceof Element &&
                    event.target.closest('button, input'))
                )
                  return;
                props.onDragPointerDown(event);
                draggable.dragActivators.onmousedown?.(event);
              },
            }
          : undefined
      }
      dragging={draggable.isActiveDraggable}
    />
  );
}

function ColumnDragSensors(props: {
  onCancel: () => void;
  scrollContainer: () => HTMLElement;
}) {
  const context = useDragDropContext();
  if (!context) throw new Error('ColumnDragSensors requires DragDropProvider');
  const [state, actions] = context;
  createDragAutoScroll({ getViewport: props.scrollContainer, axis: 'x' });
  const cancelDrag = () => {
    if (!state.active.draggable) return;
    props.onCancel();
    // Keep the sensor until mouseup so its next mousemove cannot restart a drag.
    actions.dragEnd();
  };
  const cancel = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !state.active.draggable) return;
    event.preventDefault();
    event.stopPropagation();
    cancelDrag();
  };
  const updateDrop = (event: Event) => {
    if (event.target === props.scrollContainer() && state.active.draggable)
      actions.detectCollisions();
  };
  document.addEventListener('keydown', cancel, true);
  document.addEventListener('scroll', updateDrop, true);
  window.addEventListener('blur', cancelDrag);
  onCleanup(() => {
    document.removeEventListener('keydown', cancel, true);
    document.removeEventListener('scroll', updateDrop, true);
    window.removeEventListener('blur', cancelDrag);
  });
  return <DragDropSensors />;
}
