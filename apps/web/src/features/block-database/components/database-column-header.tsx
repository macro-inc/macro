import {
  ContextMenuContent,
  MenuItem,
  MenuSeparator,
} from '@core/component/ContextMenu';
import { ContextMenu } from '@kobalte/core/context-menu';
import { Dialog } from '@kobalte/core/dialog';
import ArrowDownIcon from '@phosphor/arrow-down.svg';
import ArrowLeftIcon from '@phosphor/arrow-left.svg';
import ArrowRightIcon from '@phosphor/arrow-right.svg';
import ArrowUpIcon from '@phosphor/arrow-up.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import EyeSlashIcon from '@phosphor/eye-slash.svg';
import PencilIcon from '@phosphor/pencil-simple.svg';
import TrashIcon from '@phosphor/trash.svg';
import XIcon from '@phosphor/x.svg';
import { Dropdown } from '@ui/components/Dropdown';
import type { JSX } from 'solid-js';
import { createSignal, createUniqueId, For, onCleanup, Show } from 'solid-js';
import type { DatabaseColumnTypeChange } from '../core/column-schema';
import type { DatabaseViewColumn } from '../core/database-view';
import { ColumnTypeMenu } from './column-type-menu';
import { PropertyIcon } from './property-icon';

export type DatabaseColumnHeaderProps = {
  column: DatabaseViewColumn;
  registerRename?: (rename: (() => void) | undefined) => void;
  onChangeType?: (
    columnId: string,
    change: DatabaseColumnTypeChange
  ) => Promise<void>;
  onDelete?: (columnId: string) => Promise<void>;
  relationTables?: { id: string; name: string }[];
  dragHandle?: JSX.HTMLAttributes<HTMLDivElement>;
  headerRef?: (element: HTMLDivElement) => void;
  dragging?: boolean;
  sortDirection?: 'asc' | 'desc';
  canRename?: boolean;
  onRename?: (
    columnId: string,
    name: string,
    previousName: string
  ) => Promise<void>;
  onSort: (columnId: string, direction: 'asc' | 'desc' | null) => void;
  onHide?: (columnId: string) => void;
  onMove?: (columnId: string, direction: 'left' | 'right') => void;
  canMoveLeft?: boolean;
  canMoveRight?: boolean;
};

