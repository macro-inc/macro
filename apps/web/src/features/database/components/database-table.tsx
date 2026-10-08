import { ContextMenu } from '@kobalte/core/context-menu';
import ArrowSquareOutIcon from '@phosphor/arrow-square-out.svg';
import CopyIcon from '@phosphor/copy.svg';
import PencilIcon from '@phosphor/pencil-simple.svg';
import TrashIcon from '@phosphor/trash.svg';
import { Key } from '@solid-primitives/keyed';
import { createElementSize } from '@solid-primitives/resize-observer';
import { DragDropProvider, DragOverlay } from '@thisbeyond/solid-dnd';
import { getHashedPaletteColor } from '@ui/utils/palette';
import {
  type Accessor,
  children,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  on,
  onCleanup,
  Show,
} from 'solid-js';
import { Virtualizer, type VirtualizerHandle } from 'virtua/solid';
import { createHorizontalReorder } from '../../../components/drag-drop/create-horizontal-reorder';
import { createReorderItem } from '../../../components/drag-drop/create-reorder';
import { DragSessionSensors } from '../../../components/drag-drop/drag-session-sensors';
import { InsertionLine } from '../../../components/drag-drop/insertion-line';
import {
  ContextMenuContent,
  MenuItem,
  MenuSeparator,
} from '../../../lib/core/component/ContextMenu';
import {
  getDisplayNameParts,
  getInitials,
  macroIdToEmail,
  tryMacroId,
} from '../../../lib/core/user/index';
import type {
  DatabaseColumnCastsSource,
  DatabaseColumnConversion,
  DatabaseColumnTypeChange,
  DatabaseSchemaChange,
} from '../core/column-schema';
import type { DatabaseViewColumn } from '../core/database-view';
import type {
  GridCellControl,
  GridCellEditorOptions,
} from '../core/grid-cell-editor';
import { canEditCell, type DatabaseRow } from '../core/table';
import {
  cellRangeBounds,
  createCellSelection,
} from '../primitives/cell-selection';
import type { DatabaseTableModel } from '../primitives/table-model';
import type { DatabaseColumnHeaderProps } from './database-column-header';
import { DatabaseColumnHeader } from './database-column-header';
import { DatabaseTableSummary } from './database-table-summary';

/** The cell this client has focused, as shared with the table's other viewers. */
export type DatabaseCellFocus = {
  rowId: string;
  columnId?: string;
  endRowId?: string;
  endColumnId?: string;
  editing: boolean;
};

/** Another viewer of the same table; no row or column means no cell. */
export type DatabaseCellPresence = {
  peerId?: string;
  userId: string;
  rowId?: string;
  columnId?: string;
  endRowId?: string;
  endColumnId?: string;
  editing: boolean;
};

/** Lets the host open a cell's editor or a header's rename; a target not yet mounted opens once it registers. */
export type DatabaseTableControls = {
  editCell: (rowId: string, columnId: string) => void;
  renameColumn: (columnId: string) => void;
};

/** Focus inside one of these means the cell's inline editor is open. */
const EDITOR_FIELDS =
  'input:not([type="checkbox"]), textarea, [contenteditable="true"]';
/** Portaled editors keep the cell current while they hold focus. */
const PORTALED_EDITORS = '[role="dialog"], [role="listbox"]';

