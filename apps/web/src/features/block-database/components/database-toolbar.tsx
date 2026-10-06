import {
  ContextMenuContent,
  MenuItem,
  SubTrigger,
} from '@core/component/ContextMenu';
import { ContextMenu } from '@kobalte/core/context-menu';
import FunnelIcon from '@phosphor/funnel.svg';
import KanbanIcon from '@phosphor/kanban.svg';
import PlusIcon from '@phosphor/plus.svg';
import SortAscendingIcon from '@phosphor/sort-ascending.svg';
import TableIcon from '@phosphor/table.svg';
import type { DatabaseView } from '@service-storage/generated/schemas/databaseView';
import { Key } from '@solid-primitives/keyed';
import {
  closestCenter,
  createSortable,
  DragDropProvider,
  DragDropSensors,
  SortableProvider,
} from '@thisbeyond/solid-dnd';
import { Button } from '@ui/components/Button';
import { DeleteDialog } from '@ui/components/DeleteDialog';
import { Tooltip } from '@ui/components/Tooltip';
import type { ResultAsync } from 'neverthrow';
import { createSignal, For, type JSX, Show } from 'solid-js';
import type { BoardGrouping } from '../core/board-grouping';
import type { DatabaseViewColumn } from '../core/database-view';
import type { ViewChange } from '../core/view-state';
import { boardGroupColumns, movedViewOrder } from '../core/views';
import {
  type DatabaseOpFailure,
  databaseOpMessage,
} from '../core/write-failure';
import { FilterPanel, filterConditionCount } from './database-view-filters';
import { createInlineRename } from './inline-rename';
import { type NewView, NewViewDialog } from './new-view-dialog';
import { SortPanel } from './sort-panel';
import { ToolbarPopover } from './view-control-popover';

/** A layout a stored view can be switched to from its tab's menu. */
export type ShownLayout =
  | { kind: 'table' }
  | { kind: 'board'; groupBy: BoardGrouping };

type DatabaseToolbarProps = {
  columns: DatabaseViewColumn[];
  /** The table's stored views, in order. */
  views: DatabaseView[];
  /** The view on screen: a stored one, or the table's own All records. */
  view: DatabaseView;
  selectedViewId?: string;
  canEdit: boolean;
  /** The database's search, beside the view controls. */
  search?: JSX.Element;
  onSelectView: (id?: string) => void;
  onChangeView: (change: ViewChange) => void;
  onCreateView: (view: NewView) => ResultAsync<void, DatabaseOpFailure>;
  onRenameView: (
    view: DatabaseView,
    name: string
  ) => ResultAsync<void, DatabaseOpFailure>;
  onDeleteView: (view: DatabaseView) => ResultAsync<void, DatabaseOpFailure>;
  /** Lay a stored view out as a table, or as a board grouped as chosen. */
  onShowViewAs: (
    view: DatabaseView,
    layout: ShownLayout
  ) => ResultAsync<void, DatabaseOpFailure>;
  /** Every stored view of the table, in its new order. */
  onReorderViews: (order: string[]) => void;
  onCreateRecord?: () => void;
  canCreateRecord?: boolean;
  creating?: boolean;
};

