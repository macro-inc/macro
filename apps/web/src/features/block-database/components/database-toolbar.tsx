import { ContextMenuContent, MenuItem } from '@core/component/ContextMenu';
import { deepEqual } from '@core/util/compareUtils';
import { ContextMenu } from '@kobalte/core/context-menu';
import DotsThreeIcon from '@phosphor/dots-three.svg';
import FunnelIcon from '@phosphor/funnel.svg';
import KanbanIcon from '@phosphor/kanban.svg';
import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import PlusIcon from '@phosphor/plus.svg';
import SlidersHorizontalIcon from '@phosphor/sliders-horizontal.svg';
import SortAscendingIcon from '@phosphor/sort-ascending.svg';
import TableIcon from '@phosphor/table.svg';
import XIcon from '@phosphor/x.svg';
import { Key } from '@solid-primitives/keyed';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import { Button } from '@ui/components/Button';
import { Dropdown } from '@ui/components/Dropdown';
import { Tooltip } from '@ui/components/Tooltip';
import {
  createEffect,
  createSignal,
  For,
  Index,
  type JSX,
  on,
  Show,
} from 'solid-js';
import {
  type DatabaseViewColumn,
  type DatabaseViewConfig,
  isBoardGroupColumn,
  orderDatabaseColumns,
  reconcileDatabaseView,
  type SavedDatabaseView,
} from '../core/database-view';
import { FilterPanel } from './database-view-filters';
import { SaveViewDialog } from './saved-view-dialog';
import { ToolbarPopover } from './view-control-popover';
import { ViewSelect } from './view-select';

export type DatabaseToolbarProps = {
  columns: DatabaseViewColumn[];
  value: DatabaseViewConfig;
  onChange: (view: DatabaseViewConfig) => void;
  savedViews: SavedDatabaseView[];
  selectedViewId?: string;
  saving?: boolean;
  isDirty?: boolean;
  onSelectView: (id?: string) => void;
  onSaveView: (
    name: string,
    layout: DatabaseViewConfig['layout'],
    groupBy?: string | null
  ) => Promise<void>;
  onUpdateView?: () => Promise<void>;
  onRenameView: (id: string, name: string) => Promise<void>;
  onDeleteView: (id: string) => Promise<void>;
  addColumn?: JSX.Element;
  onCreateRecord?: () => void;
  canCreateRecord?: boolean;
  creating?: boolean;
};

type ViewDialog = {
  returnFocus?: HTMLElement;
} & (
  | { mode: 'save'; name: string; layout: DatabaseViewConfig['layout'] }
  | { mode: 'delete'; target: SavedDatabaseView }
);