export type DatabaseTableProps = {
  model: DatabaseTableModel;
  name: string;
  titleColumnId?: string;
  isUnsavedRow?: (rowId: string) => boolean;
  onRowFocus?: (rowId: string | undefined) => void;
  onLoadMore?: () => void;
  hasMoreRows?: boolean;
  onCellFocus?: (cell: DatabaseCellFocus | undefined) => void;
  remoteUsers?: DatabaseCellPresence[];
  /** Scrolled into view and briefly tinted, e.g. the target of a relation. */
  highlightRowId?: string;
  resizable?: boolean;
  canEdit: boolean;
  pending: boolean;
  addColumn?: JSX.Element;
  emptyState?: JSX.Element;
  controlsRef?: (controls: DatabaseTableControls) => void;
  renderCell: (
    row: Accessor<DatabaseRow>,
    column: Accessor<DatabaseViewColumn>,
    options?: GridCellEditorOptions
  ) => JSX.Element;
  getRowTitle: (row: DatabaseRow) => string;
  onOpen: (rowId: string) => void;
  onDuplicate?: (rowId: string) => Promise<boolean>;
  onRequestDelete?: (rowId: string) => void;
  onClearCells?: (rowIds: string[], columnIds: string[]) => Promise<boolean>;
  relationTables?: { id: string; name: string }[];
  columnCasts?: DatabaseColumnCastsSource;
  onChangeColumnType?: (
    columnId: string,
    change: DatabaseColumnTypeChange
  ) => DatabaseSchemaChange;
  onConvertColumn?: (
    columnId: string,
    conversion: DatabaseColumnConversion
  ) => DatabaseSchemaChange<string>;
  onDeleteColumn?: (columnId: string) => DatabaseSchemaChange;
  onReorderColumn?: (
    columnId: string,
    targetId: string,
    edge: 'before' | 'after'
  ) => Promise<void>;
  onRenameColumn?: (
    columnId: string,
    name: string,
    previousName: string
  ) => DatabaseSchemaChange;
  onMove?: (columnId: string, direction: 'left' | 'right') => void;
  onInsertColumn?: (columnId: string, side: 'left' | 'right') => void;
};