/** View controls contain no data fetching or mutation implementation. */
export function DatabaseToolbar(props: DatabaseToolbarProps) {
  const [creating, setCreating] = createSignal<HTMLElement>();
  const [deleting, setDeleting] = createSignal<{ view: DatabaseView }>();
  let renameInput: HTMLInputElement | undefined;
  let allRecordsButton: HTMLButtonElement | undefined;
  let viewRail: HTMLDivElement | undefined;
  /** Viewers change only what All records shows them; stored views are everyone's. */
  const canChangeView = () => !props.selectedViewId || props.canEdit;
  const layout = () => props.view.layout;
  const board = () => {
    const current = layout();
    return current.kind === 'board' ? current : undefined;
  };
  const sort = () => props.view.query.sort ?? [];
  const viewRename = createInlineRename({
    name: (view: DatabaseView) => view.name,
    rename: (view, name) => props.onRenameView(view, name),
    failureMessage: (failure: DatabaseOpFailure) =>
      databaseOpMessage(failure, 'this view'),
    emptyName: { message: 'Enter a view name.', onBlur: 'keep-editing' },
    input: () => renameInput,
    // The tab is drawn again when the rename input goes, so focus finds it by its view.
    restoreFocus: (view) =>
      viewRail
        ?.querySelector<HTMLElement>(`[data-view-id="${view.id}"]`)
        ?.focus(),
  });
  const viewError = viewRename.error;
  const setViewError = viewRename.setError;
  function reorder(id: string, targetId: string) {
    const order = props.views.map((view) => view.id);
    const moved = movedViewOrder(order, id, targetId);
    if (moved.some((view, index) => view !== order[index]))
      props.onReorderViews(moved);
  }
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
            ref={viewRail}
            class="flex min-w-0 items-center gap-0.5 overflow-x-auto"
            aria-label="Views"
          >
            <button
              ref={allRecordsButton}
              type="button"
              aria-pressed={!props.selectedViewId}
              onClick={() => props.onSelectView()}
              class="flex h-8 max-w-40 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-ink-muted outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ink/50"
              classList={{
                'bg-hover font-medium text-ink': !props.selectedViewId,
              }}
            >
              <TableIcon class="size-3.5" />
              <span class="truncate">All records</span>
            </button>
            <DragDropProvider
              collisionDetector={closestCenter}
              onDragEnd={({ draggable, droppable }) => {
                if (droppable)
                  reorder(String(draggable.id), String(droppable.id));
              }}
            >
              <DragDropSensors />
              <SortableProvider ids={props.views.map((view) => view.id)}>
                <Key each={props.views} by="id">
                  {(view) => (
                    <ViewTab
                      view={view()}
                      selected={props.selectedViewId === view().id}
                      canEdit={props.canEdit}
                      renaming={viewRename.target()?.id === view().id}
                      renameDraft={viewRename.draft()}
                      renamePending={viewRename.pending()}
                      renameInput={(element) => {
                        renameInput = element;
                      }}
                      onRenameInput={viewRename.setDraft}
                      onRenameSave={(restoreFocus) =>
                        void viewRename.save(restoreFocus)
                      }
                      onRenameCancel={() => viewRename.cancel(true)}
                      onSelect={() => props.onSelectView(view().id)}
                      onRename={() => {
                        if (props.canEdit) viewRename.begin(view());
                      }}
                      onDelete={() => {
                        setViewError('');
                        setDeleting({ view: view() });
                      }}
                      columns={props.columns}
                      onShowAs={(shown) => {
                        setViewError('');
                        void props
                          .onShowViewAs(view(), shown)
                          .mapErr((failure) =>
                            setViewError(
                              databaseOpMessage(failure, 'this view')
                            )
                          );
                      }}
                    />
                  )}
                </Key>
              </SortableProvider>
            </DragDropProvider>
          </div>
          <Show when={props.canEdit}>
            <Button
              size="icon-sm"
              label="New view"
              class="shrink-0"
              onClick={(event) => setCreating(event.currentTarget)}
            >
              <PlusIcon class="size-3.5" />
            </Button>
          </Show>
        </div>
        <div class="flex shrink-0 items-center gap-0.5 @max-[520px]/view-toolbar:w-full @max-[520px]/view-toolbar:justify-end">
          <Show when={canChangeView()}>
            <ToolbarPopover
              label="Filter"
              compact
              count={filterConditionCount(props.view.query.filter)}
              icon={<FunnelIcon class="size-3.5" />}
            >
              <FilterPanel
                columns={props.columns}
                filter={props.view.query.filter}
                onChange={(filter) =>
                  props.onChangeView({
                    query: { ...props.view.query, filter },
                  })
                }
              />
            </ToolbarPopover>
            <ToolbarPopover
              label="Sort"
              compact
              count={sort().length}
              icon={<SortAscendingIcon class="size-3.5" />}
            >
              <SortPanel
                columns={props.columns}
                view={props.view}
                onChange={props.onChangeView}
              />
            </ToolbarPopover>
          </Show>
          {props.search}
          <div class="ml-1 flex shrink-0 items-center">
            <Show when={props.onCreateRecord && board()}>
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
      <Show when={viewError()}>
        <p role="alert" class="px-4 pb-2 text-xs text-failure">
          {viewError()}
        </p>
      </Show>
      <Show when={creating()} keyed>
        {(origin) => (
          <NewViewDialog
            initialName="Table view"
            columns={props.columns}
            returnFocus={origin}
            returnFocusFallback={allRecordsButton}
            onClose={() => setCreating(undefined)}
            onSubmit={props.onCreateView}
          />
        )}
      </Show>
      <DeleteDialog
        open={!!deleting()}
        onOpenChange={(open) => {
          if (!open) setDeleting(undefined);
        }}
        title="Delete view?"
        deleteLabel="Delete view"
        onDelete={() => {
          const target = deleting();
          if (!target) return;
          setDeleting(undefined);
          void props
            .onDeleteView(target.view)
            .mapErr((failure) =>
              setViewError(databaseOpMessage(failure, 'this view'))
            );
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          allRecordsButton?.focus();
        }}
        body={
          <p class="break-words">
            “{deleting()?.view.name}” will be deleted for everyone. The table
            and its records stay.
          </p>
        }
      />
    </div>
  );
}

