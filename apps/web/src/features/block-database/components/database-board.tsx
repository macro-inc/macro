import CheckIcon from '@phosphor/check.svg';
import GripIcon from '@phosphor/dots-six-vertical.svg';
import DotsIcon from '@phosphor/dots-three.svg';
import PlusIcon from '@phosphor/plus.svg';
import XIcon from '@phosphor/x.svg';
import { Key } from '@solid-primitives/keyed';
import {
  createDraggable,
  createDroppable,
  DragDropProvider,
  DragDropSensors,
  type DragEventHandler,
  DragOverlay,
} from '@thisbeyond/solid-dnd';
import { Dropdown } from '@ui/components/Dropdown';
import {
  createMemo,
  createSignal,
  createUniqueId,
  For,
  onMount,
  Show,
} from 'solid-js';
import {
  type DatabaseCellValue,
  type DatabaseViewColumn,
  groupDatabaseRows,
  orderDatabaseColumns,
} from '../core/database-view';
import {
  type DatabaseRow,
  formatCellValue,
  rowTitle,
  rowValue,
  titleColumn,
} from '../core/table';
import { PropertyIcon } from './property-icon';
import { SelectPill } from './select-pill';

type BoardGroup = ReturnType<typeof groupDatabaseRows<DatabaseRow>>[number];

function canMoveTo(column: DatabaseViewColumn, value: DatabaseCellValue) {
  return (
    value === null ||
    column.dataType === 'BOOLEAN' ||
    column.options.some((option) => String(option) === String(value))
  );
}

type DatabaseBoardProps = {
  rows: DatabaseRow[];
  columns: DatabaseViewColumn[];
  visibleColumnIds?: string[];
  groupColumn: DatabaseViewColumn;
  canEdit: boolean;
  rowPending: (rowId: string) => boolean;
  createPending?: (intentId: string) => boolean;
  createComplete?: (intentId: string) => boolean;
  onOpen: (rowId: string) => void;
  onMove: (rowId: string, value: DatabaseCellValue) => Promise<boolean>;
  onCreate: (
    value: DatabaseCellValue,
    title: string,
    intentId: string
  ) => Promise<boolean>;
  onAddGroup?: (label: string) => Promise<void>;
};

export function DatabaseBoard(props: DatabaseBoardProps) {
  const groups = createMemo(() =>
    groupDatabaseRows(props.rows, props.groupColumn, rowValue)
  );
  const [dragged, setDragged] = createSignal<string>();
  const [announcement, setAnnouncement] = createSignal('');
  const draggedRow = () => props.rows.find((row) => row.rowId === dragged());
  async function move(rowId: string, value: DatabaseCellValue) {
    const row = props.rows.find((row) => row.rowId === rowId);
    if (
      !row ||
      !props.canEdit ||
      !props.groupColumn.writable ||
      !canMoveTo(props.groupColumn, value) ||
      rowValue(row, props.groupColumn.id) === value
    )
      return;
    if (await props.onMove(rowId, value))
      setAnnouncement(
        `${rowTitle(row, props.columns)} moved to ${value === null ? 'No ' + props.groupColumn.name : String(value)}.`
      );
  }
  const endDrag: DragEventHandler = (event) => {
    setDragged(undefined);
    const group = groups().find((group) => group.key === event.droppable?.id);
    if (group) void move(String(event.draggable.id), group.value);
  };
  return (
    <div class="min-h-0 flex-1 overflow-auto px-5 py-5 [&_button:focus-visible]:ring-2 [&_button:focus-visible]:ring-ink/50">
      <p class="sr-only" role="status" aria-live="polite">
        {announcement()}
      </p>
      <DragDropProvider
        onDragStart={(event) => setDragged(String(event.draggable.id))}
        onDragEnd={endDrag}
      >
        <DragDropSensors />
        <div
          class="flex min-h-full min-w-fit items-start gap-4 pb-4"
          aria-label={`Board grouped by ${props.groupColumn.name}`}
        >
          <Key each={groups()} by="key">
            {(group) => (
              <BoardLane
                group={group()}
                {...props}
                groups={groups()}
                onMove={(rowId, value) => void move(rowId, value)}
              />
            )}
          </Key>
          <Show
            when={
              props.canEdit &&
              props.groupColumn.writable &&
              props.groupColumn.dataType !== 'BOOLEAN' &&
              props.onAddGroup
            }
          >
            <NewBoardGroup
              column={props.groupColumn}
              onSave={async (label) => {
                await props.onAddGroup?.(label);
              }}
            />
          </Show>
        </div>
        <DragOverlay>
          <Show when={draggedRow()}>
            {(row) => (
              <div class="w-68 rotate-2 rounded-xl border border-ink/30 bg-panel p-4 text-sm font-medium text-ink shadow-lg">
                {rowTitle(row(), props.columns)}
              </div>
            )}
          </Show>
        </DragOverlay>
      </DragDropProvider>
    </div>
  );
}

