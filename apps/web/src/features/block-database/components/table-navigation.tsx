import { ContextMenuContent, MenuItem } from '@core/component/ContextMenu';
import { ContextMenu } from '@kobalte/core/context-menu';
import { Tabs } from '@kobalte/core/tabs';
import PlusIcon from '@phosphor/plus.svg';
import TableIcon from '@phosphor/table.svg';
import { Key } from '@solid-primitives/keyed';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import { Button } from '@ui/components/Button';
import { Tooltip } from '@ui/components/Tooltip';
import { createEffect, createSignal, createUniqueId, on, Show } from 'solid-js';
import { isDatabaseNameTaken } from '../core/property-creation';
import type { CreateTable } from '../core/table-creation';
import { CreateTableDialog } from './create-table-dialog';

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
  ) => Promise<void>;
}) {
  const [open, setOpen] = createSignal(false);
  const [tabRail, setTabRail] = createSignal<HTMLDivElement>();
  const [renaming, setRenaming] = createSignal<{
    id: string;
    name: string;
    width: string;
    origin?: HTMLElement;
  }>();
  const [renameDraft, setRenameDraft] = createSignal('');
  const [renamePending, setRenamePending] = createSignal(false);
  const [renameError, setRenameError] = createSignal('');
  const renameErrorId = createUniqueId();
  const [menuTarget, setMenuTarget] = createSignal<{
    table: { id: string; name: string };
    origin: HTMLElement;
  }>();
  let menuTrigger: HTMLSpanElement | undefined;
  let renameInput: HTMLInputElement | undefined;
  let createButton: HTMLButtonElement | undefined;
  const canRename = () => props.canCreate && !!props.onRename;
  const rename = (
    table: { id: string; name: string },
    origin?: HTMLElement
  ) => {
    if (!canRename() || renamePending()) return;
    setRenameDraft(table.name);
    setRenameError('');
    const width = origin?.getBoundingClientRect().width;
    setRenaming({
      id: table.id,
      name: table.name,
      width: width
        ? `${width}px`
        : `${Math.max(10, Math.min(24, table.name.length + 5))}ch`,
      origin,
    });
    queueMicrotask(() => {
      renameInput?.focus();
      renameInput?.select();
    });
  };
  const finishRename = (restoreFocus: boolean) => {
    const origin = renaming()?.origin;
    setRenaming(undefined);
    setRenameError('');
    if (restoreFocus) queueMicrotask(() => origin?.focus());
  };
  const saveRename = async (restoreFocus: boolean) => {
    const target = renaming();
    if (!target || renamePending() || !props.onRename) return;
    const name = renameDraft().trim();
    if (!name) {
      setRenameError('Enter a table name.');
      return;
    }
    if (
      isDatabaseNameTaken(
        name,
        props.tables
          .filter((table) => table.id !== target.id)
          .map((table) => table.name)
      )
    ) {
      setRenameError(
        'A table with this name already exists. Try another name.'
      );
      return;
    }
    if (name === target.name) {
      finishRename(restoreFocus);
      return;
    }
    setRenamePending(true);
    setRenameError('');
    try {
      await props.onRename(target.id, name, target.name);
      finishRename(restoreFocus);
    } catch (error) {
      setRenameError(
        error instanceof Error
          ? error.message
          : 'Could not rename this table. Try again.'
      );
    } finally {
      setRenamePending(false);
    }
  };
  const openMenu = (
    table: { id: string; name: string },
    origin: HTMLElement,
    x: number,
    y: number
  ) => {
    if (!canRename()) return;
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
          <Tabs
            value={props.activeTableId ?? ''}
            onChange={props.onSelect}
            activationMode="manual"
            class="min-w-0"
          >
            <Tabs.List
              ref={setTabRail}
              aria-label="Database tables"
              class="flex min-h-8 items-center gap-0.5 overflow-x-auto"
            >
              <Key each={props.tables} by="id">
                {(table) => (
                  <div
                    class="flex shrink-0 items-center"
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
                        aria-haspopup={canRename() ? 'menu' : undefined}
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
                          if (!canRename()) return;
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
                          if (!canRename()) return;
                          if (event.key === 'F2') {
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
                        aria-invalid={!!renameError()}
                        aria-describedby={
                          renameError() ? renameErrorId : undefined
                        }
                        aria-busy={renamePending()}
                        maxlength={200}
                        value={renameDraft()}
                        readOnly={renamePending()}
                        onFocusIn={(event) => event.stopPropagation()}
                        onMouseDown={(event) => event.stopPropagation()}
                        class="h-8 w-full min-w-0 rounded-md border border-ink/40 bg-input px-2 text-xs text-ink outline-none"
                        onInput={(event) => {
                          setRenameDraft(event.currentTarget.value);
                          setRenameError('');
                        }}
                        onBlur={(event) => {
                          event.stopPropagation();
                          void saveRename(false);
                        }}
                        onKeyDown={(event) => {
                          event.stopPropagation();
                          if (event.isComposing || event.keyCode === 229)
                            return;
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void saveRename(true);
                          } else if (event.key === 'Escape') {
                            event.preventDefault();
                            if (!renamePending()) finishRename(true);
                          }
                        }}
                      />
                    </Show>
                  </div>
                )}
              </Key>
            </Tabs.List>
          </Tabs>
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
      <Show when={renameError()}>
        <p id={renameErrorId} role="alert" class="mt-1 text-xs text-failure">
          {renameError()}
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
        </ContextMenuContent>
      </ContextMenu.Portal>
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
