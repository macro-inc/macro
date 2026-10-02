import type { Board, LaneKey } from '@core/database-sql/generated/types';
import { isEditableInput } from '@core/util/isEditableInput';
import OpenIcon from '@phosphor/arrow-square-out.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import GripIcon from '@phosphor/dots-six-vertical.svg';
import DotsIcon from '@phosphor/dots-three.svg';
import PlusIcon from '@phosphor/plus.svg';
import type { DatabaseOpsError } from '@service-storage/databases';
import type { ViewLayout } from '@service-storage/generated/schemas/viewLayout';
import { Key } from '@solid-primitives/keyed';
import { Button } from '@ui/components/Button';
import { Dropdown } from '@ui/components/Dropdown';
import type { Result } from 'neverthrow';
import type { JSX } from 'solid-js';
import {
  createMemo,
  createSignal,
  createUniqueId,
  For,
  onCleanup,
  Show,
} from 'solid-js';
import {
  Kanban,
  KanbanCard,
  KanbanCardInsertion,
  KanbanHandle,
  KanbanLane,
} from '../../../components/kanban/kanban';
import { useOptionEditing } from '../context/option-editing';
import {
  type DatabaseEntityType,
  inferDatabaseNumber,
} from '../core/column-inference';
import { columnSchemaMessage } from '../core/column-schema';
import {
  type DatabaseOption,
  type DatabaseViewColumn,
  databaseCellValues,
  isOptionColumn,
} from '../core/database-view';
import { isDatabaseNameTaken } from '../core/property-creation';
import {
  cellTitle,
  type DatabaseRow,
  formatCellValue,
  isWritableText,
  rowValue,
} from '../core/table';
import { cardTitleColumn, laneId, laneLabel } from '../core/views';
import type { DatabaseTableProps } from './database-table';
import { OptionEditor } from './option-editor';
import { PropertyIcon } from './property-icon';
import { SelectPill } from './select-pill';

/** A new board group's option, added or refused. */
type DatabaseGroupAdded = Result<void, DatabaseOpsError>;

type BoardLayout = Extract<ViewLayout, { kind: 'board' }>;

/** One lane as the board draws it: its key as one string, the lane, and its option when it is an option's. */
type BoardGroup = {
  key: string;
  lane: LaneKey;
  option: DatabaseOption | null;
  label: string;
  rows: DatabaseRow[];
};

type DatabaseBoardProps = {
  /** The view's rows, which the board's lanes name by id. */
  rows: DatabaseRow[];
  columns: DatabaseViewColumn[];
  board: Board;
  layout: BoardLayout;
  renderCell?: DatabaseTableProps['renderCell'];
  renderTextValue?: (value: string) => JSX.Element;
  renderMentionValue?: (id: string, type: DatabaseEntityType) => JSX.Element;
  groupColumn: DatabaseViewColumn;
  canEdit: boolean;
  rowPending: (rowId: string) => boolean;
  createPending?: (intentId: string) => boolean;
  createComplete?: (intentId: string) => boolean;
  onOpen: (rowId: string) => void;
  /** A card dropped into `lane` in front of `next`, or last there without one. */
  onMove: (rowId: string, lane: LaneKey, next?: string) => void;
  /** The lanes, every one, in their new order. */
  onLaneOrderChange?: (order: LaneKey[]) => void;
  onHideLane?: (lane: LaneKey) => void;
  onHideEmptyLanes?: (hide: boolean) => void;
  /** Resolves whether the record was saved. `open` asks to show it once it is. */
  onCreate: (
    lane: LaneKey,
    title: string,
    intentId: string,
    options?: { open: true }
  ) => Promise<boolean>;
  onAddGroup?: (label: string) => Promise<DatabaseGroupAdded>;
  /** Hands the host a way to start a card, as the toolbar's New record does. */
  controlsRef?: (controls: DatabaseBoardControls) => void;
};

export type DatabaseBoardControls = {
  /** Starts an inline card in the first lane that takes records, unless unmounted. */
  addCard: () => boolean;
};