export function DatabaseTable(props: DatabaseTableProps) {
  const columns = () => props.model.visibleColumns();
  const rows = () => props.model.rows();
  const addColumn = children(() =>
    props.canEdit ? props.addColumn : undefined
  );
  const hasAddColumn = () =>
    addColumn
      .toArray()
      .some((child) => child != null && typeof child !== 'boolean');
  const summaryRows = createMemo(() =>
    rows().filter((row) => !props.isUnsavedRow?.(row.rowId))
  );
  let scrollContainer!: HTMLDivElement;
  let gridElement!: HTMLDivElement;
  let virtualizer: VirtualizerHandle | undefined;
  const [header, setHeader] = createSignal<HTMLDivElement>();
  const headerSize = createElementSize(header);
  const [focusedRow, setFocusedRow] = createSignal<string>();
  let pendingFocus: { rowId: string; column: number } | undefined;
  let revealFrame: number | undefined;
  const cellElement = (rowId: string, column: number) => {
    const index = selection.rowIndex().get(rowId);
    return gridElement?.querySelector<HTMLElement>(
      `[data-grid-row="${index}"][data-grid-column="${column}"]`
    );
  };
  const cellIsVisible = (cell: HTMLElement) => {
    // Virtualized rows are hidden until measured; focusing before then is ignored.
    if (getComputedStyle(cell).visibility !== 'hidden') return true;
    if (revealFrame === undefined)
      revealFrame = requestAnimationFrame(() => {
        revealFrame = undefined;
        editRequestedCell();
        focusRequestedCell();
      });
    return false;
  };
  onCleanup(() => {
    if (revealFrame !== undefined) cancelAnimationFrame(revealFrame);
  });
  const revealRow = (rowId: string) => {
    setFocusedRow(rowId);
    const index = selection.rowIndex().get(rowId);
    if (index === undefined || !virtualizer) return;
    const headerHeight = headerSize.height ?? 40;
    const summaryHeight =
      gridElement.querySelector<HTMLElement>('[data-grid-summary]')
        ?.offsetHeight ?? 0;
    const top = virtualizer.getItemOffset(index) + headerHeight;
    const bottom = top + virtualizer.getItemSize(index);
    if (top < scrollContainer.scrollTop + headerHeight)
      virtualizer.scrollToIndex(index, {
        align: 'start',
        offset: -headerHeight,
      });
    else if (
      bottom >
      scrollContainer.scrollTop + scrollContainer.clientHeight - summaryHeight
    )
      virtualizer.scrollToIndex(index, { align: 'end', offset: summaryHeight });
  };
  const focusRequestedCell = () => {
    if (!pendingFocus) return;
    const { rowId, column } = pendingFocus;
    const cell = cellElement(rowId, column);
    if (!cell || !cellIsVisible(cell)) return;
    pendingFocus = undefined;
    const columnId = columns()[column - 1]?.id;
    const editor = columnId ? control(rowId, columnId) : undefined;
    if (editor) {
      editor.focus();
      return;
    }
    (
      cell.querySelector<HTMLElement>('button, input, [tabindex]') ?? cell
    ).focus();
  };
  const columnReorder = createHorizontalReorder({
    order: () => columns().map((column) => column.id),
    getViewport: () => scrollContainer,
    enabled: () => props.canEdit,
    boundaryInViewport: true,
    previewMarker: 'data-column-drag-preview',
    indicatorLeft: (boundary) =>
      boundary - gridElement.getBoundingClientRect().left,
    onDrop: (columnId, targetId, edge) =>
      void props.onReorderColumn?.(columnId, targetId, edge),
  });
  const headerRenames = new Map<string, () => void>();
  let requestedHeader: string | undefined;
  const renameRequestedHeader = () => {
    const rename = requestedHeader
      ? headerRenames.get(requestedHeader)
      : undefined;
    if (rename) {
      requestedHeader = undefined;
      queueMicrotask(rename);
    }
  };
  const controls = new Map<string, Map<string, GridCellControl>>();
  let pendingEdit: { rowId: string; columnId: string } | undefined;
  const control = (rowId: string, columnId: string) =>
    controls.get(rowId)?.get(columnId);
  const editRequestedCell = () => {
    if (!pendingEdit || !props.canEdit) return;
    const editor = control(pendingEdit.rowId, pendingEdit.columnId);
    if (!editor) return;
    const column =
      columns().findIndex(({ id }) => id === pendingEdit?.columnId) + 1;
    const cell = cellElement(pendingEdit.rowId, column);
    if (!cell || !cellIsVisible(cell)) return;
    pendingEdit = undefined;
    editor.edit();
  };
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
    queueMicrotask(focusRequestedCell);
  };
  const navigate = (rowId: string, columnId: string, direction: 1 | -1) => {
    if (!props.canEdit) return false;
    const editableColumns = columns().filter(canEditCell);
    const rowIndex = rows().findIndex((row) => row.rowId === rowId);
    const columnIndex = editableColumns.findIndex(
      (column) => column.id === columnId
    );
    if (rowIndex < 0 || columnIndex < 0 || !editableColumns.length)
      return false;
    const nextIndex =
      rowIndex * editableColumns.length + columnIndex + direction;
    if (nextIndex < 0 || nextIndex >= rows().length * editableColumns.length)
      return false;
    const row = rows()[Math.floor(nextIndex / editableColumns.length)];
    const column = editableColumns[nextIndex % editableColumns.length];
    pendingEdit = { rowId: row.rowId, columnId: column.id };
    revealRow(row.rowId);
    editRequestedCell();
    return true;
  };
  const navigateRow = (rowId: string, columnId: string, direction: 1 | -1) => {
    if (!props.canEdit) return false;
    const column = columns().find((candidate) => candidate.id === columnId);
    const rowIndex = rows().findIndex((row) => row.rowId === rowId);
    const row = rows()[rowIndex + direction];
    if (rowIndex < 0 || !row || !column || !canEditCell(column)) return false;
    pendingEdit = { rowId: row.rowId, columnId };
    revealRow(row.rowId);
    editRequestedCell();
    return true;
  };
  let announcedCell: DatabaseCellFocus | undefined;
  const announceCell = (cell: DatabaseCellFocus | undefined) => {
    if (
      cell?.rowId === announcedCell?.rowId &&
      cell?.columnId === announcedCell?.columnId &&
      cell?.endRowId === announcedCell?.endRowId &&
      cell?.endColumnId === announcedCell?.endColumnId &&
      cell?.editing === announcedCell?.editing
    )
      return;
    announcedCell = cell;
    props.onCellFocus?.(cell);
  };
  const cellAt = (
    target: EventTarget | null
  ): DatabaseCellFocus | undefined => {
    if (!(target instanceof HTMLElement)) return undefined;
    const cell = target.closest<HTMLElement>('[data-grid-cell]');
    const rowId =
      cell?.closest<HTMLElement>('[data-grid-row-id]')?.dataset.gridRowId;
    if (!cell || !rowId) return undefined;
    const column = columns()[Number(cell.dataset.gridColumn) - 1];
    return {
      rowId,
      columnId: column?.id,
      editing: target.matches(EDITOR_FIELDS),
    };
  };
  const selection = createCellSelection({
    rows: () => rows().map((row) => row.rowId),
    columns: () => columns().map((column) => column.id),
    cellAt: (target) => {
      if (!(target instanceof Element) || !gridElement?.contains(target))
        return;
      const cell = cellAt(target);
      return cell?.columnId && !props.isUnsavedRow?.(cell.rowId)
        ? { rowId: cell.rowId, columnId: cell.columnId }
        : undefined;
    },
    focus: () => gridElement.focus({ preventScroll: true }),
    onChange: (range) =>
      announceCell(
        range
          ? {
              ...range.anchor,
              endRowId: range.focus.rowId,
              endColumnId: range.focus.columnId,
              editing: false,
            }
          : undefined
      ),
    onClear:
      props.canEdit && props.onClearCells
        ? (rows, columns) => props.onClearCells!(rows, columns)
        : undefined,
  });
  props.controlsRef?.({
    editCell: (rowId, columnId) => {
      pendingEdit = { rowId, columnId };
      revealRow(rowId);
      editRequestedCell();
    },
    renameColumn: (columnId) => {
      requestedHeader = columnId;
      renameRequestedHeader();
    },
  });
  const rowIds = createMemo(() => [...selection.rowIndex().keys()]);
  createEffect(
    on(
      () => props.highlightRowId,
      (rowId) => {
        if (rowId) revealRow(rowId);
      }
    )
  );
  const remoteRanges = createMemo(() =>
    (props.remoteUsers ?? []).flatMap((user) => {
      if (!user.rowId || !user.columnId) return [];
      const bounds = cellRangeBounds(
        {
          anchor: { rowId: user.rowId, columnId: user.columnId },
          focus: {
            rowId: user.endRowId ?? user.rowId,
            columnId: user.endColumnId ?? user.columnId,
          },
        },
        selection.rowIndex(),
        selection.columnIndex()
      );
      return bounds ? [{ user, bounds }] : [];
    })
  );
  const presenceAt = (rowId: string, columnId: string) => {
    const row = selection.rowIndex().get(rowId)!;
    const column = selection.columnIndex().get(columnId)!;
    return remoteRanges().filter(
      ({ bounds }) =>
        row >= bounds.top &&
        row <= bounds.bottom &&
        column >= bounds.left &&
        column <= bounds.right
    );
  };
  // Every row lays out on this one track list.
  const template = createMemo(
    () =>
      `2.75rem ${columns()
        .map((column, index) => {
          const width = props.model.width(column.id);
          if (width !== undefined) return `${width}px`;
          return index === 0
            ? 'min(var(--database-title-column-width, 18rem), max(9rem, calc(100cqw - 11.5rem)))'
            : '12rem';
        })
        .join(' ')} ${hasAddColumn() ? '8.75rem' : ''}`
  );
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
    const row = rows()[rowIndex];
    const column = columns()[columnIndex - 1];
    if (!row || columnIndex < 0 || columnIndex > columns().length) return;
    const editDraft =
      delta[0] === 1 &&
      props.canEdit &&
      column &&
      canEditCell(column) &&
      props.isUnsavedRow?.(row.rowId);
    if (!next) {
      if (editDraft) pendingEdit = { rowId: row.rowId, columnId: column.id };
      else pendingFocus = { rowId: row.rowId, column: columnIndex };
      revealRow(row.rowId);
      editRequestedCell();
      queueMicrotask(focusRequestedCell);
      return;
    }
    const nextControl =
      row && column ? control(row.rowId, column.id) : undefined;
    // Stepping down onto the new-record row starts typing there, like a spreadsheet.
    if (nextControl && editDraft) nextControl.edit();
    else if (nextControl) nextControl.focus();
    else
      (
        next.querySelector<HTMLElement>('button, input, [tabindex]') ?? next
      ).focus();
  }
  // One menu for every row: right-click (or a long press) picks its row and cell.
  const [contextTarget, setContextTarget] = createSignal<{
    rowId: string;
    columnId?: string;
  }>();
  const contextRowId = () => contextTarget()?.rowId ?? '';
  const keptRows = createMemo(() =>
    [
      ...new Set([focusedRow(), contextTarget()?.rowId, props.highlightRowId]),
    ].flatMap((rowId) => {
      const index =
        rowId === undefined ? undefined : selection.rowIndex().get(rowId);
      return index === undefined ? [] : [index];
    })
  );
  const rowButtons = new Map<string, HTMLButtonElement>();
  let afterClose: (() => void) | undefined;
  const deferAction = (action: () => void) => {
    afterClose = action;
  };
  const contextField = () =>
    columns().find((column) => column.id === contextTarget()?.columnId);
  const renameField = () =>
    columns().find(
      (column) => column.id === props.titleColumnId && canEditCell(column)
    );
  /** Note the row and cell a context menu opens for; false when it is not for a row. */
  const captureContext = (target: EventTarget | null): boolean => {
    if (
      !(target instanceof HTMLElement) ||
      target.closest(
        'input:not([type="checkbox"]), textarea, [contenteditable="true"]'
      )
    )
      return false;
    const rowId =
      target.closest<HTMLElement>('[data-grid-row-id]')?.dataset.gridRowId;
    if (!rowId) return false;
    setContextTarget({ rowId, columnId: cellAt(target)?.columnId });
    return true;
  };
  return (
    <DragDropProvider
      collisionDetector={columnReorder.collisionDetector}
      onDragStart={columnReorder.onDragStart}
      onDragEnd={columnReorder.onDragEnd}
    >
      <DragSessionSensors
        getViewport={() => scrollContainer}
        axis="x"
        onCancel={columnReorder.cancel}
      />
      <div
        ref={scrollContainer}
        class="@container/database-grid min-h-0 flex-1 overflow-auto overscroll-x-none scroll-py-10"
        onScroll={(event) => {
          const container = event.currentTarget;
          if (
            !props.isUnsavedRow?.(focusedRow() ?? '') &&
            container.scrollHeight -
              container.scrollTop -
              container.clientHeight <
              800
          )
            props.onLoadMore?.();
        }}
      >
        <div
          ref={(grid) => {
            gridElement = grid;
            // Closed select triggers also use arrows. The grid owns those keys
            // until an editor or its menu has opened.
            const navigateArrows = (event: KeyboardEvent) => {
              selection.keyDown(event);
              if (event.defaultPrevented) return;
              if (event.key.startsWith('Arrow')) moveFocus(event);
            };
            grid.addEventListener('keydown', navigateArrows, true);
            grid.addEventListener('pointerdown', selection.pointerDown, true);
            grid.addEventListener('click', selection.click, true);
            onCleanup(() => {
              grid.removeEventListener(
                'pointerdown',
                selection.pointerDown,
                true
              );
              grid.removeEventListener('click', selection.click, true);
            });
            onCleanup(() =>
              grid.removeEventListener('keydown', navigateArrows, true)
            );
          }}
          role="grid"
          tabIndex={-1}
          aria-multiselectable="true"
          aria-label={props.name}
          aria-rowcount={props.hasMoreRows ? -1 : rows().length + 2}
          aria-colcount={columns().length + 1 + Number(hasAddColumn())}
          data-grid
          data-grid-saved-rows={summaryRows().length}
          class="relative flex min-h-full min-w-fit flex-col"
          onKeyDown={moveFocus}
          onFocusIn={(event) => {
            const rowId =
              event.target instanceof HTMLElement
                ? event.target.closest<HTMLElement>('[data-grid-row-id]')
                    ?.dataset.gridRowId
                : undefined;
            if (rowId) {
              setFocusedRow(rowId);
              props.onRowFocus?.(rowId);
            }
            if (!selection.range()) announceCell(cellAt(event.target));
          }}
          onFocusOut={(event) => {
            const grid = event.currentTarget;
            queueMicrotask(() => {
              const active = document.activeElement;
              if (
                !(active instanceof HTMLElement) ||
                active === document.body ||
                grid.contains(active) ||
                active.closest('[role="menu"]')
              )
                return;
              props.onRowFocus?.(undefined);
              if (active.closest(PORTALED_EDITORS) && announcedCell)
                announceCell({ ...announcedCell, editing: true });
              else {
                selection.clear();
                announceCell(undefined);
              }
            });
          }}
        >
          <div
            ref={setHeader}
            role="row"
            aria-rowindex={1}
            class="sticky top-0 z-1 grid min-h-10 border-b border-edge-muted bg-panel"
            style={{ 'grid-template-columns': template() }}
          >
            <div
              role="columnheader"
              aria-label="Open record"
              class="sticky left-0 z-1 flex items-center justify-center border-r border-edge-muted/50 bg-panel text-[10px] text-ink-placeholder"
            >
              #
            </div>
            <Key each={props.model.table.getFlatHeaders()} by="id">
              {(header) => {
                const column = () => header().column.columnDef.meta!;
                return (
                  <DraggableColumnHeader
                    registerRename={(rename) => {
                      if (rename) headerRenames.set(column().id, rename);
                      else headerRenames.delete(column().id);
                      renameRequestedHeader();
                    }}
                    canDrag={props.canEdit && !!props.onReorderColumn}
                    onDragStart={columnReorder.start}
                    relationTables={props.relationTables}
                    columnCasts={props.columnCasts}
                    onChangeType={props.onChangeColumnType}
                    onConvert={props.onConvertColumn}
                    onDelete={props.onDeleteColumn}
                    column={column()}
                    sortDirection={header().column.getIsSorted() || undefined}
                    resizeHandle={
                      props.resizable ? (
                        <div
                          role="separator"
                          aria-orientation="vertical"
                          aria-label={`Resize ${column().name}`}
                          class="absolute top-0 right-0 z-1 h-full w-1.5 cursor-col-resize touch-none hover:bg-accent/40"
                          onMouseDown={(event) =>
                            props.model.resize(header(), event)
                          }
                          // Native listeners keep touch hit-testing on this narrow
                          // handle and let touchstart prevent browser gestures.
                          on:touchstart={(event) =>
                            props.model.resize(header(), event)
                          }
                          on:click={(event) => event.stopPropagation()}
                          onDblClick={(event) => event.stopPropagation()}
                        />
                      ) : undefined
                    }
                    canRename={props.canEdit}
                    onRename={props.onRenameColumn}
                    onSort={props.model.sort}
                    onMove={props.onMove}
                    onInsert={props.onInsertColumn}
                    canMoveLeft={!header().column.getIsFirstColumn()}
                    canMoveRight={!header().column.getIsLastColumn()}
                  />
                );
              }}
            </Key>
            <Show when={hasAddColumn()}>
              <div
                role="columnheader"
                class="flex items-center justify-start px-2"
              >
                {addColumn()}
              </div>
            </Show>
          </div>
          <ContextMenu>
            <ContextMenu.Trigger as="div" class="contents">
              <div
                class="contents"
                // Runs before the menu's own handler: it picks the row and
                // cell the menu is for, or lets the browser's menu through.
                onContextMenu={(event) => {
                  if (!captureContext(event.target)) event.stopPropagation();
                }}
                onPointerDown={(event) => {
                  if (event.pointerType !== 'mouse')
                    captureContext(event.target);
                }}
              >
                {/* Keep unchanged records and their editors mounted across reads. */}
                <Virtualizer
                  ref={(handle) => {
                    virtualizer = handle;
                  }}
                  data={rowIds()}
                  scrollRef={scrollContainer}
                  startMargin={headerSize.height ?? 40}
                  itemSize={41}
                  bufferSize={240}
                  keepMounted={keptRows()}
                >
                  {(rowId, index) => {
                    const initial = rows()[index()];
                    const row = createMemo(
                      () => rows()[selection.rowIndex().get(rowId)!] ?? initial
                    );
                    const highlighted = () =>
                      props.highlightRowId === row().rowId;
                    return (
                      <div
                        ref={(element: HTMLElement) => {
                          createEffect(
                            on(highlighted, (isHighlighted) => {
                              if (!isHighlighted) return;
                              element.scrollIntoView({ block: 'nearest' });
                              const first = columns()[0];
                              if (first)
                                control(row().rowId, first.id)?.focus();
                            })
                          );
                        }}
                        role="row"
                        data-grid-row-id={row().rowId}
                        data-highlighted={highlighted() ? '' : undefined}
                        aria-rowindex={index() + 2}
                        class="group grid min-h-10 border-b border-edge-muted/60 [contain-intrinsic-size:auto_41px] [content-visibility:auto] hover:bg-hover/50"
                        classList={{ 'bg-accent/15': highlighted() }}
                        style={{ 'grid-template-columns': template() }}
                      >
                        <div
                          role="gridcell"
                          aria-colindex={1}
                          tabindex={-1}
                          // Opaque so cells scrolled beneath it stay hidden; the
                          // overlay repeats the row's hover and highlight tint.
                          class="sticky left-0 z-1 flex items-center justify-center border-r border-edge-muted/40 bg-panel outline-none before:pointer-events-none before:absolute before:inset-0 group-hover:before:bg-hover/50 group-data-highlighted:before:bg-accent/15 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ink/50"
                          data-grid-cell
                          data-grid-row={index()}
                          data-grid-column={0}
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
                              ref={(button) => {
                                rowButtons.set(rowId, button);
                                queueMicrotask(focusRequestedCell);
                                onCleanup(() => {
                                  if (rowButtons.get(rowId) === button)
                                    rowButtons.delete(rowId);
                                });
                              }}
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
                        <Key each={columns()} by="id">
                          {(column, columnIndex) => {
                            const columnId = column().id;
                            const presence = () =>
                              presenceAt(row().rowId, column().id);
                            return (
                              <div
                                role="gridcell"
                                aria-selected={selection.contains(
                                  index(),
                                  columnIndex()
                                )}
                                aria-colindex={columnIndex() + 2}
                                tabindex={-1}
                                class="relative min-w-0 border-r border-edge-muted/40 px-0.5 py-0.5 outline-none focus-within:ring-1 focus-within:ring-inset focus-within:ring-ink/40 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ink/50"
                                classList={{
                                  'bg-accent/15 ring-1 ring-inset ring-accent/50':
                                    selection.contains(index(), columnIndex()),
                                }}
                                data-grid-cell
                                data-grid-row={index()}
                                data-grid-column={columnIndex() + 1}
                                data-remote-users={
                                  presence().length
                                    ? presence()
                                        .map(({ user }) => user.userId)
                                        .join(' ')
                                    : undefined
                                }
                                style={presenceOutline(
                                  presence()[0]?.user,
                                  presence()[0]
                                    ? {
                                        top:
                                          index() === presence()[0].bounds.top,
                                        bottom:
                                          index() ===
                                          presence()[0].bounds.bottom,
                                        left:
                                          columnIndex() ===
                                          presence()[0].bounds.left,
                                        right:
                                          columnIndex() ===
                                          presence()[0].bounds.right,
                                      }
                                    : undefined
                                )}
                              >
                                {props.renderCell(row, column, {
                                  onReady: (editor) =>
                                    register(rowId, columnId, editor),
                                  onNavigate: (direction) =>
                                    navigate(
                                      row().rowId,
                                      column().id,
                                      direction
                                    ),
                                  onNavigateRow: (direction) =>
                                    navigateRow(
                                      row().rowId,
                                      column().id,
                                      direction
                                    ),
                                })}
                                <Show when={presence().length}>
                                  <span class="pointer-events-none absolute top-0 left-0 z-1 flex gap-px">
                                    <For
                                      each={presence().filter(
                                        ({ bounds }) =>
                                          bounds.top === index() &&
                                          bounds.left === columnIndex()
                                      )}
                                    >
                                      {({ user }) => (
                                        <PresenceTag user={user} below />
                                      )}
                                    </For>
                                  </span>
                                </Show>
                              </div>
                            );
                          }}
                        </Key>
                        <Show when={hasAddColumn()}>
                          <div role="gridcell" />
                        </Show>
                      </div>
                    );
                  }}
                </Virtualizer>
              </div>
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
                    const target = contextTarget();
                    if (!target) return;
                    const columnId = target.columnId;
                    const cell = columnId
                      ? control(target.rowId, columnId)
                      : undefined;
                    if (cell) cell.focus();
                    else rowButtons.get(target.rowId)?.focus();
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
                        control(
                          contextRowId(),
                          contextTarget()!.columnId!
                        )?.edit()
                      )
                    }
                  />
                </Show>
                <Show when={!props.isUnsavedRow?.(contextRowId())}>
                  <MenuItem
                    closeOnSelect
                    icon={ArrowSquareOutIcon}
                    text="Open record"
                    onClick={() =>
                      deferAction(() => props.onOpen(contextRowId()))
                    }
                  />
                  <Show
                    when={
                      props.canEdit &&
                      renameField() &&
                      contextTarget()?.columnId !== renameField()?.id
                    }
                  >
                    <MenuItem
                      closeOnSelect
                      icon={PencilIcon}
                      text="Rename"
                      onClick={() =>
                        deferAction(() =>
                          control(contextRowId(), renameField()!.id)?.edit()
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
                          void props.onDuplicate?.(contextRowId());
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
                          props.onRequestDelete?.(contextRowId())
                        )
                      }
                    />
                  </Show>
                </Show>
              </ContextMenuContent>
            </ContextMenu.Portal>
          </ContextMenu>
          <Show when={rows().length === 0}>{props.emptyState}</Show>
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
            <For each={columns()}>
              {() => <div class="border-r border-edge-muted/40" />}
            </For>
            <Show when={hasAddColumn()}>
              <div />
            </Show>
          </div>
          <DatabaseTableSummary
            columns={columns()}
            rows={summaryRows()}
            hasMoreRows={props.hasMoreRows}
            template={template()}
            addColumn={hasAddColumn()}
          />
          <Show when={columnReorder.drop()}>
            {(drop) => (
              <InsertionLine
                drop={drop()}
                class="inset-y-0"
                data-column-drop-indicator
              />
            )}
          </Show>
        </div>
      </div>
      <DragOverlay
        class="pointer-events-none select-none bg-panel shadow-md"
        style={{ 'z-index': 1000 }}
      >
        {columnReorder.preview()}
      </DragOverlay>
    </DragDropProvider>
  );
}