function BoardLane(
  props: Omit<DatabaseBoardProps, 'onMove'> & {
    group: BoardGroup;
    groups: BoardGroup[];
    onMove: (rowId: string, value: DatabaseCellValue) => void;
  }
) {
  const droppable = createDroppable(props.group.key);
  const [draftId, setDraftId] = createSignal<string>();
  const laneId = createUniqueId();
  let draftSequence = 0;
  const activeDraft = () => {
    const id = draftId();
    return id && !props.createComplete?.(id) ? id : undefined;
  };
  const beginCreate = () => {
    if (!activeDraft()) setDraftId(`${laneId}:${++draftSequence}`);
  };
  const title = () => titleColumn(props.columns);
  const acceptsRecords = () =>
    props.canEdit && canMoveTo(props.groupColumn, props.group.value);
  return (
    <section
      ref={droppable.ref}
      class="flex w-72 shrink-0 flex-col rounded-xl border border-transparent bg-hover/50 p-2 transition-colors"
      classList={{
        'border-ink/40 bg-hover': droppable.isActiveDroppable,
      }}
      aria-label={`${props.group.label} lane`}
    >
      <div class="mb-2 flex min-h-9 items-center gap-2 px-1.5">
        <SelectPill
          label={props.group.label}
          empty={props.group.value === null}
          dot
        />
        <span class="text-xs tabular-nums text-ink-placeholder">
          {props.group.rows.length}
        </span>
        <Show when={acceptsRecords()}>
          <button
            type="button"
            class="ml-auto rounded p-1.5 text-ink-muted hover:bg-hover"
            title={`Add record to ${props.group.label}`}
            aria-label={`Add record to ${props.group.label}`}
            onClick={beginCreate}
          >
            <PlusIcon class="size-3.5" />
          </button>
        </Show>
      </div>
      <div class="flex min-h-10 flex-col gap-2">
        <Key each={props.group.rows} by="rowId">
          {(row) => (
            <BoardCard
              row={row()}
              columns={props.columns}
              visibleColumnIds={props.visibleColumnIds}
              groupColumn={props.groupColumn}
              groups={props.groups}
              canEdit={props.canEdit && props.groupColumn.writable}
              pending={props.rowPending(row().rowId)}
              onOpen={props.onOpen}
              onMove={props.onMove}
            />
          )}
        </Key>
        <Show when={props.group.rows.length === 0 && !activeDraft()}>
          <div class="flex min-h-20 items-center justify-center rounded-lg border border-dashed border-edge-muted/70 px-4 text-xs text-ink-placeholder">
            {acceptsRecords() ? 'Drop a record here' : 'No records'}
          </div>
        </Show>
        <Show when={activeDraft()} keyed>
          {(intentId) => (
            <NewBoardCard
              titlePlaceholder={title()?.name ?? 'Record title'}
              canSetTitle={Boolean(title()?.writable)}
              pending={props.createPending?.(intentId) ?? false}
              onCancel={() => setDraftId(undefined)}
              onSave={async (value) => {
                if (await props.onCreate(props.group.value, value, intentId))
                  setDraftId((current) =>
                    current === intentId ? undefined : current
                  );
              }}
            />
          )}
        </Show>
        <Show when={acceptsRecords() && !activeDraft()}>
          <button
            type="button"
            class="mt-1 flex min-h-9 items-center gap-2 rounded-lg px-3 text-xs text-ink-muted hover:bg-hover hover:text-ink"
            onClick={beginCreate}
          >
            <PlusIcon class="size-3.5" />
            New record
          </button>
        </Show>
      </div>
    </section>
  );
}