/** A card being typed into a lane, or saving there, before its record exists. */
type CardDraft = {
  id: string;
  lane: string;
  title: string;
  saving: boolean;
};

/** After Enter, a new card follows; after Shift+Enter, the record opens; after blur, neither. */
type DraftSubmission = 'next' | 'open' | 'stay';

export function DatabaseBoard(props: DatabaseBoardProps) {
  let viewport: HTMLDivElement | undefined;
  const lanes = createMemo((): BoardGroup[] => {
    const rows = new Map(props.rows.map((row) => [row.rowId, row]));
    return props.board.lanes
      .filter((lane) => !lane.hidden && lane.key.kind !== 'none')
      .map((lane) => {
        const key = lane.key;
        const option =
          key.kind === 'option'
            ? (props.groupColumn.options.find((entry) => entry.id === key.id) ??
              null)
            : null;
        return {
          key: laneId(key),
          lane: key,
          option,
          label: laneLabel(props.groupColumn, key),
          rows: lane.cards.flatMap((id) => {
            const row = rows.get(id);
            return row ? [row] : [];
          }),
        };
      });
  });
  const laneOf = (key: string): LaneKey =>
    lanes().find((lane) => lane.key === key)?.lane ?? { kind: 'none' };
  const [announcement, setAnnouncement] = createSignal('');
  const draftPrefix = createUniqueId();
  let draftSequence = 0;
  const [drafts, setDrafts] = createSignal<CardDraft[]>([]);
  const draftElements = new Map<string, HTMLElement>();
  const newButtons = new Map<string, HTMLElement>();
  const titleField = () => cardTitleColumn(props.layout, props.columns);
  const canSetTitle = () => isWritableText(titleField());
  const canMove = () => props.canEdit && props.groupColumn.writable;
  const isSaving = (draft: CardDraft) =>
    draft.saving || Boolean(props.createPending?.(draft.id));
  const laneDrafts = (lane: string) =>
    drafts().filter(
      (draft) => draft.lane === lane && !props.createComplete?.(draft.id)
    );
  const updateDraft = (id: string, change: Partial<CardDraft>) =>
    setDrafts((drafts) =>
      drafts.map((draft) => (draft.id === id ? { ...draft, ...change } : draft))
    );
  const removeDraft = (id: string) => {
    draftElements.delete(id);
    setDrafts((drafts) => drafts.filter((draft) => draft.id !== id));
  };
  function startDraft(lane: string) {
    const open = laneDrafts(lane).find(
      (draft) => !isSaving(draft) && !draft.title.trim()
    );
    const id = open?.id ?? `${draftPrefix}:${++draftSequence}`;
    if (!open)
      setDrafts((drafts) => [
        ...drafts.filter((draft) => !props.createComplete?.(draft.id)),
        { id, lane, title: '', saving: false },
      ]);
    draftElements.get(id)?.focus();
  }
  function cancelDraft(id: string, returnFocus: boolean) {
    const draft = drafts().find((draft) => draft.id === id);
    if (!draft || isSaving(draft)) return;
    removeDraft(id);
    if (returnFocus) newButtons.get(draft.lane)?.focus();
  }
  async function submitDraft(id: string, submission: DraftSubmission) {
    const draft = drafts().find((draft) => draft.id === id);
    if (!draft || isSaving(draft)) return;
    const title = draft.title.trim();
    if (canSetTitle() && !title && submission !== 'open') {
      cancelDraft(id, submission === 'next');
      return;
    }
    updateDraft(id, { saving: true });
    if (submission === 'next') startDraft(draft.lane);
    const saved = await props.onCreate(
      laneOf(draft.lane),
      title,
      id,
      ...(submission === 'open' ? [{ open: true } as const] : [])
    );
    if (saved) removeDraft(id);
    else updateDraft(id, { saving: false });
  }
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  props.controlsRef?.({
    addCard: () => {
      const lane =
        disposed || !props.canEdit || !props.groupColumn.writable
          ? undefined
          : lanes()[0];
      if (!lane) return false;
      startDraft(lane.key);
      return true;
    },
  });
  function move(rowId: string, lane: BoardGroup, next?: string) {
    const row = props.rows.find((row) => row.rowId === rowId);
    if (!row || !canMove()) return;
    props.onMove(rowId, lane.lane, next);
    setAnnouncement(`${cellTitle(row, titleField())} moved to ${lane.label}.`);
  }
  function reorder(from: string, to: string, edge?: 'before' | 'after') {
    if (from === to || !props.onLaneOrderChange) return;
    const order = props.board.lanes.map((lane) => laneId(lane.key));
    const source = order.indexOf(from);
    const target = order.indexOf(to);
    if (source < 0 || target < 0) return;
    order.splice(source, 1);
    const insertion =
      order.indexOf(to) +
      ((edge ?? (source < target ? 'after' : 'before')) === 'after' ? 1 : 0);
    if (insertion === source) return;
    order.splice(insertion, 0, from);
    props.onLaneOrderChange(
      order.flatMap((key) => {
        const lane = props.board.lanes.find(
          (entry) => laneId(entry.key) === key
        );
        return lane ? [lane.key] : [];
      })
    );
  }
  return (
    <div
      ref={viewport}
      class="min-h-0 flex-1 overflow-auto px-5 py-5 [&_button:focus-visible]:ring-2 [&_button:focus-visible]:ring-ink/50"
    >
      <p class="sr-only" role="status" aria-live="polite">
        {announcement()}
      </p>
      <Kanban
        getViewport={() => viewport}
        canDropCard={(drop) =>
          props.rows.some((row) => row.rowId === drop.id) &&
          lanes().some((lane) => lane.key === drop.toLane) &&
          canMove()
        }
        onDrop={(drop) => {
          if (drop.kind === 'lane') {
            reorder(drop.fromLane, drop.toLane, drop.edge);
            return;
          }
          const target = lanes().find((lane) => lane.key === drop.toLane);
          if (target) move(drop.id, target, drop.beforeId);
        }}
      >
        <div
          class="flex min-h-full min-w-fit items-start gap-4 pb-4"
          aria-label={`Board grouped by ${props.groupColumn.name}`}
        >
          <Key each={lanes()} by="key">
            {(group) => (
              <BoardLane
                group={group()}
                {...props}
                groups={lanes()}
                drafts={laneDrafts(group().key)}
                canSetTitle={canSetTitle()}
                titlePlaceholder={titleField()?.name ?? 'Record title'}
                acceptsRecords={props.canEdit && props.groupColumn.writable}
                canMove={canMove()}
                isSaving={isSaving}
                onStartDraft={() => startDraft(group().key)}
                onDraftInput={(id, title) => updateDraft(id, { title })}
                onSubmitDraft={(id, submission) =>
                  void submitDraft(id, submission)
                }
                onCancelDraft={cancelDraft}
                draftRef={(id, element) => draftElements.set(id, element)}
                newButtonRef={(element) => newButtons.set(group().key, element)}
                onMoveCard={(rowId, lane) => move(rowId, lane)}
                onReorder={(direction) => {
                  const index = lanes().findIndex(
                    (item) => item.key === group().key
                  );
                  const target =
                    lanes()[index + (direction === 'left' ? -1 : 1)];
                  if (target) reorder(group().key, target.key);
                }}
              />
            )}
          </Key>
          <Show
            when={
              props.canEdit && props.groupColumn.writable && props.onAddGroup
            }
          >
            {(addGroup) => (
              <NewBoardGroup column={props.groupColumn} onSave={addGroup()} />
            )}
          </Show>
        </div>
      </Kanban>
    </div>
  );
}