/** Same color for the same viewer on every client's grid. */
function presenceColor(userId: string) {
  return `var(--color-${getHashedPaletteColor(userId)}, var(--color-pink))`;
}

type PresenceEdges = {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
};

function presenceOutline(
  user: DatabaseCellPresence | undefined,
  edges: PresenceEdges = { top: true, right: true, bottom: true, left: true }
): JSX.CSSProperties | undefined {
  if (!user) return undefined;
  const color = presenceColor(user.peerId ?? user.userId);
  const border = `2px ${user.editing ? 'dashed' : 'solid'} ${color}`;
  return {
    'background-color': `color-mix(in srgb, ${color} 8%, transparent)`,
    'border-top': edges.top ? border : undefined,
    'border-right': edges.right ? border : undefined,
    'border-bottom': edges.bottom ? border : undefined,
    'border-left': edges.left ? border : undefined,
  };
}

/** First name when known, else the email name before its first separator. */
function presenceName(userId: string) {
  const macroId = tryMacroId(userId);
  const { firstName, lastName } = getDisplayNameParts(macroId);
  if (firstName) return firstName;
  const email = macroId ? macroIdToEmail(macroId) : userId;
  const name = email.split('@')[0]?.split(/[._+-]/)[0];
  return name
    ? name[0].toUpperCase() + name.slice(1)
    : getInitials(firstName, lastName, email);
}

function PresenceTag(props: { user: DatabaseCellPresence; below?: boolean }) {
  const label = () =>
    `${presenceName(props.user.userId)} is ${props.user.editing ? 'editing' : 'here'}`;
  return (
    <span
      role="note"
      aria-label={label()}
      title={label()}
      class="max-w-40 truncate px-1.5 py-0.5 text-[11px] font-medium leading-4 text-surface shadow-sm"
      classList={{ 'rounded-t-sm': !props.below, 'rounded-b-sm': props.below }}
      style={{
        'background-color': presenceColor(
          props.user.peerId ?? props.user.userId
        ),
      }}
    >
      {presenceName(props.user.userId)}
    </span>
  );
}

function DraggableColumnHeader(
  props: DatabaseColumnHeaderProps & {
    canDrag: boolean;
    onDragStart: (event: MouseEvent) => void;
  }
) {
  const item = createReorderItem(props.column.id, {
    canDrag: () => props.canDrag,
    ignore: 'button, input',
    start: (event) => props.onDragStart(event),
  });
  return (
    <DatabaseColumnHeader
      {...props}
      headerRef={item.ref}
      dragHandle={props.canDrag ? { onMouseDown: item.onMouseDown } : undefined}
      dragging={item.dragging()}
    />
  );
}
