import {
  ContextMenuContent,
  MenuItem,
  MenuSeparator,
} from '@core/component/ContextMenu';
import { ContextMenu } from '@kobalte/core/context-menu';
import { Popover } from '@kobalte/core/popover';
import ArrowDownIcon from '@phosphor/arrow-down.svg';
import ArrowLeftIcon from '@phosphor/arrow-left.svg';
import ArrowRightIcon from '@phosphor/arrow-right.svg';
import ArrowUpIcon from '@phosphor/arrow-up.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import ColumnsPlusLeftIcon from '@phosphor/columns-plus-left.svg';
import ColumnsPlusRightIcon from '@phosphor/columns-plus-right.svg';
import ListBulletsIcon from '@phosphor/list-bullets.svg';
import PencilIcon from '@phosphor/pencil-simple.svg';
import TrashIcon from '@phosphor/trash.svg';
import XIcon from '@phosphor/x.svg';
import { Key } from '@solid-primitives/keyed';
import { ConfirmDialog } from '@ui/components/ConfirmDialog';
import { DeleteDialog } from '@ui/components/DeleteDialog';
import { Dropdown } from '@ui/components/Dropdown';
import type { JSX } from 'solid-js';
import { createSignal, createUniqueId, For, onCleanup, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { useColumnUsage } from '../context/column-usage';
import { useOptionEditing } from '../context/option-editing';
import {
  columnSchemaMessage,
  type DatabaseColumnCastsSource,
  type DatabaseColumnConversion,
  type DatabaseColumnTypeChange,
  type DatabaseSchemaChange,
} from '../core/column-schema';
import { type DatabaseViewColumn, isOptionColumn } from '../core/database-view';
import { columnDeleteNote } from '../core/forms-usage';
import {
  ColumnTypeMenu,
  type DatabaseColumnConversionChoice,
} from './column-type-menu';
import { createInlineRename } from './inline-rename';
import { OptionEditor } from './option-editor';
import { PropertyIcon } from './property-icon';
import { OptionPill } from './select-pill';

export type DatabaseColumnHeaderProps = {
  column: DatabaseViewColumn;
  registerRename?: (rename: (() => void) | undefined) => void;
  onChangeType?: (
    columnId: string,
    change: DatabaseColumnTypeChange
  ) => DatabaseSchemaChange;
  /** Add a column of another type beside this one, with the values that convert. */
  onConvert?: (
    columnId: string,
    conversion: DatabaseColumnConversion
  ) => DatabaseSchemaChange<string>;
  onDelete?: (columnId: string) => DatabaseSchemaChange;
  relationTables?: { id: string; name: string }[];
  /** The type menu's dry run; without it every type is offered as is. */
  columnCasts?: DatabaseColumnCastsSource;
  dragHandle?: JSX.HTMLAttributes<HTMLDivElement>;
  headerRef?: (element: HTMLDivElement) => void;
  dragging?: boolean;
  sortDirection?: 'asc' | 'desc';
  canRename?: boolean;
  onRename?: (
    columnId: string,
    name: string,
    previousName: string
  ) => DatabaseSchemaChange;
  onSort: (columnId: string, direction: 'asc' | 'desc' | null) => void;
  onMove?: (columnId: string, direction: 'left' | 'right') => void;
  /** Add a new column beside this one. */
  onInsert?: (columnId: string, side: 'left' | 'right') => void;
  canMoveLeft?: boolean;
  canMoveRight?: boolean;
  /** Drawn on the header's right edge. */
  resizeHandle?: JSX.Element;
};

/** Header interactions stay local; the host supplies the persisted rename. */
export function DatabaseColumnHeader(props: DatabaseColumnHeaderProps) {
  const columnUsage = useColumnUsage();
  const [operating, setOperating] = createSignal(false);
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [deleteOpen, setDeleteOpen] = createSignal(false);
  const [converting, setConverting] =
    createSignal<DatabaseColumnConversionChoice>();
  const [optionsOpen, setOptionsOpen] = createSignal(false);
  /** The options open once the menu has closed, instead of the menu giving focus back. */
  let optionsRequested = false;
  const openRequestedOptions = (event: Event) => {
    if (!optionsRequested) return;
    optionsRequested = false;
    event.preventDefault();
    setOptionsOpen(true);
  };
  const editing = useOptionEditing();
  const errorId = createUniqueId();
  let header!: HTMLDivElement;
  let input: HTMLInputElement | undefined;
  let mounted = true;
  onCleanup(() => {
    mounted = false;
    props.registerRename?.(undefined);
  });
  const canRename = () => !!props.canRename && !!props.onRename;
  const focusHeader = () => header?.isConnected && header.focus();
  const restoreFocus = () => queueMicrotask(focusHeader);
  const columnRename = createInlineRename({
    name: (target: { id: string; name: string }) => target.name,
    rename: (target, name) => {
      if (!props.onRename) throw new Error('Renaming a column needs onRename');
      return props.onRename(target.id, name, target.name);
    },
    failureMessage: columnSchemaMessage,
    emptyName: { message: 'Enter a column name.', onBlur: 'cancel' },
    input: () => input,
    restoreFocus: focusHeader,
  });
  const error = columnRename.error;
  const setError = columnRename.setError;
  const pending = () => operating() || columnRename.pending();
  const rename = () => {
    if (!canRename() || pending()) return;
    setMenuOpen(false);
    columnRename.begin({ id: props.column.id, name: props.column.name });
  };
  const save = (restoreFocus: boolean) => {
    if (canRename()) void columnRename.save(restoreFocus);
  };
  props.registerRename?.(rename);
  async function changeType(change: DatabaseColumnTypeChange) {
    if (!canRename() || !props.onChangeType || pending()) return;
    setMenuOpen(false);
    setError('');
    setOperating(true);
    const changed = await props.onChangeType(props.column.id, change);
    if (!mounted) return;
    setOperating(false);
    if (changed.isErr()) setError(columnSchemaMessage(changed.error));
  }
  async function convert(choice: DatabaseColumnConversionChoice) {
    if (!canRename() || !props.onConvert || pending()) return;
    setError('');
    setOperating(true);
    const converted = await props.onConvert(props.column.id, {
      to: choice.to,
      label: choice.label,
      columnName: props.column.name,
    });
    if (!mounted) return;
    setOperating(false);
    setConverting(undefined);
    if (converted.isErr()) setError(columnSchemaMessage(converted.error));
  }
  async function remove() {
    if (!canRename() || !props.onDelete || pending()) return;
    setError('');
    setOperating(true);
    const deleted = await props.onDelete(props.column.id);
    if (!mounted) return;
    setOperating(false);
    deleted.match(
      () => setDeleteOpen(false),
      (errors) => setError(columnSchemaMessage(errors))
    );
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
    ...(canRename() && props.onInsert
      ? [
          {
            label: 'Insert left',
            icon: ColumnsPlusLeftIcon,
            group: 'edit',
            run: () => props.onInsert?.(props.column.id, 'left'),
          },
          {
            label: 'Insert right',
            icon: ColumnsPlusRightIcon,
            group: 'edit',
            run: () => props.onInsert?.(props.column.id, 'right'),
          },
        ]
      : []),
    ...(canRename() && editing && isOptionColumn(props.column)
      ? [
          {
            label: 'Edit options',
            icon: ListBulletsIcon,
            group: 'edit',
            run: () => {
              optionsRequested = true;
            },
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
    ...(canRename() && props.onDelete
      ? [
          {
            label: 'Delete column',
            icon: TrashIcon,
            group: 'delete',
            disabled: props.column.protections?.includes('delete') ?? false,
            run: () => {
              if (props.column.protections?.includes('delete')) return;
              setError('');
              columnUsage?.prepare();
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
          aria-sort={match(props.sortDirection)
            .with('asc', () => 'ascending' as const)
            .with('desc', () => 'descending' as const)
            .with(undefined, () => 'none' as const)
            .exhaustive()}
          aria-keyshortcuts={canRename() ? 'F2 Shift+F10' : 'Shift+F10'}
          tabIndex={columnRename.target() ? -1 : 0}
          disabled={!!columnRename.target()}
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
            when={columnRename.target()}
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
                      if (columnRename.target()) event.preventDefault();
                      openRequestedOptions(event);
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
                            <Show
                              when={
                                group === 'delete' &&
                                props.column.protections?.includes('delete')
                              }
                            >
                              <Dropdown.Item disabled>
                                Protected column — required by its feature
                              </Dropdown.Item>
                            </Show>
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
                                loadCasts={(open) =>
                                  props.columnCasts?.(props.column.id, open)
                                }
                                onChange={(change) => void changeType(change)}
                                onConvertToNewColumn={
                                  props.onConvert &&
                                  ((choice) => {
                                    setMenuOpen(false);
                                    setError('');
                                    setConverting(choice);
                                  })
                                }
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
                value={columnRename.draft()}
                readOnly={pending()}
                class="-mx-1.5 h-7 min-w-0 flex-1 rounded-md border border-ink/40 bg-input px-1.5 text-xs font-medium text-ink outline-none aria-invalid:border-failure-ink"
                onInput={(event) =>
                  columnRename.setDraft(event.currentTarget.value)
                }
                onBlur={() => save(false)}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.isComposing || event.keyCode === 229) return;
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    save(true);
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    columnRename.cancel(true);
                  }
                }}
              />
            </div>
          </Show>
          {props.resizeHandle}
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
              if (columnRename.target()) event.preventDefault();
              openRequestedOptions(event);
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
      <Show when={editing}>
        {(optionEditing) => (
          <Popover
            open={optionsOpen()}
            onOpenChange={setOptionsOpen}
            anchorRef={() => header}
            placement="bottom-start"
            gutter={4}
          >
            <Popover.Portal>
              <Popover.Content
                aria-label={`${props.column.name} options`}
                // Opened as the column menu closes, so focus is still settling.
                onFocusOutside={(event) => event.preventDefault()}
                onCloseAutoFocus={(event) => {
                  event.preventDefault();
                  restoreFocus();
                }}
                class="z-action-menu flex w-60 flex-col gap-1 rounded-lg border border-edge bg-menu p-2 text-xs text-ink shadow-menu outline-none"
              >
                <Popover.Title class="px-1 pb-1 font-medium">
                  Options
                </Popover.Title>
                <Key each={props.column.options} by="id">
                  {(option) => (
                    <div class="flex h-7 items-center gap-1.5 rounded px-1 hover:bg-hover">
                      <span class="min-w-0 flex-1">
                        <OptionPill
                          label={option().label}
                          color={option().color}
                          tag={props.column.dataType === 'TAG'}
                        />
                      </span>
                      <OptionEditor
                        column={props.column}
                        option={option()}
                        editing={optionEditing()}
                      />
                    </div>
                  )}
                </Key>
                <Show when={!props.column.options.length}>
                  <p class="px-1 text-ink-placeholder">No options yet</p>
                </Show>
                <Show when={props.column.sharedOutsideDatabase}>
                  <p class="px-1 pt-1 text-ink-muted">
                    Changes everywhere this property is used.
                  </p>
                </Show>
              </Popover.Content>
            </Popover.Portal>
          </Popover>
        )}
      </Show>
      <ConfirmDialog
        open={!!converting()}
        onOpenChange={(open) => {
          if (!open) setConverting(undefined);
        }}
        pending={pending()}
        title={`Convert “${props.column.name}” into a new column?`}
        confirmLabel="Convert into a new column"
        onConfirm={() => {
          const choice = converting();
          if (choice) void convert(choice);
        }}
        body={
          <>
            <p>
              {misfits(converting()?.cast.failures ?? 0)} {converting()?.label}.
              A new {converting()?.label} column will be added next to this one
              with the values that convert; “{props.column.name}” stays as it
              is.
            </p>
            <ul class="mt-2 list-disc pl-5">
              <For each={converting()?.cast.examples}>
                {(example) => <li>{example}</li>}
              </For>
            </ul>
          </>
        }
      />
      <DeleteDialog
        open={deleteOpen()}
        onOpenChange={setDeleteOpen}
        title="Delete column?"
        deleteLabel="Delete column"
        pending={pending()}
        onDelete={() => void remove()}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocus();
        }}
        body={
          <>
            <p>
              “{props.column.name}” and its values in this table will be
              deleted.
            </p>
            <Show
              when={
                columnUsage &&
                columnDeleteNote(columnUsage.usage(props.column.id))
              }
            >
              {(note) => <p class="mt-2">{note()}</p>}
            </Show>
            <Show when={error()}>
              <p role="alert" class="mt-2 text-failure-ink">
                {error()}
              </p>
            </Show>
          </>
        }
      />
    </>
  );
}

function misfits(failures: number): string {
  return failures === 1
    ? "1 value doesn't fit"
    : `${failures} values don't fit`;
}