function BoardLane(
  props: Omit<DatabaseBoardProps, 'onMove'> & {
    group: BoardGroup;
    groups: BoardGroup[];
    drafts: CardDraft[];
    canSetTitle: boolean;
    titlePlaceholder: string;
    acceptsRecords: boolean;
    canMove: boolean;
    isSaving: (draft: CardDraft) => boolean;
    onStartDraft: () => void;
    onDraftInput: (id: string, title: string) => void;
    onSubmitDraft: (id: string, submission: DraftSubmission) => void;
    onCancelDraft: (id: string, returnFocus: boolean) => void;
    draftRef: (id: string, element: HTMLElement) => void;
    newButtonRef: (element: HTMLElement) => void;
    onReorder: (direction: 'left' | 'right') => void;
    onMoveCard: (rowId: string, lane: BoardGroup) => void;
  }
) {
  const editing = useOptionEditing();
  const hasOpenDraft = () =>
    props.drafts.some((draft) => !props.isSaving(draft));
  const savingCount = () => props.drafts.filter(props.isSaving).length;
  return (
    <KanbanLane
      id={props.group.key}
      label={`${props.group.label} lane`}
      canReorder={!!props.onLaneOrderChange}
      onKeyDown={(event) => {
        // "n" adds a card to the lane holding focus, as Enter does on its header.
        if (
          event.key !== 'n' ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey ||
          event.shiftKey ||
          !props.acceptsRecords ||
          !(event.target instanceof Element) ||
          !event.currentTarget.contains(event.target) ||
          isEditableInput(event.target)
        )
          return;
        event.preventDefault();
        props.onStartDraft();
      }}
    >
      <KanbanHandle
        label={
          props.onLaneOrderChange
            ? `Reorder ${props.group.label} lane`
            : `${props.group.label} lane`
        }
        class="mb-2 flex min-h-9 items-center gap-1.5 rounded px-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ink/50"
        onKeyDown={
          props.onLaneOrderChange || props.acceptsRecords
            ? (event) => {
                if (event.target !== event.currentTarget) return;
                if (
                  props.onLaneOrderChange &&
                  event.altKey &&
                  (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
                ) {
                  event.preventDefault();
                  event.stopPropagation();
                  props.onReorder(event.key === 'ArrowLeft' ? 'left' : 'right');
                } else if (props.acceptsRecords && event.key === 'Enter') {
                  event.preventDefault();
                  props.onStartDraft();
                }
              }
            : undefined
        }
      >
        <LanePill
          group={props.group}
          column={props.groupColumn}
          renderMentionValue={props.renderMentionValue}
        />
        <span class="text-xs tabular-nums text-ink-placeholder">
          {props.group.rows.length + savingCount()}
        </span>
        <span class="ml-auto flex items-center" data-kanban-no-drag>
          <Show when={editing}>
            {(optionEditing) => (
              <Show when={props.canEdit && props.group.option}>
                {(option) => (
                  <OptionEditor
                    column={props.groupColumn}
                    option={option()}
                    editing={optionEditing()}
                  />
                )}
              </Show>
            )}
          </Show>
          <Show when={props.onHideLane || props.onHideEmptyLanes}>
            <Dropdown>
              <Dropdown.Trigger
                variant="ghost"
                size="icon-xs"
                aria-label={`${props.group.label} lane menu`}
              >
                <CaretDownIcon class="size-3" />
              </Dropdown.Trigger>
              <Dropdown.Content class="min-w-44">
                <Show when={props.onHideLane}>
                  <Dropdown.Item
                    onSelect={() => props.onHideLane?.(props.group.lane)}
                  >
                    Hide lane
                  </Dropdown.Item>
                </Show>
                <Show when={props.onHideEmptyLanes}>
                  <Dropdown.CheckboxItem
                    checked={props.layout.hideEmptyLanes}
                    onChange={(checked) => props.onHideEmptyLanes?.(checked)}
                  >
                    Hide empty lanes
                  </Dropdown.CheckboxItem>
                </Show>
              </Dropdown.Content>
            </Dropdown>
          </Show>
          <Show when={props.acceptsRecords}>
            <Button
              size="icon-xs"
              label={`Add record to ${props.group.label}`}
              tooltipDisabled
              title={`Add record to ${props.group.label}`}
              onClick={props.onStartDraft}
            >
              <PlusIcon class="size-3.5" />
            </Button>
          </Show>
        </span>
      </KanbanHandle>
      <div class="flex min-h-10 flex-col gap-2">
        <div class="relative flex flex-col gap-2">
          <Key each={props.group.rows} by="rowId">
            {(row) => (
              <BoardCard
                row={row()}
                laneId={props.group.key}
                columns={props.columns}
                titleColumn={cardTitleColumn(props.layout, props.columns)}
                cardFields={props.layout.cardFields}
                renderCell={props.renderCell}
                renderTextValue={props.renderTextValue}
                renderMentionValue={props.renderMentionValue}
                groupColumn={props.groupColumn}
                groups={props.groups}
                canEdit={props.canMove}
                pending={props.rowPending(row().rowId)}
                onOpen={props.onOpen}
                onMove={props.onMoveCard}
              />
            )}
          </Key>
          <KanbanCardInsertion laneId={props.group.key} />
        </div>
        <Show when={props.group.rows.length === 0 && !props.drafts.length}>
          <div class="flex min-h-20 items-center justify-center rounded-lg border border-dashed border-edge-muted/70 px-4 text-xs text-ink-placeholder">
            {props.acceptsRecords ? 'Drop a record here' : 'No records'}
          </div>
        </Show>
        <Key each={props.drafts} by="id">
          {(draft) => (
            <NewBoardCard
              title={draft().title}
              titlePlaceholder={props.titlePlaceholder}
              canSetTitle={props.canSetTitle}
              saving={props.isSaving(draft())}
              ref={(element) => props.draftRef(draft().id, element)}
              onInput={(title) => props.onDraftInput(draft().id, title)}
              onSubmit={(submission) =>
                props.onSubmitDraft(draft().id, submission)
              }
              onCancel={(returnFocus) =>
                props.onCancelDraft(draft().id, returnFocus)
              }
            />
          )}
        </Key>
        <Show when={props.acceptsRecords && !hasOpenDraft()}>
          <Button
            ref={props.newButtonRef}
            variant="ghost"
            size="xs"
            aria-label="New record"
            class="h-7 justify-start gap-1.5 rounded-md px-1.5 text-ink-placeholder"
            onClick={props.onStartDraft}
          >
            <PlusIcon class="size-3.5" />
            New
          </Button>
        </Show>
      </div>
    </KanbanLane>
  );
}

/** A lane's name: its option's pill, its person's mention, or the empty lane's muted pill. */
function LanePill(props: {
  group: BoardGroup;
  column: DatabaseViewColumn;
  renderMentionValue?: (id: string, type: DatabaseEntityType) => JSX.Element;
}) {
  const person = () => {
    const lane = props.group.lane;
    const render = props.renderMentionValue;
    return lane.kind === 'user' && render ? { id: lane.id, render } : undefined;
  };
  return (
    <Show
      when={person()}
      fallback={
        <SelectPill
          label={props.group.label}
          column={props.column}
          empty={props.group.lane.kind === 'none'}
        />
      }
    >
      {(shown) => (
        <span class="min-w-0 truncate text-xs">
          {shown().render(shown().id, 'USER')}
        </span>
      )}
    </Show>
  );
}

function NewBoardGroup(props: {
  column: DatabaseViewColumn;
  onSave: (label: string) => Promise<DatabaseGroupAdded>;
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
    const number =
      props.column.dataType === 'SELECT_NUMBER'
        ? inferDatabaseNumber(entered)
        : undefined;
    if (props.column.dataType === 'SELECT_NUMBER' && number === undefined) {
      setError('Enter a valid number for this group.');
      return;
    }
    const label = number === undefined ? entered : String(number);
    if (
      isDatabaseNameTaken(
        label,
        props.column.options.map((option) => option.label)
      )
    ) {
      setError('A group with this name already exists.');
      return;
    }
    setPending(true);
    setError('');
    const added = await props.onSave(label);
    setPending(false);
    added.match(
      () => {
        setAdding(false);
        setDraft('');
      },
      (error) => setError(columnSchemaMessage(error))
    );
  }
  return (
    <div class="w-64 shrink-0 pt-2">
      <Show
        when={adding()}
        fallback={
          <Button
            size="xs"
            class="gap-2"
            onClick={() => {
              setDraft('');
              setAdding(true);
              queueMicrotask(() => input?.focus());
            }}
          >
            <PlusIcon class="size-3.5" />
            New group
          </Button>
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
            <Button
              size="sm"
              type="submit"
              disabled={pending() || !draft().trim()}
            >
              {pending() ? 'Adding…' : 'Add group'}
            </Button>
            <Button size="xs" disabled={pending()} onClick={cancel}>
              Cancel
            </Button>
          </div>
        </form>
      </Show>
    </div>
  );
}

function BoardCard(props: {
  row: DatabaseRow;
  laneId: string;
  columns: DatabaseViewColumn[];
  /** The column the card is titled by. */
  titleColumn: DatabaseViewColumn | undefined;
  /** The columns the card shows under its title, in order, when they hold something. */
  cardFields: string[];
  renderCell?: DatabaseTableProps['renderCell'];
  renderTextValue?: (value: string) => JSX.Element;
  renderMentionValue?: (id: string, type: DatabaseEntityType) => JSX.Element;
  groupColumn: DatabaseViewColumn;
  groups: BoardGroup[];
  canEdit: boolean;
  pending: boolean;
  onOpen: (rowId: string) => void;
  onMove: (rowId: string, lane: BoardGroup) => void;
}) {
  const title = () => cellTitle(props.row, props.titleColumn);
  const renderedTitle = (): JSX.Element => {
    const column = props.titleColumn;
    const value = column ? rowValue(props.row, column.id) : null;
    if (!column || value === null || value === '') return 'Unnamed';
    if (
      column.dataType === 'ENTITY' &&
      !column.isMultiSelect &&
      column.specificEntityType &&
      props.renderMentionValue
    )
      return props.renderMentionValue(String(value), column.specificEntityType);
    if (isWritableText(column) && props.renderTextValue)
      return props.renderTextValue(String(value));
    return title();
  };
  const metadata = () =>
    props.cardFields.flatMap((id) => {
      const column = props.columns.find((entry) => entry.id === id);
      return column &&
        column.id !== props.titleColumn?.id &&
        (props.renderCell || rowValue(props.row, column.id) !== null)
        ? [column]
        : [];
    });
  return (
    <KanbanCard
      id={props.row.rowId}
      laneId={props.laneId}
      canDrag={props.canEdit}
      pending={props.pending}
    >
      <div class="min-w-0 rounded-lg p-3">
        <Show
          when={props.renderCell && props.titleColumn}
          fallback={
            <button
              type="button"
              class="block w-full text-left"
              onClick={() => props.onOpen(props.row.rowId)}
              aria-label={`Open ${title()}`}
            >
              <span
                role="heading"
                aria-level={3}
                class="block break-words pr-10 text-sm font-semibold leading-5 text-ink"
              >
                {renderedTitle()}
              </span>
            </button>
          }
        >
          {(column) => (
            <div
              class="min-w-0 pr-16 text-sm font-semibold"
              data-kanban-no-drag
            >
              {props.renderCell?.(() => props.row, column)}
            </div>
          )}
        </Show>
        <Show when={metadata().length}>
          <div class="mt-3 flex flex-col gap-2 border-t border-edge-muted/50 pt-2.5">
            <For each={metadata()}>
              {(column) => (
                <div
                  class="flex min-w-0 items-center gap-2"
                  data-card-field
                  title={`${column.name}: ${formatCellValue(column, rowValue(props.row, column.id))}`}
                  data-kanban-no-drag={props.renderCell ? '' : undefined}
                >
                  <PropertyIcon
                    type={column.dataType}
                    relation={!!column.relation}
                    class="size-3 shrink-0 text-ink-placeholder"
                  />
                  <div class="min-w-0 flex-1" aria-label={column.name}>
                    <Show
                      when={props.renderCell}
                      fallback={
                        <Show
                          when={isOptionColumn(column)}
                          fallback={
                            <span class="truncate text-xs text-ink-muted">
                              {formatCellValue(
                                column,
                                rowValue(props.row, column.id)
                              )}
                            </span>
                          }
                        >
                          <span class="flex min-w-0 flex-wrap gap-1">
                            <For
                              each={databaseCellValues(
                                rowValue(props.row, column.id),
                                column
                              )}
                            >
                              {(value) => (
                                <SelectPill
                                  label={String(value)}
                                  column={column}
                                />
                              )}
                            </For>
                          </span>
                        </Show>
                      }
                    >
                      {(render) =>
                        render()(
                          () => props.row,
                          () => column
                        )
                      }
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
      <Show when={props.renderCell}>
        <Button
          size="icon-xs"
          label={`Open ${title()}`}
          tooltipDisabled
          class="absolute top-3 right-13"
          data-kanban-no-drag
          onClick={() => props.onOpen(props.row.rowId)}
        >
          <OpenIcon class="size-3.5" />
        </Button>
      </Show>
      <Show when={props.canEdit}>
        <div class="absolute top-3 right-2 flex items-start gap-0.5">
          <KanbanHandle label={`Drag ${title()}`}>
            <Button
              size="icon-xs"
              label={`Drag ${title()}`}
              tooltipDisabled
              class="touch-none opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
              title="Drag to another group, or use the Move menu"
              tabindex={-1}
            >
              <GripIcon class="size-4" />
            </Button>
          </KanbanHandle>
          <Dropdown>
            <Dropdown.Trigger
              variant="ghost"
              size="icon-xs"
              class="size-5 rounded text-ink-muted"
              aria-label={`Move ${title()}`}
              data-kanban-no-drag
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
                      disabled={group.key === props.laneId}
                      onSelect={() => props.onMove(props.row.rowId, group)}
                    >
                      <span class="flex-1">
                        <LanePill
                          group={group}
                          column={props.groupColumn}
                          renderMentionValue={props.renderMentionValue}
                        />
                      </span>
                      <Show when={group.key === props.laneId}>
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
    </KanbanCard>
  );
}

/** A card-shaped title field: Enter saves it, Escape or leaving it empty drops it. */
function NewBoardCard(props: {
  title: string;
  titlePlaceholder: string;
  canSetTitle: boolean;
  saving: boolean;
  ref: (element: HTMLElement) => void;
  onInput: (title: string) => void;
  onSubmit: (submission: DraftSubmission) => void;
  onCancel: (returnFocus: boolean) => void;
}) {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      props.onCancel(true);
    } else if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      props.onSubmit(event.shiftKey ? 'open' : 'next');
    }
  };
  return (
    <div class="rounded-lg border border-edge-muted bg-surface-3 p-3 shadow-sm">
      <Show
        when={!props.saving}
        fallback={
          <div role="status" aria-label="Saving new record">
            <p class="break-words text-[13px] font-medium leading-5 text-ink opacity-70">
              {props.title.trim() || 'Unnamed'}
            </p>
          </div>
        }
      >
        <Show
          when={props.canSetTitle}
          fallback={
            <button
              ref={props.ref}
              type="button"
              class="w-full text-left text-[13px] leading-5 text-ink-placeholder outline-none"
              onClick={() => props.onSubmit('open')}
              onKeyDown={(event) => {
                if (event.key === 'Escape') onKeyDown(event);
              }}
              onBlur={() => props.onCancel(false)}
            >
              Add record
            </button>
          }
        >
          <textarea
            ref={props.ref}
            rows={1}
            aria-label="New record title"
            aria-description="Enter to add, Shift+Enter to add and open, Escape to cancel"
            placeholder={`${props.titlePlaceholder}…`}
            value={props.title}
            maxlength={2000}
            class="block w-full resize-none bg-transparent text-[13px] font-medium leading-5 text-ink outline-none field-sizing-content placeholder:font-normal placeholder:text-ink-placeholder"
            onInput={(event) => props.onInput(event.currentTarget.value)}
            onKeyDown={onKeyDown}
            onBlur={() => {
              // Switching windows is not leaving the card.
              if (!document.hasFocus()) return;
              if (props.title.trim()) props.onSubmit('stay');
              else props.onCancel(false);
            }}
          />
        </Show>
      </Show>
    </div>
  );
}
