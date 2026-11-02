import { fireAndForget } from '@core/util/fireAndForget';
import TimelineIcon from '@icon/system/regular/chart-gantt.svg';
import KanbanIcon from '@icon/system/regular/kanban.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import TableIcon from '@icon/system/regular/table.svg';
import { ContextMenu } from '@kobalte/core/context-menu';
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
import { Dropdown } from '@ui/components/Dropdown';
import { Input } from '@ui/components/Input';
import { Tooltip } from '@ui/components/Tooltip';
import type { ResultAsync } from 'neverthrow';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { match } from 'ts-pattern';
import {
  ContextMenuContent,
  MenuItem,
  SubTrigger,
} from '../../../lib/core/component/ContextMenu';
import type { BoardGrouping } from '../core/board-grouping';
import type { DatabaseViewColumn } from '../core/database-view';
import { isDatabaseNameTaken } from '../core/property-creation';
import type { TimelineRange } from '../core/timeline-range';
import type { NewView } from '../core/view-creation';
import type { ViewChange } from '../core/view-state';
import {
  boardGroupColumns,
  movedViewOrder,
  timelineRangeColumns,
} from '../core/views';
import {
  type DatabaseOpFailure,
  databaseOpMessage,
} from '../core/write-failure';
import { DatabaseEditorToolbar } from './database-editor-toolbar';
import { createInlineRename } from './inline-rename';

/** A layout a stored view can be switched to from its tab's menu. */
export type ShownLayout =
  | { kind: 'table' }
  | { kind: 'board'; groupBy: BoardGrouping }
  | { kind: 'timeline'; range: TimelineRange };

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
  /** Lay a stored view out as a table, a board grouped as chosen, or a timeline along the dates chosen. */
  onShowViewAs: (
    view: DatabaseView,
    layout: ShownLayout
  ) => ResultAsync<void, DatabaseOpFailure>;
  /** Every stored view of the table, in its new order; omitted when the host cannot store an order. */
  onReorderViews?: (order: string[]) => void;
  onCreateRecord?: () => void;
  canCreateRecord?: boolean;
  creating?: boolean;
  /** The host's own actions after the view controls, e.g. a labelled create button. */
  actions?: JSX.Element;
};

