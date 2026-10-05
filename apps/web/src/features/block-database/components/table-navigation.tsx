import {
  ContextMenuContent,
  MenuItem,
  MenuSeparator,
} from '@core/component/ContextMenu';
import { ContextMenu } from '@kobalte/core/context-menu';
import { Tabs } from '@kobalte/core/tabs';
import ArrowLeftIcon from '@phosphor/arrow-left.svg';
import ArrowRightIcon from '@phosphor/arrow-right.svg';
import PlusIcon from '@phosphor/plus.svg';
import TableIcon from '@phosphor/table.svg';
import TrashIcon from '@phosphor/trash.svg';
import { Key } from '@solid-primitives/keyed';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import { DragDropProvider, DragOverlay } from '@thisbeyond/solid-dnd';
import { Button } from '@ui/components/Button';
import { DeleteDialog } from '@ui/components/DeleteDialog';
import { Tooltip } from '@ui/components/Tooltip';
import {
  createEffect,
  createSignal,
  createUniqueId,
  type JSX,
  on,
  Show,
} from 'solid-js';
import { createHorizontalReorder } from '../../../components/drag-drop/create-horizontal-reorder';
import { createReorderItem } from '../../../components/drag-drop/create-reorder';
import { DragSessionSensors } from '../../../components/drag-drop/drag-session-sensors';
import { InsertionLine } from '../../../components/drag-drop/insertion-line';
import {
  type DatabaseSchemaChange,
  tableRenameMessage,
} from '../core/column-schema';
import { isDatabaseNameTaken } from '../core/property-creation';
import type { CreateTable } from '../core/table-creation';
import { CreateTableDialog } from './create-table-dialog';
import { createInlineRename } from './inline-rename';