function NewBoardGroup(props: {
  column: DatabaseViewColumn;
  onSave: (label: string) => Promise<void>;
}) {
  const [adding, setAdding] = createSignal(false);
  const [draft, setDraft] = createSignal('');
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal('');
  let input: HTMLInputElement | undefined;
  const cancel = () => {
    if (!pending()) {
      setAdding(false);
      setError('');
    }
  };
  async function save(event: SubmitEvent) {
    event.preventDefault();
    const entered = draft().trim();
    if (!entered || pending()) return;
    if (
      props.column.dataType === 'SELECT_NUMBER' &&
      !Number.isFinite(Number(entered))
    ) {
      setError('Enter a valid number for this group.');
      return;
    }
    const label =
      props.column.dataType === 'SELECT_NUMBER'
        ? String(Number(entered))
        : entered;
    if (
      props.column.options.some(
        (option) => String(option).toLowerCase() === label.toLowerCase()
      )
    ) {
      setError('A group with this name already exists.');
      return;
    }
    setPending(true);
    setError('');
    try {
      await props.onSave(label);
      setAdding(false);
      setDraft('');
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Could not add this group. Try again.'
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <div class="w-64 shrink-0 pt-2">
      <Show
        when={adding()}
        fallback={
          <button
            type="button"
            class="flex min-h-9 items-center gap-2 rounded-lg px-3 text-xs text-ink-muted hover:bg-hover hover:text-ink"
            onClick={() => {
              setDraft('');
              setAdding(true);
              queueMicrotask(() => input?.focus());
            }}
          >
            <PlusIcon class="size-3.5" />
            New group
          </button>
        }
      >
        <form
          class="rounded-xl border border-edge-muted bg-panel p-3 shadow-sm"
          onSubmit={(event) => void save(event)}
        >
          <p class="mb-2 block text-xs font-medium text-ink-muted">
            New {props.column.name.toLowerCase()} group
          </p>
          <input
            ref={input}
            value={draft()}
            maxlength={200}
            aria-label="New group name"
            placeholder={
              props.column.dataType === 'SELECT_NUMBER'
                ? 'Enter a number…'
                : 'Group name…'
            }
            readOnly={pending()}
            class="w-full rounded-md border border-edge-muted bg-input px-2.5 py-2 text-xs outline-none focus:border-ink/50"
            onInput={(event) => {
              setDraft(event.currentTarget.value);
              setError('');
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                cancel();
              }
            }}
          />
          <Show when={error()}>
            <p role="alert" class="mt-2 text-xs leading-5 text-failure-ink">
              {error()}
            </p>
          </Show>
          <div class="mt-3 flex items-center gap-2">
            <button
              type="submit"
              disabled={pending() || !draft().trim()}
              class="rounded-md border border-edge bg-hover px-3 py-1.5 text-xs font-medium text-ink outline-none focus-visible:ring-2 focus-visible:ring-ink/50 disabled:opacity-50"
            >
              {pending() ? 'Adding…' : 'Add group'}
            </button>
            <button
              type="button"
              disabled={pending()}
              class="rounded px-2 py-1.5 text-xs text-ink-muted hover:bg-hover disabled:opacity-50"
              onClick={cancel}
            >
              Cancel
            </button>
          </div>
        </form>
      </Show>
    </div>
  );
}