function ViewTab(props: {
  view: DatabaseView;
  selected: boolean;
  canEdit: boolean;
  renaming: boolean;
  renameDraft: string;
  renamePending: boolean;
  renameInput: (element: HTMLInputElement) => void;
  onRenameInput: (name: string) => void;
  onRenameSave: (restoreFocus: boolean) => void;
  onRenameCancel: () => void;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
  columns: DatabaseViewColumn[];
  onShowAs: (layout: ShownLayout) => void;
}) {
  const sortable = createSortable(props.view.id);
  return (
    <div
      ref={sortable.ref}
      class="shrink-0"
      classList={{ 'opacity-40': sortable.isActiveDraggable }}
      style={
        sortable.transform.x
          ? { transform: `translateX(${sortable.transform.x}px)` }
          : undefined
      }
    >
      <Show
        when={!props.renaming}
        fallback={
          <form
            onSubmit={(event) => {
              event.preventDefault();
              props.onRenameSave(true);
            }}
          >
            <input
              ref={props.renameInput}
              aria-label="View name"
              maxlength={100}
              value={props.renameDraft}
              readOnly={props.renamePending}
              class="h-8 w-36 rounded-md border border-ink/40 bg-input px-2 text-xs text-ink outline-none focus:ring-2 focus:ring-ink/10"
              onInput={(event) =>
                props.onRenameInput(event.currentTarget.value)
              }
              onBlur={() => props.onRenameSave(false)}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return;
                event.preventDefault();
                event.stopPropagation();
                props.onRenameCancel();
              }}
            />
          </form>
        }
      >
        <ContextMenu>
          <Tooltip label={props.view.name}>
            <ContextMenu.Trigger
              as="button"
              type="button"
              {...(props.canEdit ? sortable.dragActivators : {})}
              data-view-id={props.view.id}
              aria-pressed={props.selected}
              aria-keyshortcuts={props.canEdit ? 'F2 Shift+F10' : undefined}
              onClick={props.onSelect}
              onDblClick={(event: MouseEvent) => {
                event.preventDefault();
                props.onRename();
              }}
              onKeyDown={(event: KeyboardEvent) => {
                if (event.key === 'F2') {
                  event.preventDefault();
                  props.onRename();
                }
              }}
              class="flex h-8 max-w-40 items-center gap-1.5 rounded-md px-2 text-xs text-ink-muted outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ink/50"
              classList={{ 'bg-hover font-medium text-ink': props.selected }}
            >
              <Show
                when={props.view.layout.kind === 'board'}
                fallback={<TableIcon class="size-3.5 shrink-0" />}
              >
                <KanbanIcon class="size-3.5 shrink-0" />
              </Show>
              <span class="truncate">{props.view.name}</span>
            </ContextMenu.Trigger>
          </Tooltip>
          <Show when={props.canEdit}>
            <ContextMenu.Portal>
              <ContextMenuContent class="min-w-48">
                <MenuItem
                  text="Rename view"
                  closeOnSelect
                  shortcut="F2"
                  onClick={props.onRename}
                />
                <Show
                  when={props.view.layout.kind === 'board'}
                  fallback={
                    <ContextMenu.Sub>
                      <SubTrigger text="Show as board" />
                      <ContextMenuContent submenu class="min-w-44">
                        <For
                          each={boardGroupColumns(props.columns)}
                          fallback={
                            <MenuItem
                              text="Create a Status column"
                              closeOnSelect
                              onClick={() =>
                                props.onShowAs({
                                  kind: 'board',
                                  groupBy: { kind: 'new-status' },
                                })
                              }
                            />
                          }
                        >
                          {(column) => (
                            <MenuItem
                              text={`Group by ${column.name}`}
                              closeOnSelect
                              onClick={() =>
                                props.onShowAs({
                                  kind: 'board',
                                  groupBy: {
                                    kind: 'column',
                                    columnId: column.id,
                                  },
                                })
                              }
                            />
                          )}
                        </For>
                      </ContextMenuContent>
                    </ContextMenu.Sub>
                  }
                >
                  <MenuItem
                    text="Show as table"
                    closeOnSelect
                    onClick={() => props.onShowAs({ kind: 'table' })}
                  />
                </Show>
                <MenuItem
                  text="Delete view"
                  closeOnSelect
                  onClick={props.onDelete}
                />
              </ContextMenuContent>
            </ContextMenu.Portal>
          </Show>
        </ContextMenu>
      </Show>
    </div>
  );
}