/** View controls contain no data fetching or mutation implementation. */
export function DatabaseToolbar(props: DatabaseToolbarProps) {
  const [renaming, setRenaming] = createSignal<{
    id: string;
    name: string;
    origin?: HTMLElement;
  }>();
  const [renameDraft, setRenameDraft] = createSignal('');
  const [renamePending, setRenamePending] = createSignal(false);
  const [renameError, setRenameError] = createSignal('');
  let renameInput: HTMLInputElement | undefined;
  function beginRename(
    target: SavedDatabaseView,
    origin?: HTMLElement,
    focus = true
  ) {
    if (renamePending()) return;
    setRenaming({ id: target.id, name: target.name, origin });
    setRenameDraft(target.name);
    setRenameError('');
    if (focus)
      queueMicrotask(() => {
        renameInput?.focus();
        renameInput?.select();
      });
  }
  function finishRename(restoreFocus: boolean) {
    const target = renaming()?.origin;
    setRenaming(undefined);
    setRenameError('');
    if (restoreFocus) queueMicrotask(() => target?.focus());
  }
  async function saveRename(restoreFocus: boolean) {
    const target = renaming();
    if (!target || renamePending()) return;
    const name = renameDraft().trim();
    if (!name) {
      setRenameError('Enter a view name.');
      return;
    }
    if (name === target.name) {
      finishRename(restoreFocus);
      return;
    }
    setRenamePending(true);
    setRenameError('');
    try {
      await props.onRenameView(target.id, name);
      finishRename(restoreFocus);
    } catch {
      setRenameError('Could not rename this view. Press Enter to retry.');
    } finally {
      setRenamePending(false);
    }
  }
  const [dialog, setDialog] = createSignal<ViewDialog>();
  const [updateError, setUpdateError] = createSignal(false);
  const [searchOpen, setSearchOpen] = createSignal(false);
  let searchButton: HTMLButtonElement | undefined;
  let searchInput: HTMLInputElement | undefined;
  const [viewRail, setViewRail] = createSignal<HTMLDivElement>();
  let viewOptionsButton: HTMLButtonElement | undefined;
  let allRecordsButton: HTMLButtonElement | undefined;
  const revealSelectedView = () => {
    const rail = viewRail();
    const selected = rail?.querySelector<HTMLElement>(
      'button[aria-pressed="true"]'
    );
    if (!rail || !selected) return;
    const viewport = rail.getBoundingClientRect();
    if (viewport.width > 0)
      rail.style.setProperty('--view-rail-width', `${viewport.width}px`);
    const tab = selected.getBoundingClientRect();
    if (tab.left < viewport.left) rail.scrollLeft += tab.left - viewport.left;
    else if (tab.right > viewport.right)
      rail.scrollLeft += tab.right - viewport.right;
  };
  createResizeObserver(viewRail, revealSelectedView);
  createEffect(
    on([() => props.selectedViewId, () => props.savedViews, viewRail], () =>
      queueMicrotask(revealSelectedView)
    )
  );
  const selected = () =>
    props.savedViews.find((view) => view.id === props.selectedViewId);
  const view = () => reconcileDatabaseView(props.value, props.columns);
  const openSaveDialog = (returnFocus?: HTMLElement) => {
    const layout = view().layout;
    setDialog({
      mode: 'save',
      name: layout === 'board' ? 'Board view' : 'Table view',
      layout,
      returnFocus,
    });
  };
  const openViewDialog = (
    mode: 'rename' | 'delete',
    target: SavedDatabaseView | undefined,
    returnFocus?: HTMLElement,
    focus = true
  ) => {
    if (!target) return;
    if (mode === 'rename') beginRename(target, returnFocus, focus);
    else setDialog({ mode, target: { ...target }, returnFocus });
  };
  const changed = () =>
    props.isDirty ??
    (!!selected() &&
      !deepEqual(
        reconcileDatabaseView(selected()!.view, props.columns),
        view()
      ));
  const change = (patch: Partial<DatabaseViewConfig>) =>
    props.onChange({ ...view(), ...patch });
  const groups = () => props.columns.filter(isBoardGroupColumn);
  const update = async () => {
    if (!props.onUpdateView) return;
    setUpdateError(false);
    try {
      await props.onUpdateView();
    } catch {
      setUpdateError(true);
    }
  };
  return (
    <div
      class="@container/view-toolbar shrink-0 border-b border-edge-muted bg-canvas-base [&_button:focus-visible]:ring-2 [&_button:focus-visible]:ring-ink/50"
      data-database-toolbar
    >
      <div class="flex items-center gap-2 px-3 py-1.5 @max-[520px]/view-toolbar:flex-wrap @min-[640px]/view-toolbar:px-4">
        <div class="flex min-w-0 flex-1 items-center gap-0.5 @max-[520px]/view-toolbar:basis-full">
          <span class="mr-1.5 shrink-0 text-[10px] text-ink-placeholder @max-[640px]/view-toolbar:sr-only">
            Views
          </span>
          <div
            ref={setViewRail}
            class="flex min-w-0 items-center gap-0.5 overflow-x-auto"
            aria-label="Saved views"
          >
            <button
              ref={allRecordsButton}
              type="button"
              aria-pressed={!props.selectedViewId}
              onClick={() => props.onSelectView()}
              style={{
                'max-width': 'min(10rem, var(--view-rail-width, 10rem))',
              }}
              class="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-ink-muted outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ink/50"
              classList={{
                'bg-hover font-medium text-ink': !props.selectedViewId,
              }}
            >
              <Show
                when={!props.selectedViewId && view().layout === 'board'}
                fallback={<TableIcon class="size-3.5" />}
              >
                <KanbanIcon class="size-3.5" />
              </Show>
              <span class="truncate">All records</span>
            </button>
            <Key each={props.savedViews} by="id">
              {(savedView) => {
                let tab: HTMLButtonElement | undefined;
                return (
                  <ContextMenu>
                    <Show when={renaming()?.id === savedView().id}>
                      <form
                        class="shrink-0"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void saveRename(true);
                        }}
                      >
                        <input
                          ref={renameInput}
                          aria-label="View name"
                          maxlength={100}
                          value={renameDraft()}
                          readOnly={renamePending()}
                          aria-invalid={!!renameError()}
                          class="h-8 w-36 rounded-md border border-ink/40 bg-input px-2 text-xs text-ink outline-none focus:ring-2 focus:ring-ink/10"
                          onInput={(event) => {
                            setRenameDraft(event.currentTarget.value);
                            setRenameError('');
                          }}
                          onBlur={() => {
                            if (!renameError()) void saveRename(false);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                              event.preventDefault();
                              event.stopPropagation();
                              if (!renamePending()) finishRename(true);
                            }
                          }}
                        />
                      </form>
                    </Show>
                    <Tooltip label={savedView().name} class="shrink-0">
                      <ContextMenu.Trigger
                        as="button"
                        ref={tab}
                        type="button"
                        hidden={renaming()?.id === savedView().id}
                        aria-pressed={props.selectedViewId === savedView().id}
                        aria-keyshortcuts="F2 Shift+F10"
                        onClick={() => props.onSelectView(savedView().id)}
                        onDblClick={(
                          event: MouseEvent & {
                            currentTarget: HTMLButtonElement;
                          }
                        ) => {
                          event.preventDefault();
                          event.stopPropagation();
                          openViewDialog(
                            'rename',
                            savedView(),
                            event.currentTarget
                          );
                        }}
                        onKeyDown={(
                          event: KeyboardEvent & {
                            currentTarget: HTMLButtonElement;
                          }
                        ) => {
                          if (event.key === 'F2') {
                            event.preventDefault();
                            event.stopPropagation();
                            openViewDialog(
                              'rename',
                              savedView(),
                              event.currentTarget
                            );
                          } else if (
                            event.key === 'ContextMenu' ||
                            (event.shiftKey && event.key === 'F10')
                          ) {
                            event.preventDefault();
                            event.stopPropagation();
                            const bounds =
                              event.currentTarget.getBoundingClientRect();
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
                        style={{
                          'max-width':
                            'min(10rem, var(--view-rail-width, 10rem))',
                          display:
                            renaming()?.id === savedView().id
                              ? 'none'
                              : undefined,
                        }}
                        class="flex h-8 max-w-40 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-ink-muted outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ink/50"
                        classList={{
                          'bg-hover font-medium text-ink':
                            props.selectedViewId === savedView().id,
                        }}
                      >
                        <Show
                          when={
                            (props.selectedViewId === savedView().id
                              ? view().layout
                              : savedView().view.layout) === 'board'
                          }
                          fallback={<TableIcon class="size-3.5 shrink-0" />}
                        >
                          <KanbanIcon class="size-3.5 shrink-0" />
                        </Show>
                        <span class="truncate">{savedView().name}</span>
                      </ContextMenu.Trigger>
                    </Tooltip>
                    <ContextMenu.Portal>
                      <ContextMenuContent
                        class="min-w-48"
                        onCloseAutoFocus={(event) => {
                          if (dialog() || renaming()) event.preventDefault();
                          if (renaming())
                            queueMicrotask(() => {
                              renameInput?.focus();
                              renameInput?.select();
                            });
                        }}
                      >
                        <MenuItem
                          text="Rename view"
                          closeOnSelect
                          shortcut="F2"
                          onClick={() =>
                            openViewDialog('rename', savedView(), tab, false)
                          }
                        />
                        <Show when={props.selectedViewId === savedView().id}>
                          <MenuItem
                            text="Save as new view"
                            closeOnSelect
                            onClick={() => openSaveDialog(tab)}
                          />
                        </Show>
                        <MenuItem
                          text="Delete view"
                          closeOnSelect
                          onClick={() =>
                            openViewDialog('delete', savedView(), tab)
                          }
                        />
                      </ContextMenuContent>
                    </ContextMenu.Portal>
                  </ContextMenu>
                );
              }}
            </Key>
          </div>
          <Show when={!changed()}>
            <Tooltip label="New view" class="shrink-0">
              <button
                type="button"
                aria-label="New view"
                onClick={(event) => openSaveDialog(event.currentTarget)}
                class="flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs text-ink-muted outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ink/50"
              >
                <PlusIcon class="size-3.5" />
              </button>
            </Tooltip>
          </Show>
          <Show when={changed() && !selected()}>
            <Button
              size="sm"
              variant="ghost"
              class="h-8 px-2 text-xs text-accent"
              aria-label="Save view"
              disabled={props.saving}
              onClick={(event) => openSaveDialog(event.currentTarget)}
            >
              Save<span class="@max-[720px]/view-toolbar:hidden"> view</span>
            </Button>
          </Show>
          <Show when={changed() && selected() && props.onUpdateView}>
            <Button
              size="sm"
              variant="ghost"
              class="h-8 px-2 text-xs text-accent"
              aria-label="Save changes"
              disabled={props.saving}
              onClick={() => void update()}
            >
              Save<span class="@max-[720px]/view-toolbar:hidden"> changes</span>
            </Button>
          </Show>
          <Show when={selected()}>
            <Dropdown>
              <Dropdown.Trigger
                as={Button}
                ref={viewOptionsButton}
                variant="ghost"
                size="icon-sm"
                aria-label="View options"
              >
                <DotsThreeIcon />
              </Dropdown.Trigger>
              <Dropdown.Content
                onCloseAutoFocus={(event) => {
                  if (dialog() || renaming()) event.preventDefault();
                  if (renaming())
                    queueMicrotask(() => {
                      renameInput?.focus();
                      renameInput?.select();
                    });
                }}
              >
                <Dropdown.Item
                  onSelect={() => openSaveDialog(viewOptionsButton)}
                >
                  Save as new view
                </Dropdown.Item>
                <Dropdown.Item
                  onSelect={() =>
                    openViewDialog(
                      'rename',
                      selected(),
                      viewOptionsButton,
                      false
                    )
                  }
                >
                  Rename view
                </Dropdown.Item>
                <Dropdown.Item
                  onSelect={() =>
                    openViewDialog('delete', selected(), viewOptionsButton)
                  }
                >
                  Delete view
                </Dropdown.Item>
              </Dropdown.Content>
            </Dropdown>
          </Show>
        </div>
        <div class="flex shrink-0 items-center gap-0.5 @max-[520px]/view-toolbar:w-full @max-[520px]/view-toolbar:justify-end">
          <div class="flex items-center gap-0.5">
            <ToolbarPopover
              label="Filter"
              compact
              count={view().filters.length}
              icon={<FunnelIcon class="size-3.5" />}
            >
              <FilterPanel
                columns={props.columns}
                filters={view().filters}
                onChange={(filters) => change({ filters })}
              />
            </ToolbarPopover>
            <ToolbarPopover
              label="Sort"
              compact
              count={view().sorts.length}
              icon={<SortAscendingIcon class="size-3.5" />}
            >
              <div class="w-76 max-w-full">
                <Show when={!view().sorts.length}>
                  <p class="mb-3 text-xs text-ink-muted">
                    Choose the order records appear in.
                  </p>
                </Show>
                <div class="flex flex-col gap-2">
                  <Index each={view().sorts}>
                    {(sort, index) => (
                      <div class="flex gap-1.5">
                        <ViewSelect
                          label="Sort property"
                          value={sort().columnId}
                          options={props.columns
                            .filter(
                              (column) =>
                                column.id === sort().columnId ||
                                !view().sorts.some(
                                  (item) => item.columnId === column.id
                                )
                            )
                            .map((column) => ({
                              value: column.id,
                              label: column.name,
                            }))}
                          onChange={(columnId) =>
                            change({
                              sorts: view().sorts.map((item, i) =>
                                i === index ? { ...item, columnId } : item
                              ),
                            })
                          }
                        />
                        <ViewSelect
                          label="Sort direction"
                          value={sort().direction}
                          class="w-28"
                          options={[
                            { value: 'asc', label: 'Ascending' },
                            { value: 'desc', label: 'Descending' },
                          ]}
                          onChange={(direction) =>
                            change({
                              sorts: view().sorts.map((item, i) =>
                                i === index
                                  ? {
                                      ...item,
                                      direction:
                                        direction === 'desc' ? 'desc' : 'asc',
                                    }
                                  : item
                              ),
                            })
                          }
                        />
                        <button
                          type="button"
                          aria-label="Remove sort"
                          onClick={() =>
                            change({
                              sorts: view().sorts.filter((_, i) => i !== index),
                            })
                          }
                          class="rounded-md p-1.5 text-ink-muted hover:bg-hover focus-visible:ring-2 focus-visible:ring-ink/50"
                        >
                          <XIcon class="size-3.5" />
                        </button>
                      </div>
                    )}
                  </Index>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  class="mt-3"
                  disabled={view().sorts.length >= props.columns.length}
                  onClick={() => {
                    const column = props.columns.find(
                      (item) =>
                        !view().sorts.some((sort) => sort.columnId === item.id)
                    );
                    if (column)
                      change({
                        sorts: [
                          ...view().sorts,
                          { columnId: column.id, direction: 'asc' },
                        ],
                      });
                  }}
                >
                  <PlusIcon class="size-3.5" /> Add sort
                </Button>
              </div>
            </ToolbarPopover>
            <Show
              when={searchOpen() || view().search}
              fallback={
                <button
                  ref={searchButton}
                  type="button"
                  aria-label="Search"
                  title="Search records"
                  onClick={() => setSearchOpen(true)}
                  class="flex size-8 shrink-0 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/50"
                >
                  <MagnifyingGlassIcon class="size-3.5" />
                </button>
              }
            >
              <div
                class="flex h-8 w-32 items-center gap-1 rounded-md border border-edge-muted bg-input px-2 focus-within:border-ink/50 @min-[640px]/view-toolbar:w-44"
                onFocusOut={(event) => {
                  if (
                    !event.currentTarget.contains(
                      event.relatedTarget as Node | null
                    ) &&
                    !view().search
                  )
                    setSearchOpen(false);
                }}
              >
                <MagnifyingGlassIcon class="size-3.5 shrink-0 text-ink-muted" />
                <input
                  ref={(element) => {
                    searchInput = element;
                    if (searchOpen()) queueMicrotask(() => element.focus());
                  }}
                  type="search"
                  aria-label="Search records"
                  placeholder="Search…"
                  value={view().search}
                  onInput={(event) =>
                    change({ search: event.currentTarget.value })
                  }
                  onKeyDown={(event) => {
                    if (event.key !== 'Escape') return;
                    event.preventDefault();
                    event.stopPropagation();
                    change({ search: '' });
                    setSearchOpen(false);
                    queueMicrotask(() => searchButton?.focus());
                  }}
                  class="min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-ink-placeholder [&::-webkit-search-cancel-button]:hidden"
                />
                <button
                  type="button"
                  aria-label={view().search ? 'Clear search' : 'Close search'}
                  onClick={() => {
                    if (view().search) {
                      setSearchOpen(true);
                      change({ search: '' });
                      searchInput?.focus();
                    } else {
                      setSearchOpen(false);
                      queueMicrotask(() => searchButton?.focus());
                    }
                  }}
                  class="flex size-5 shrink-0 items-center justify-center rounded text-ink-muted outline-none hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/50"
                >
                  <XIcon class="size-3" />
                </button>
              </div>
            </Show>
            <ToolbarPopover
              label="View settings"
              compact
              icon={<SlidersHorizontalIcon class="size-3.5" />}
            >
              <div class="w-64 max-w-full">
                <p class="mb-2 text-xs font-medium">Layout</p>
                <div
                  class="flex items-center gap-1 rounded-lg border border-edge-muted p-1"
                  aria-label="View layout"
                >
                  <button
                    type="button"
                    aria-pressed={view().layout === 'table'}
                    onClick={() => change({ layout: 'table' })}
                    class="flex h-9 flex-1 items-center justify-center gap-2 rounded-md text-xs text-ink-muted outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ink/50"
                    classList={{
                      'bg-hover font-medium text-ink':
                        view().layout === 'table',
                    }}
                  >
                    <TableIcon class="size-4" />
                    Table
                  </button>
                  <button
                    type="button"
                    aria-pressed={view().layout === 'board'}
                    onClick={() =>
                      change({
                        layout: 'board',
                        groupBy: view().groupBy ?? groups()[0]?.id ?? null,
                      })
                    }
                    class="flex h-9 flex-1 items-center justify-center gap-2 rounded-md text-xs text-ink-muted outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ink/50"
                    classList={{
                      'bg-hover font-medium text-ink':
                        view().layout === 'board',
                    }}
                  >
                    <KanbanIcon class="size-4" />
                    Board
                  </button>
                </div>
                <Show when={view().layout === 'board' && groups().length}>
                  <label class="mt-3 flex items-center justify-between gap-3 text-xs text-ink-muted">
                    Group by
                    <ViewSelect
                      label="Group board by"
                      value={view().groupBy ?? ''}
                      options={groups().map((column) => ({
                        value: column.id,
                        label: column.name,
                      }))}
                      onChange={(groupBy) =>
                        change({ groupBy, groupOrder: undefined })
                      }
                    />
                  </label>
                </Show>
              </div>
              <div class="mt-3 max-h-60 w-64 max-w-full overflow-auto border-t border-edge-muted pt-3">
                <p class="px-2 pb-2 text-xs font-medium text-ink">Columns</p>
                <For
                  each={orderDatabaseColumns(props.columns, view().columnOrder)}
                >
                  {(column) => (
                    <label class="flex items-center gap-2.5 rounded-lg px-2 py-2 text-xs hover:bg-hover">
                      <input
                        type="checkbox"
                        checked={!view().hiddenColumns.includes(column.id)}
                        onChange={(event) =>
                          change({
                            hiddenColumns: event.currentTarget.checked
                              ? view().hiddenColumns.filter(
                                  (id) => id !== column.id
                                )
                              : [...view().hiddenColumns, column.id],
                          })
                        }
                        class="size-3.5 accent-ink"
                      />
                      <span class="min-w-0 flex-1 truncate" title={column.name}>
                        {column.name}
                      </span>
                    </label>
                  )}
                </For>
                <Show when={!props.columns.length}>
                  <p class="text-xs text-ink-muted">
                    Add a column to get started.
                  </p>
                </Show>
              </div>
              <Show when={view().hiddenColumns.length}>
                <Button
                  size="sm"
                  variant="ghost"
                  class="mt-2"
                  onClick={() => change({ hiddenColumns: [] })}
                >
                  Show all columns
                </Button>
              </Show>
              <Show when={props.addColumn}>
                <div class="mt-2 border-t border-edge-muted pt-3">
                  {props.addColumn}
                </div>
              </Show>
            </ToolbarPopover>
          </div>
          <div class="ml-1 flex shrink-0 items-center">
            <Show when={props.onCreateRecord && view().layout === 'board'}>
              <Button
                size="sm"
                variant="outline"
                class="h-8 gap-1.5 px-2.5 text-xs"
                aria-label={props.creating ? 'Saving record' : 'New record'}
                disabled={!props.canCreateRecord || props.creating}
                onClick={() => props.onCreateRecord?.()}
              >
                <PlusIcon class="size-3.5" />
                <Show when={!props.creating} fallback="Saving…">
                  New
                </Show>
              </Button>
            </Show>
          </div>
        </div>
      </div>
      <Show when={renameError()}>
        <p role="alert" class="px-4 pb-2 text-xs text-failure">
          {renameError()}
        </p>
      </Show>
      <Show when={updateError()}>
        <p role="alert" class="px-4 pb-2 text-xs text-failure">
          Could not update the view. Try saving again.
        </p>
      </Show>
      <Show when={dialog()} keyed>
        {(action) => (
          <SaveViewDialog
            mode={action.mode}
            initialName={
              action.mode === 'save' ? action.name : action.target.name
            }
            columns={props.columns}
            initialGroupBy={view().groupBy}
            initialLayout={
              action.mode === 'save' ? action.layout : action.target.view.layout
            }
            returnFocus={action.returnFocus}
            returnFocusFallback={allRecordsButton}
            onClose={() => setDialog(undefined)}
            onSubmit={async (name, layout, groupBy) => {
              if (action.mode === 'save')
                await props.onSaveView(name, layout, groupBy);
              else await props.onDeleteView(action.target.id);
            }}
          />
        )}
      </Show>
    </div>
  );
}