function BoardCard(props: {
  row: DatabaseRow;
  columns: DatabaseViewColumn[];
  visibleColumnIds?: string[];
  groupColumn: DatabaseViewColumn;
  groups: BoardGroup[];
  canEdit: boolean;
  pending: boolean;
  onOpen: (rowId: string) => void;
  onMove: (rowId: string, value: DatabaseCellValue) => void;
}) {
  const draggable = createDraggable(props.row.rowId);
  const title = () => rowTitle(props.row, props.columns);
  const metadata = () =>
    orderDatabaseColumns(props.columns, props.visibleColumnIds)
      .filter(
        (column) =>
          column.id !== props.groupColumn.id &&
          column.id !== titleColumn(props.columns)?.id &&
          (props.visibleColumnIds === undefined ||
            props.visibleColumnIds.includes(column.id)) &&
          rowValue(props.row, column.id) !== null
      )
      .slice(0, 3);
  return (
    <article
      ref={draggable.ref}
      class="group relative rounded-lg border border-edge-muted bg-panel shadow-sm transition-shadow hover:border-edge hover:shadow-md"
      classList={{
        'opacity-35': draggable.isActiveDraggable,
        'ring-1 ring-ink/20': props.pending,
      }}
      data-row-id={props.row.rowId}
    >
      <button
        type="button"
        class="block min-w-0 w-full rounded-lg p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ink/50"
        onClick={() => props.onOpen(props.row.rowId)}
        aria-label={`Open ${title()}`}
      >
        <span
          class="block break-words text-[13px] font-medium leading-5 text-ink"
          classList={{ 'pr-10': props.canEdit }}
        >
          {title()}
        </span>
        <Show when={metadata().length}>
          <span class="mt-3 flex flex-col gap-2 border-t border-edge-muted/50 pt-2.5">
            <For each={metadata()}>
              {(column) => (
                <span
                  class="flex min-w-0 items-center gap-2"
                  title={`${column.name}: ${formatCellValue(column, rowValue(props.row, column.id))}`}
                >
                  <PropertyIcon
                    type={column.dataType}
                    relation={!!column.relation}
                    class="size-3 shrink-0 text-ink-placeholder"
                  />
                  <Show
                    when={
                      column.dataType.startsWith('SELECT_') &&
                      !column.isMultiSelect
                    }
                    fallback={
                      <span class="truncate text-xs text-ink-muted">
                        {formatCellValue(
                          column,
                          rowValue(props.row, column.id)
                        )}
                      </span>
                    }
                  >
                    <SelectPill
                      label={String(rowValue(props.row, column.id))}
                    />
                  </Show>
                </span>
              )}
            </For>
          </span>
        </Show>
      </button>
      <Show when={props.canEdit}>
        <div class="absolute top-3 right-2 flex items-start gap-0.5">
          <button
            type="button"
            class="touch-none rounded p-0.5 text-ink-placeholder opacity-60 hover:bg-hover group-hover:opacity-100 focus-visible:opacity-100"
            title="Drag to another group, or use the Move menu"
            aria-label={`Drag ${title()}`}
            tabindex={-1}
            {...draggable.dragActivators}
          >
            <GripIcon class="size-4" />
          </button>
          <Dropdown>
            <Dropdown.Trigger
              variant="ghost"
              size="icon-xs"
              class="size-5 rounded text-ink-muted"
              aria-label={`Move ${title()}`}
              title="Move to another group"
            >
              <DotsIcon class="size-4" />
            </Dropdown.Trigger>
            <Dropdown.Content class="min-w-44">
              <Dropdown.Group>
                <Dropdown.GroupLabel>Move to</Dropdown.GroupLabel>
                <For each={props.groups}>
                  {(group) => (
                    <Dropdown.Item
                      disabled={!canMoveTo(props.groupColumn, group.value)}
                      onSelect={() =>
                        props.onMove(props.row.rowId, group.value)
                      }
                    >
                      <span class="flex-1">
                        <SelectPill
                          label={group.label}
                          empty={group.value === null}
                        />
                      </span>
                      <Show
                        when={
                          rowValue(props.row, props.groupColumn.id) ===
                          group.value
                        }
                      >
                        <CheckIcon class="size-3.5" />
                      </Show>
                    </Dropdown.Item>
                  )}
                </For>
              </Dropdown.Group>
            </Dropdown.Content>
          </Dropdown>
        </div>
      </Show>
    </article>
  );
}

function NewBoardCard(props: {
  titlePlaceholder: string;
  canSetTitle: boolean;
  pending: boolean;
  onSave: (title: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = createSignal('');
  const [submitting, setSubmitting] = createSignal(false);
  const pending = () => submitting() || props.pending;
  let input: HTMLInputElement | undefined;
  onMount(() => input?.focus());
  async function save() {
    if (pending()) return;
    setSubmitting(true);
    try {
      await props.onSave(title().trim());
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <form
      class="rounded-lg border border-ink/40 bg-panel p-3 shadow-sm ring-2 ring-ink/10"
      aria-busy={pending()}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <Show
        when={props.canSetTitle}
        fallback={
          <p class="mb-3 text-xs text-ink-muted">
            Add an empty record to this group.
          </p>
        }
      >
        <input
          ref={input}
          aria-label="New record title"
          placeholder={`${props.titlePlaceholder}…`}
          value={title()}
          readOnly={pending()}
          onInput={(event) => setTitle(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              if (!pending()) props.onCancel();
            }
          }}
          class="mb-3 w-full bg-input text-[13px] outline-none placeholder:text-ink-placeholder"
        />
      </Show>
      <div class="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending()}
          class="rounded-md border border-edge bg-hover px-2.5 py-1.5 text-xs font-medium text-ink outline-none focus-visible:ring-2 focus-visible:ring-ink/50 disabled:opacity-50"
        >
          {pending() ? 'Adding…' : 'Add record'}
        </button>
        <button
          type="button"
          aria-label="Cancel new record"
          disabled={pending()}
          class="rounded p-1.5 text-ink-muted hover:bg-hover"
          onClick={props.onCancel}
        >
          <XIcon class="size-3.5" />
        </button>
      </div>
    </form>
  );
}