export function TableNavigation(props: {
  tables: { id: string; name: string }[];
  activeTableId: string | undefined;
  canCreate: boolean;
  onSelect: (tableId: string) => void;
  onCreate: CreateTable;
  onRename?: (
    tableId: string,
    name: string,
    previousName: string
  ) => DatabaseSchemaChange;
  /** Persist a new tab order: every table id, left to right. */
  onReorder?: (tableIds: string[]) => void;
  /** Delete a table the viewer confirmed; never offered for a database's only table. */
  onDelete?: (tableId: string) => void;
  /** What else deleting a table removes, e.g. the forms writing to it. */
  deleteConsequence?: (tableId: string) => string | undefined;
}) {
  const [deleting, setDeleting] = createSignal<{ id: string; name: string }>();
  const [open, setOpen] = createSignal(false);
  const [tabRail, setTabRail] = createSignal<HTMLDivElement>();
  const renameErrorId = createUniqueId();
  const [menuTarget, setMenuTarget] = createSignal<{
    table: { id: string; name: string };
    origin: HTMLElement;
  }>();
  let menuTrigger: HTMLSpanElement | undefined;
  let renameInput: HTMLInputElement | undefined;
  let createButton: HTMLButtonElement | undefined;
  const canRename = () => props.canCreate && !!props.onRename;
  const canReorder = () =>
    props.canCreate && !!props.onReorder && props.tables.length > 1;
  const canDelete = () =>
    props.canCreate && !!props.onDelete && props.tables.length > 1;
  const moveTable = (
    tableId: string,
    targetId: string,
    edge: 'before' | 'after'
  ) => {
    const order = props.tables.map((table) => table.id);
    const remaining = order.filter((id) => id !== tableId);
    const target = remaining.indexOf(targetId);
    if (!order.includes(tableId) || target < 0) return;
    remaining.splice(target + Number(edge === 'after'), 0, tableId);
    if (remaining.join() === order.join()) return;
    props.onReorder?.(remaining);
  };
  const tabReorder = createHorizontalReorder({
    order: () => props.tables.map((table) => table.id),
    getViewport: tabRail,
    enabled: canReorder,
    verticalSlack: DROP_SLACK_PX,
    previewMarker: 'data-tab-drag-preview',
    indicatorLeft: (boundary, rail) =>
      boundary - rail.getBoundingClientRect().left + rail.scrollLeft,
    onDrop: moveTable,
  });
  const neighbour = (tableId: string | undefined, direction: -1 | 1) => {
    const index = props.tables.findIndex((table) => table.id === tableId);
    return index < 0 ? undefined : props.tables[index + direction];
  };
  const moveBy = (tableId: string, direction: -1 | 1) => {
    const target = neighbour(tableId, direction);
    if (target)
      moveTable(tableId, target.id, direction < 0 ? 'before' : 'after');
  };
  const tableRename = createInlineRename({
    name: (target: RenamingTable) => target.name,
    rename: (target, name) => {
      if (!props.onRename) throw new Error('Renaming a table needs onRename');
      return props.onRename(target.id, name, target.name);
    },
    failureMessage: tableRenameMessage,
    emptyName: { message: 'Enter a table name.', onBlur: 'keep-editing' },
    validate: (name, target) =>
      isDatabaseNameTaken(
        name,
        props.tables
          .filter((table) => table.id !== target.id)
          .map((table) => table.name)
      )
        ? 'A table with this name already exists. Try another name.'
        : undefined,
    input: () => renameInput,
    restoreFocus: (target) => target.origin?.focus(),
  });
  const renaming = tableRename.target;
  const rename = (
    table: { id: string; name: string },
    origin?: HTMLElement
  ) => {
    if (!canRename()) return;
    const width = origin?.getBoundingClientRect().width;
    tableRename.begin({
      id: table.id,
      name: table.name,
      width: width
        ? `${width}px`
        : `${Math.max(10, Math.min(24, table.name.length + 5))}ch`,
      origin,
    });
  };
  const openMenu = (
    table: { id: string; name: string },
    origin: HTMLElement,
    x: number,
    y: number
  ) => {
    if (!canRename() && !canReorder()) return;
    setMenuTarget({ table: { ...table }, origin });
    menuTrigger?.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
      })
    );
  };
  const revealSelectedTable = () => {
    const rail = tabRail();
    const selected =
      rail?.querySelector<HTMLElement>('input[aria-label="Table name"]') ??
      rail?.querySelector<HTMLElement>('[data-selected]');
    if (!rail || !selected) return;
    const viewport = rail.getBoundingClientRect();
    const tab = selected.getBoundingClientRect();
    if (tab.left < viewport.left) rail.scrollLeft += tab.left - viewport.left;
    else if (tab.right > viewport.right)
      rail.scrollLeft += tab.right - viewport.right;
  };
  createResizeObserver(tabRail, revealSelectedTable);
  createEffect(
    on(
      [
        () => props.activeTableId,
        () => props.tables,
        () => renaming()?.id,
        tabRail,
      ],
      () => {
        // Kobalte applies the selected attribute while rendering the tab list.
        queueMicrotask(revealSelectedTable);
      }
    )
  );
  // Keep the menu outside Tabs because both primitives own a DOM collection.
  return (
    <ContextMenu>
      <ContextMenu.Trigger
        as="span"
        ref={menuTrigger}
        class="hidden"
        aria-hidden="true"
      />
      <div class="flex min-w-0 items-center gap-1.5">
        <span class="sr-only">Tables</span>
        <Show
          when={props.tables.length > 0}
          fallback={
            <span class="min-w-0 flex-1 text-xs text-ink-placeholder">
              No tables yet
            </span>
          }
        >
          <DragDropProvider
            collisionDetector={tabReorder.collisionDetector}
            onDragStart={tabReorder.onDragStart}
            onDragEnd={tabReorder.onDragEnd}
          >
            <DragSessionSensors
              getViewport={tabRail}
              axis="x"
              onCancel={tabReorder.cancel}
            />
            <Tabs
              value={props.activeTableId ?? ''}
              onChange={props.onSelect}
              activationMode="manual"
              class="min-w-0"
            >
              <Tabs.List
                ref={setTabRail}
                aria-label="Database tables"
                class="relative flex min-h-8 items-center gap-0.5 overflow-x-auto"
              >
                <Key each={props.tables} by="id">
                  {(table) => (
                    <DraggableTab
                      id={table().id}
                      canDrag={canReorder() && renaming()?.id !== table().id}
                      onDragStart={tabReorder.start}
                      style={{
                        width:
                          renaming()?.id === table().id
                            ? renaming()?.width
                            : undefined,
                      }}
                    >
                      <Tooltip label={table().name}>
                        <Tabs.Trigger
                          value={table().id}
                          aria-haspopup={
                            canRename() || canReorder() ? 'menu' : undefined
                          }
                          aria-keyshortcuts={
                            canRename() ? 'F2 Shift+F10' : undefined
                          }
                          onDblClick={(event) => {
                            if (!canRename()) return;
                            event.preventDefault();
                            event.stopPropagation();
                            rename(table(), event.currentTarget);
                          }}
                          onContextMenu={(event) => {
                            if (!canRename() && !canReorder()) return;
                            event.preventDefault();
                            event.stopPropagation();
                            openMenu(
                              table(),
                              event.currentTarget,
                              event.clientX,
                              event.clientY
                            );
                          }}
                          onKeyDown={(event) => {
                            if (!canRename() && !canReorder()) return;
                            if (event.key === 'F2' && canRename()) {
                              event.preventDefault();
                              event.stopPropagation();
                              rename(table(), event.currentTarget);
                            } else if (
                              event.key === 'ContextMenu' ||
                              (event.shiftKey && event.key === 'F10')
                            ) {
                              event.preventDefault();
                              event.stopPropagation();
                              const bounds =
                                event.currentTarget.getBoundingClientRect();
                              openMenu(
                                table(),
                                event.currentTarget,
                                bounds.left,
                                bounds.bottom
                              );
                            }
                          }}
                          class="relative flex h-8 max-w-40 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs text-ink-muted outline-none hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/50 data-selected:bg-hover data-selected:font-medium data-selected:text-ink"
                          classList={{ hidden: renaming()?.id === table().id }}
                        >
                          <TableIcon class="size-3.5 shrink-0" />
                          <span class="truncate">{table().name}</span>
                        </Tabs.Trigger>
                      </Tooltip>
                      <Show when={renaming()?.id === table().id}>
                        <input
                          ref={renameInput}
                          aria-label="Table name"
                          aria-invalid={!!tableRename.error()}
                          aria-describedby={
                            tableRename.error() ? renameErrorId : undefined
                          }
                          aria-busy={tableRename.pending()}
                          maxlength={200}
                          value={tableRename.draft()}
                          readOnly={tableRename.pending()}
                          onFocusIn={(event) => event.stopPropagation()}
                          onMouseDown={(event) => event.stopPropagation()}
                          class="h-8 w-full min-w-0 rounded-md border border-ink/40 bg-input px-2 text-xs text-ink outline-none"
                          onInput={(event) =>
                            tableRename.setDraft(event.currentTarget.value)
                          }
                          onBlur={(event) => {
                            event.stopPropagation();
                            void tableRename.save(false);
                          }}
                          onKeyDown={(event) => {
                            event.stopPropagation();
                            if (event.isComposing || event.keyCode === 229)
                              return;
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              void tableRename.save(true);
                            } else if (event.key === 'Escape') {
                              event.preventDefault();
                              tableRename.cancel(true);
                            }
                          }}
                        />
                      </Show>
                    </DraggableTab>
                  )}
                </Key>
                <Show when={tabReorder.drop()}>
                  {(drop) => (
                    <InsertionLine
                      drop={drop()}
                      class="inset-y-1"
                      data-tab-drop-indicator
                    />
                  )}
                </Show>
              </Tabs.List>
            </Tabs>
            <DragOverlay
              class="pointer-events-none select-none rounded-md bg-panel shadow-md"
              style={{ 'z-index': 1000 }}
            >
              {tabReorder.preview()}
            </DragOverlay>
          </DragDropProvider>
        </Show>
        <Show when={props.canCreate}>
          <Button
            ref={createButton}
            type="button"
            size="sm"
            variant={props.tables.length ? 'ghost' : 'strong'}
            class="shrink-0 gap-1.5 text-xs focus-visible:ring-2 focus-visible:ring-ink/50"
            onClick={() => setOpen(true)}
          >
            <PlusIcon class="size-3.5" />
            New table
          </Button>
        </Show>
      </div>
      <Show when={tableRename.error()}>
        <p id={renameErrorId} role="alert" class="mt-1 text-xs text-failure">
          {tableRename.error()}
        </p>
      </Show>
      <ContextMenu.Portal>
        <ContextMenuContent
          class="min-w-44"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (!renaming()) menuTarget()?.origin.focus();
          }}
        >
          <MenuItem
            text="Rename table"
            closeOnSelect
            shortcut="F2"
            disabled={!canRename()}
            onClick={() => {
              const target = menuTarget();
              if (target) rename(target.table, target.origin);
            }}
          />
          <Show when={props.onReorder}>
            <MenuSeparator />
            <MenuItem
              text="Move left"
              icon={ArrowLeftIcon}
              closeOnSelect
              disabled={!canReorder() || !neighbour(menuTarget()?.table.id, -1)}
              onClick={() => {
                const target = menuTarget();
                if (target) moveBy(target.table.id, -1);
              }}
            />
            <MenuItem
              text="Move right"
              icon={ArrowRightIcon}
              closeOnSelect
              disabled={!canReorder() || !neighbour(menuTarget()?.table.id, 1)}
              onClick={() => {
                const target = menuTarget();
                if (target) moveBy(target.table.id, 1);
              }}
            />
          </Show>
          <Show when={props.onDelete}>
            <MenuSeparator />
            <MenuItem
              text="Delete table"
              icon={TrashIcon}
              closeOnSelect
              disabled={!canDelete()}
              onClick={() => {
                const target = menuTarget();
                if (target && canDelete()) setDeleting({ ...target.table });
              }}
            />
          </Show>
        </ContextMenuContent>
      </ContextMenu.Portal>
      <DeleteDialog
        open={!!deleting()}
        onOpenChange={(open) => {
          if (!open) setDeleting(undefined);
        }}
        title="Delete table?"
        deleteLabel="Delete table"
        onDelete={() => {
          const target = deleting();
          setDeleting(undefined);
          if (target && canDelete()) props.onDelete?.(target.id);
        }}
        body={
          <>
            <p>
              “{deleting()?.name}” will be deleted for everyone, with its
              columns, records and views.
            </p>
            <Show
              when={(() => {
                const target = deleting();
                return target && props.deleteConsequence?.(target.id);
              })()}
            >
              {(consequence) => <p class="mt-2">{consequence()}</p>}
            </Show>
          </>
        }
      />
      <Show when={open()}>
        <CreateTableDialog
          existingNames={props.tables.map((table) => table.name)}
          onCreate={props.onCreate}
          onOpenTable={props.onSelect}
          onClose={() => setOpen(false)}
          returnFocus={createButton}
        />
      </Show>
    </ContextMenu>
  );
}

type RenamingTable = {
  id: string;
  name: string;
  /** The input keeps the tab's width, so the strip does not shift. */
  width: string;
  /** The tab that takes focus back once the rename is done. */
  origin?: HTMLElement;
};

/** How far above or below the tab strip a drag may stray and still drop. */
const DROP_SLACK_PX = 24;

function DraggableTab(props: {
  id: string;
  canDrag: boolean;
  onDragStart: (event: MouseEvent) => void;
  style: JSX.CSSProperties;
  children: JSX.Element;
}) {
  const item = createReorderItem(props.id, {
    canDrag: () => props.canDrag,
    ignore: 'input',
    start: (event) => props.onDragStart(event),
  });
  return (
    <div
      ref={item.ref}
      class="flex shrink-0 items-center"
      classList={{ 'opacity-40': item.dragging() }}
      style={props.style}
      onMouseDown={item.onMouseDown}
    >
      {props.children}
    </div>
  );
}