/** Header interactions stay local; the host supplies the persisted rename. */
export function DatabaseColumnHeader(props: DatabaseColumnHeaderProps) {
  const [draft, setDraft] = createSignal<{
    id: string;
    name: string;
    previousName: string;
  }>();
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal('');
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [deleteOpen, setDeleteOpen] = createSignal(false);
  const errorId = createUniqueId();
  let header!: HTMLDivElement;
  let input: HTMLInputElement | undefined;
  let mounted = true;
  onCleanup(() => {
    mounted = false;
    props.registerRename?.(undefined);
  });
  const canRename = () => !!props.canRename && !!props.onRename;
  const restoreFocus = () =>
    queueMicrotask(() => header?.isConnected && header.focus());
  const rename = () => {
    if (!canRename() || pending()) return;
    setMenuOpen(false);
    setError('');
    setDraft({
      id: props.column.id,
      name: props.column.name,
      previousName: props.column.name,
    });
    queueMicrotask(() => {
      input?.focus();
      input?.select();
    });
  };
  const cancel = () => {
    if (pending()) return;
    setDraft(undefined);
    setError('');
    restoreFocus();
  };
  const save = async () => {
    const current = draft();
    const onRename = props.onRename;
    if (!current || pending() || !canRename() || !onRename) return;
    const name = current.name.trim();
    if (!name) {
      setError('Enter a column name.');
      return;
    }
    if (name === current.previousName) {
      cancel();
      return;
    }
    setPending(true);
    setError('');
    try {
      await onRename(current.id, name, current.previousName);
      if (!mounted) return;
      setDraft(undefined);
      restoreFocus();
    } catch (caught) {
      if (mounted)
        setError(
          caught instanceof Error
            ? caught.message
            : 'Could not rename this column. Try again.'
        );
    } finally {
      if (mounted) setPending(false);
    }
  };
  props.registerRename?.(rename);
  async function changeType(change: DatabaseColumnTypeChange) {
    if (!canRename() || !props.onChangeType || pending()) return;
    setMenuOpen(false);
    setError('');
    setPending(true);
    try {
      await props.onChangeType(props.column.id, change);
    } catch (caught) {
      if (mounted)
        setError(
          caught instanceof Error
            ? caught.message
            : 'Could not change column type.'
        );
    } finally {
      if (mounted) setPending(false);
    }
  }
  async function remove() {
    if (!canRename() || !props.onDelete || pending()) return;
    setError('');
    setPending(true);
    try {
      await props.onDelete(props.column.id);
      if (mounted) setDeleteOpen(false);
    } catch (caught) {
      if (mounted)
        setError(
          caught instanceof Error
            ? caught.message
            : 'Could not delete this column.'
        );
    } finally {
      if (mounted) setPending(false);
    }
  }
  const actions = () => [
    ...(canRename()
      ? [
          {
            label: 'Rename column',
            icon: PencilIcon,
            group: 'edit',
            run: rename,
          },
        ]
      : []),
    {
      label: 'Sort ascending',
      icon: ArrowUpIcon,
      group: 'view',
      run: () => props.onSort(props.column.id, 'asc'),
    },
    {
      label: 'Sort descending',
      icon: ArrowDownIcon,
      group: 'view',
      run: () => props.onSort(props.column.id, 'desc'),
    },
    ...(props.sortDirection
      ? [
          {
            label: 'Remove sort',
            icon: XIcon,
            group: 'view',
            run: () => props.onSort(props.column.id, null),
          },
        ]
      : []),
    ...(props.onMove
      ? [
          {
            label: 'Move left',
            icon: ArrowLeftIcon,
            group: 'view',
            disabled: !props.canMoveLeft,
            run: () => props.onMove?.(props.column.id, 'left'),
          },
          {
            label: 'Move right',
            icon: ArrowRightIcon,
            group: 'view',
            disabled: !props.canMoveRight,
            run: () => props.onMove?.(props.column.id, 'right'),
          },
        ]
      : []),
    ...(props.onHide
      ? [
          {
            label: 'Hide column',
            icon: EyeSlashIcon,
            group: 'view',
            run: () => props.onHide?.(props.column.id),
          },
        ]
      : []),
    ...(canRename() && props.onDelete
      ? [
          {
            label: 'Delete column',
            icon: TrashIcon,
            group: 'delete',
            run: () => {
              setError('');
              setDeleteOpen(true);
            },
          },
        ]
      : []),
  ];
  return (
    <>
      <ContextMenu>
        <ContextMenu.Trigger
          as="div"
          ref={(element: HTMLDivElement) => {
            header = element;
            props.headerRef?.(element);
          }}
          classList={{
            'opacity-40': props.dragging,
          }}
          role="columnheader"
          aria-label={props.column.name}
          aria-sort={
            props.sortDirection === 'asc'
              ? 'ascending'
              : props.sortDirection === 'desc'
                ? 'descending'
                : 'none'
          }
          aria-keyshortcuts={canRename() ? 'F2 Shift+F10' : 'Shift+F10'}
          tabIndex={draft() ? -1 : 0}
          disabled={!!draft()}
          class="relative min-w-0 border-r border-edge-muted/50 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink/50 [&_button:focus-visible]:ring-2 [&_button:focus-visible]:ring-ink/50"
          onDblClick={(
            event: MouseEvent & { currentTarget: HTMLDivElement }
          ) => {
            if (
              event.target instanceof HTMLElement &&
              event.target.closest('button, input')
            )
              return;
            event.preventDefault();
            rename();
          }}
          onKeyDown={(
            event: KeyboardEvent & { currentTarget: HTMLDivElement }
          ) => {
            if (event.target !== event.currentTarget) return;
            if (event.key === 'F2' && canRename()) {
              event.preventDefault();
              event.stopPropagation();
              rename();
            } else if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setMenuOpen(true);
            } else if (
              event.key === 'ContextMenu' ||
              (event.shiftKey && event.key === 'F10')
            ) {
              event.preventDefault();
              event.stopPropagation();
              const bounds = event.currentTarget.getBoundingClientRect();
              event.currentTarget.dispatchEvent(
                new MouseEvent('contextmenu', {
                  bubbles: true,
                  cancelable: true,
                  clientX: bounds.left,
                  clientY: bounds.bottom,
                })
              );
            }
          }}
        >
          <Show
            when={draft()}
            fallback={
              <div
                class="flex min-h-10 items-center gap-2 px-3 text-xs font-medium text-ink-muted"
                title={canRename() ? 'Double-click to rename' : undefined}
                {...props.dragHandle}
              >
                <PropertyIcon
                  relation={!!props.column.relation}
                  type={props.column.dataType}
                  entityType={props.column.specificEntityType}
                />
                <span class="min-w-0 flex-1 truncate">{props.column.name}</span>
                <Show when={props.sortDirection}>
                  <Show
                    when={props.sortDirection === 'asc'}
                    fallback={
                      <ArrowDownIcon class="size-3 shrink-0 text-accent" />
                    }
                  >
                    <ArrowUpIcon class="size-3 shrink-0 text-accent" />
                  </Show>
                </Show>
                <Dropdown open={menuOpen()} onOpenChange={setMenuOpen}>
                  <Dropdown.Trigger
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${props.column.name} column menu`}
                  >
                    <CaretDownIcon class="size-3" />
                  </Dropdown.Trigger>
                  <Dropdown.Content
                    class="min-w-44"
                    onCloseAutoFocus={(event) => {
                      if (draft()) event.preventDefault();
                    }}
                  >
                    <For each={['edit', 'view', 'delete']}>
                      {(group) => (
                        <Show
                          when={
                            actions().some(
                              (action) => action.group === group
                            ) ||
                            (group === 'edit' &&
                              props.onChangeType &&
                              canRename())
                          }
                        >
                          <Dropdown.Group>
                            <For
                              each={actions().filter(
                                (action) => action.group === group
                              )}
                            >
                              {(action) => (
                                <Dropdown.Item
                                  disabled={
                                    pending() ||
                                    ('disabled' in action && action.disabled)
                                  }
                                  onSelect={action.run}
                                  class={
                                    group === 'delete'
                                      ? 'text-failure-ink'
                                      : undefined
                                  }
                                >
                                  <action.icon class="size-3.5" />
                                  {action.label}
                                </Dropdown.Item>
                              )}
                            </For>
                            <Show
                              when={
                                group === 'edit' &&
                                props.onChangeType &&
                                canRename()
                              }
                            >
                              <ColumnTypeMenu
                                column={props.column}
                                tables={props.relationTables}
                                onChange={(change) => void changeType(change)}
                              />
                            </Show>
                          </Dropdown.Group>
                        </Show>
                      )}
                    </For>
                  </Dropdown.Content>
                </Dropdown>
              </div>
            }
          >
            {(current) => (
              <div
                class="flex min-h-10 items-center gap-2 px-3 text-xs text-ink-muted"
                aria-busy={pending()}
              >
                <PropertyIcon
                  relation={!!props.column.relation}
                  type={props.column.dataType}
                  entityType={props.column.specificEntityType}
                />
                <input
                  ref={input}
                  aria-label="Column name"
                  aria-invalid={!!error()}
                  aria-describedby={error() ? errorId : undefined}
                  maxlength={200}
                  value={current().name}
                  readOnly={pending()}
                  class="h-8 min-w-0 flex-1 rounded border border-ink/40 bg-input px-0 text-xs text-ink outline-none focus:ring-2 focus:ring-ink/20"
                  onInput={(event) => {
                    setDraft({ ...current(), name: event.currentTarget.value });
                    setError('');
                  }}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.isComposing || event.keyCode === 229) return;
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void save();
                    } else if (event.key === 'Escape') {
                      event.preventDefault();
                      cancel();
                    }
                  }}
                />
                <button
                  type="button"
                  aria-label={
                    error() ? 'Retry rename column' : 'Save column name'
                  }
                  disabled={pending()}
                  class="shrink-0 rounded p-1 text-accent hover:bg-hover disabled:opacity-40"
                  onClick={() => void save()}
                >
                  <CheckIcon class="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Cancel rename column"
                  disabled={pending()}
                  class="shrink-0 rounded p-1 text-ink-muted hover:bg-hover disabled:opacity-40"
                  onClick={cancel}
                >
                  <XIcon class="size-3.5" />
                </button>
              </div>
            )}
          </Show>
          <Show when={error() && !deleteOpen()}>
            <p
              id={errorId}
              role="alert"
              class="absolute top-full left-0 z-2 w-64 max-w-[calc(100vw-2rem)] rounded-md border border-failure-ink/20 bg-panel p-2 text-xs font-normal text-failure-ink shadow-md"
            >
              {error()}
            </p>
          </Show>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenuContent
            class="min-w-44"
            onCloseAutoFocus={(event) => {
              if (draft()) event.preventDefault();
            }}
          >
            <For each={actions()}>
              {(action, index) => (
                <>
                  <Show
                    when={
                      index() > 0 &&
                      action.group !== actions()[index() - 1].group
                    }
                  >
                    <MenuSeparator />
                  </Show>
                  <MenuItem
                    text={action.label}
                    icon={<action.icon class="size-3.5" />}
                    disabled={'disabled' in action && action.disabled}
                    onClick={action.run}
                    closeOnSelect
                  />
                </>
              )}
            </For>
          </ContextMenuContent>
        </ContextMenu.Portal>
      </ContextMenu>
      <Dialog
        open={deleteOpen()}
        onOpenChange={(open) => {
          if (!pending()) setDeleteOpen(open);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay class="fixed inset-0 z-modal bg-modal-overlay/30" />
          <Dialog.Content
            class="portal-scope fixed top-1/2 left-1/2 z-modal w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-edge-muted bg-panel p-5 text-ink shadow-xl outline-none"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              restoreFocus();
            }}
          >
            <Dialog.Title class="text-base font-semibold">
              Delete column?
            </Dialog.Title>
            <Dialog.Description class="mt-2 text-sm text-ink-muted">
              “{props.column.name}” and its values in this table will be
              deleted.
            </Dialog.Description>
            <Show when={error()}>
              <p role="alert" class="mt-3 text-xs text-failure-ink">
                {error()}
              </p>
            </Show>
            <div class="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={pending()}
                class="rounded-md px-3 py-1.5 text-sm hover:bg-hover disabled:opacity-50"
                onClick={() => setDeleteOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={pending()}
                class="rounded-md bg-failure/10 px-3 py-1.5 text-sm font-medium text-failure-ink disabled:opacity-50"
                onClick={() => void remove()}
              >
                {pending() ? 'Deleting…' : 'Delete column'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>
    </>
  );
}