/** View controls contain no data fetching or mutation implementation. */
export function DatabaseToolbar(props: DatabaseToolbarProps) {
  const [creating, setCreating] = createSignal(false);
  const [deleting, setDeleting] = createSignal<{ view: DatabaseView }>();
  let renameInput: HTMLInputElement | undefined;
  let allRecordsButton: HTMLButtonElement | undefined;
  let viewRail: HTMLDivElement | undefined;
  /** Viewers change only what All records shows them; stored views are everyone's. */
  const canChangeView = () => !props.selectedViewId || props.canEdit;
  const layout = () => props.view.layout;
  /** Boards and timelines add records from the toolbar; a table has its blank row. */
  const addsRecords = () => layout().kind !== 'table';
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
  const createView = async (kind: NewView['layout']) => {
    if (creating() || !props.canEdit) return;
    const base = match(kind)
      .with('table', () => 'Table view')
      .with('board', () => 'Board view')
      .with('timeline', () => 'Timeline view')
      .exhaustive();
    const names = props.views.map((view) => view.name);
    let name = base;
    for (let suffix = 2; isDatabaseNameTaken(name, names); suffix += 1)
      name = `${base} ${suffix}`;
    const view = match(kind)
      .returnType<NewView>()
      .with('table', () => ({ name, layout: 'table' }))
      .with('board', () => {
        const column = boardGroupColumns(props.columns)[0];
        return {
          name,
          layout: 'board',
          groupBy: column
            ? { kind: 'column', columnId: column.id }
            : { kind: 'new-status' },
        };
      })
      .with('timeline', () => {
        const column = timelineRangeColumns(props.columns)[0];
        return {
          name,
          layout: 'timeline',
          range: column
            ? { kind: 'column', columnId: column.id }
            : { kind: 'new-column' },
        };
      })
      .exhaustive();
    setCreating(true);
    setViewError('');
    const created = await props.onCreateView(view);
    setCreating(false);
    created.mapErr((failure) =>
      setViewError(databaseOpMessage(failure, 'this view'))
    );
  };
  function reorder(id: string, targetId: string) {
    const order = props.views.map((view) => view.id);
    const moved = movedViewOrder(order, id, targetId);
    if (moved.some((view, index) => view !== order[index]))
      props.onReorderViews?.(moved);
  }
  return (
    <div class="shrink-0 bg-canvas-base">
      <DatabaseEditorToolbar
        columns={props.columns}
        view={props.view}
        onChangeView={props.onChangeView}
        canChangeView={canChangeView()}
        search={props.search}
        actions={props.actions}
        onCreateRecord={addsRecords() ? props.onCreateRecord : undefined}
        canCreateRecord={props.canCreateRecord}
        creating={props.creating}
        selection={
          <>
            <div
              ref={viewRail}
              class="-m-1 flex min-w-0 items-center gap-1.5 overflow-x-auto p-1"
              aria-label="Views"
            >
              <Button
                ref={allRecordsButton}
                type="button"
                variant="secondary"
                size="md"
                aria-pressed={!props.selectedViewId}
                onClick={() => props.onSelectView()}
                class="max-w-40"
              >
                <span class="truncate">All records</span>
              </Button>
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
                        canReorder={props.canEdit && !!props.onReorderViews}
                        renaming={viewRename.target()?.id === view().id}
                        renameDraft={viewRename.draft()}
                        renamePending={viewRename.pending()}
                        renameInput={(element) => {
                          renameInput = element;
                        }}
                        onRenameInput={viewRename.setDraft}
                        onRenameSave={(restoreFocus) =>
                          fireAndForget(
                            viewRename.save(restoreFocus),
                            'database'
                          )
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
              <Dropdown placement="bottom-start">
                <Dropdown.Trigger
                  aria-label="New view"
                  tooltip="New view"
                  size="icon-md"
                  variant="ghost"
                  class="ml-1.5 shrink-0"
                  disabled={creating()}
                >
                  <PlusIcon class="size-4 touch:size-3.5" />
                </Dropdown.Trigger>
                <Dropdown.Content class="min-w-40">
                  <Dropdown.Item
                    onSelect={() =>
                      fireAndForget(createView('table'), 'database')
                    }
                    disabled={creating()}
                  >
                    <TableIcon class="size-4" />
                    Table
                  </Dropdown.Item>
                  <Dropdown.Item
                    onSelect={() =>
                      fireAndForget(createView('board'), 'database')
                    }
                    disabled={creating()}
                  >
                    <KanbanIcon class="size-4" />
                    Board
                  </Dropdown.Item>
                  <Dropdown.Item
                    onSelect={() =>
                      fireAndForget(createView('timeline'), 'database')
                    }
                    disabled={creating()}
                  >
                    <TimelineIcon class="size-4" />
                    Timeline
                  </Dropdown.Item>
                </Dropdown.Content>
              </Dropdown>
            </Show>
          </>
        }
      />
      <Show when={viewError()}>
        <p role="alert" class="px-4 pb-2 text-xs text-failure">
          {viewError()}
        </p>
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
  canReorder: boolean;
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
            <Input
              ref={props.renameInput}
              aria-label="View name"
              maxlength={100}
              value={props.renameDraft}
              readOnly={props.renamePending}
              class="w-36"
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
              tooltip={{ content: undefined, disabled: true }}
              as={Button}
              variant="secondary"
              size="md"
              type="button"
              {...(props.canReorder ? sortable.dragActivators : {})}
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
              class="max-w-40"
            >
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
                <Show when={props.view.layout.kind !== 'table'}>
                  <MenuItem
                    text="Show as table"
                    closeOnSelect
                    onClick={() => props.onShowAs({ kind: 'table' })}
                  />
                </Show>
                <Show when={props.view.layout.kind !== 'board'}>
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
                </Show>
                <Show when={props.view.layout.kind !== 'timeline'}>
                  <ContextMenu.Sub>
                    <SubTrigger text="Show as timeline" />
                    <ContextMenuContent submenu class="min-w-44">
                      <For
                        each={timelineRangeColumns(props.columns)}
                        fallback={
                          <MenuItem
                            text="Create a Time range column"
                            closeOnSelect
                            onClick={() =>
                              props.onShowAs({
                                kind: 'timeline',
                                range: { kind: 'new-column' },
                              })
                            }
                          />
                        }
                      >
                        {(column) => (
                          <MenuItem
                            text={`Along ${column.name}`}
                            closeOnSelect
                            onClick={() =>
                              props.onShowAs({
                                kind: 'timeline',
                                range: { kind: 'column', columnId: column.id },
                              })
                            }
                          />
                        )}
                      </For>
                    </ContextMenuContent>
                  </ContextMenu.Sub>
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
