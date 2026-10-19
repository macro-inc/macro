import { fireAndForget } from '@core/util/fireAndForget';
import OpenIcon from '@phosphor/arrows-out-simple.svg';
import CheckIcon from '@phosphor/check.svg';
import EmptyIcon from '@phosphor/circle-dashed.svg';
import GripIcon from '@phosphor/dots-six-vertical.svg';
import DotsIcon from '@phosphor/dots-three.svg';
import PlusIcon from '@phosphor/plus.svg';
import { TagDot } from '@property/tags/TagDot';
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
import { KanbanHandle } from '../../../components/kanban/kanban';
import { KanbanBoard } from '../../../components/kanban/kanban-board';
import type { KanbanBoardColumn } from '../../../components/kanban/kanban-board-types';
import type {
  Board,
  LaneKey,
} from '../../../lib/core/database-sql/generated/types';
import { isEditableInput } from '../../../lib/core/util/isEditableInput';
import type { DatabaseEntityType } from '../core/column-inference';
import {
  type DatabaseOption,
  type DatabaseViewColumn,
  databaseCellValues,
  isOptionColumn,
} from '../core/database-view';
import {
  cellTitle,
  type DatabaseRow,
  formatCellValue,
  isWritableText,
  rowValue,
} from '../core/table';
import { cardTitleColumn, laneId, laneLabel } from '../core/views';
import { BoardLaneHeader } from './board-lane-header';
import type { DatabaseTableProps } from './database-table';
import { NewBoardGroup } from './new-board-group';
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
  onMove?: (rowId: string, lane: LaneKey, next?: string) => void;
  /** The lanes, every one, in their new order. */
  onLaneOrderChange?: (order: LaneKey[]) => void;
  onHideLane?: (lane: LaneKey) => void;
  /** Resolves whether the record was saved. `open` asks to show it once it is. */
  onCreate: (
    lane: LaneKey,
    title: string,
    intentId: string,
    options?: { open: true }
  ) => Promise<boolean>;
  /** Starts a record in `lane` in the host's form in place of an inline card. */
  onCompose?: (lane: LaneKey) => void;
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
  let boardControls:
    | { revealColumn: (id: string) => void; revealFooter: (id: string) => void }
    | undefined;
  let focusDraft: string | undefined;
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
  const columns = createMemo((): KanbanBoardColumn[] =>
    lanes().map((group) => ({
      id: group.key,
      label: `${group.label} lane`,
      itemIds: group.rows.map((row) => row.rowId),
    }))
  );
  const groupsById = createMemo(
    () => new Map(lanes().map((group) => [group.key, group]))
  );
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
  const canMove = () =>
    props.canEdit && props.groupColumn.writable && !!props.onMove;
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
    if (focusDraft === id) focusDraft = undefined;
    draftElements.delete(id);
    setDrafts((drafts) => drafts.filter((draft) => draft.id !== id));
  };
  function startDraft(lane: string) {
    if (props.onCompose) {
      props.onCompose(laneOf(lane));
      return;
    }
    const open = laneDrafts(lane).find(
      (draft) => !isSaving(draft) && !draft.title.trim()
    );
    const id = open?.id ?? `${draftPrefix}:${++draftSequence}`;
    focusDraft = id;
    if (!open)
      setDrafts((drafts) => [
        ...drafts.filter((draft) => !props.createComplete?.(draft.id)),
        { id, lane, title: '', saving: false },
      ]);
    boardControls?.revealFooter(lane);
    const element = draftElements.get(id);
    if (element?.isConnected) {
      focusDraft = undefined;
      element.focus();
      element.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
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
    props.onMove?.(rowId, lane.lane, next);
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
    <div class="flex min-h-0 min-w-0 flex-1 flex-col [&_button:focus-visible]:ring-2 [&_button:focus-visible]:ring-ink/50">
      <p class="sr-only" role="status" aria-live="polite">
        {announcement()}
      </p>
      <KanbanBoard.Root
        mode="ordered"
        columns={columns()}
        animationScope={JSON.stringify([
          props.groupColumn.id,
          props.layout.title,
          props.layout.cardFields,
        ])}
        controlsRef={(controls) => {
          boardControls = controls;
        }}
        canMove={(drop) =>
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
        <KanbanBoard.Columns
          aria-label={`Board grouped by ${props.groupColumn.name}`}
          endColumn={
            props.canEdit && props.groupColumn.writable && props.onAddGroup
              ? () => (
                  <NewBoardGroup
                    column={props.groupColumn}
                    onSave={props.onAddGroup!}
                  />
                )
              : undefined
          }
        >
          {(column) => (
            <Show when={groupsById().get(column().id)}>
              {(group) => (
                <BoardLane
                  group={group()}
                  {...props}
                  groups={lanes()}
                  drafts={laneDrafts(group().key)}
                  canSetTitle={canSetTitle()}
                  titlePlaceholder={titleField()?.name ?? 'Record title'}
                  acceptsRecords={canMove()}
                  canMove={canMove()}
                  isSaving={isSaving}
                  onStartDraft={() => startDraft(group().key)}
                  onDraftInput={(id, title) => updateDraft(id, { title })}
                  onSubmitDraft={(id, submission) =>
                    fireAndForget(submitDraft(id, submission), 'database')
                  }
                  onCancelDraft={cancelDraft}
                  draftRef={(id, element) => {
                    draftElements.set(id, element);
                    queueMicrotask(() => {
                      if (focusDraft !== id || !element.isConnected) return;
                      focusDraft = undefined;
                      element.focus();
                      element.scrollIntoView?.({
                        block: 'nearest',
                        inline: 'nearest',
                      });
                    });
                  }}
                  newButtonRef={(element) =>
                    newButtons.set(group().key, element)
                  }
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
            </Show>
          )}
        </KanbanBoard.Columns>
      </KanbanBoard.Root>
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
  const hasOpenDraft = () =>
    props.drafts.some((draft) => !props.isSaving(draft));
  const savingCount = () => props.drafts.filter(props.isSaving).length;
  return (
    <KanbanBoard.Column
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
      <KanbanBoard.Header>
        <KanbanHandle
          label={
            props.onLaneOrderChange
              ? `Reorder ${props.group.label} lane`
              : `${props.group.label} lane`
          }
          class="flex min-h-7 min-w-0 w-full items-center gap-2 rounded outline-none focus-visible:ring-2 focus-visible:ring-ink/50"
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
                    props.onReorder(
                      event.key === 'ArrowLeft' ? 'left' : 'right'
                    );
                  } else if (props.acceptsRecords && event.key === 'Enter') {
                    event.preventDefault();
                    props.onStartDraft();
                  }
                }
              : undefined
          }
        >
          <BoardLaneHeader
            column={props.groupColumn}
            option={props.group.option}
            label={props.group.label}
            count={props.group.rows.length + savingCount()}
            canEdit={props.canEdit}
            icon={<LaneIcon group={props.group} column={props.groupColumn} />}
            onHide={
              props.onHideLane
                ? () => props.onHideLane?.(props.group.lane)
                : undefined
            }
            onAdd={props.acceptsRecords ? props.onStartDraft : undefined}
          >
            <LaneHeading
              group={props.group}
              renderMentionValue={props.renderMentionValue}
            />
          </BoardLaneHeader>
        </KanbanHandle>
      </KanbanBoard.Header>
      <KanbanBoard.Cards
        itemsLabel="records"
        empty={
          <Show when={!props.drafts.length}>
            <p class="px-2 py-6 text-center text-xs text-ink-extra-muted">
              {props.acceptsRecords ? 'Drop a record here' : 'No records'}
            </p>
          </Show>
        }
        footer={
          <div class="flex flex-col gap-3 pt-3">
            <Key each={props.drafts} by="id">
              {(draft) => (
                <NewBoardCard
                  title={draft().title}
                  titlePlaceholder={props.titlePlaceholder}
                  icon={
                    <LaneIcon group={props.group} column={props.groupColumn} />
                  }
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
                size="lg"
                aria-label="New record"
                class="justify-start rounded-md text-sm text-ink-placeholder"
                onClick={props.onStartDraft}
              >
                <PlusIcon class="size-3.5" />
                New
              </Button>
            </Show>
          </div>
        }
      >
        {(id) => (
          <Show when={props.group.rows.find((row) => row.rowId === id)}>
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
          </Show>
        )}
      </KanbanBoard.Cards>
    </KanbanBoard.Column>
  );
}

function LaneIcon(props: { group: BoardGroup; column: DatabaseViewColumn }) {
  return (
    <span
      aria-hidden="true"
      class="flex size-4 shrink-0 items-center justify-center"
    >
      <Show
        when={props.group.lane.kind !== 'none'}
        fallback={<EmptyIcon class="size-4 text-ink-muted" />}
      >
        <Show
          when={props.group.option || props.column.dataType === 'TAG'}
          fallback={
            <PropertyIcon
              type={props.column.dataType}
              entityType={props.column.specificEntityType}
              class="size-4 text-ink-muted"
            />
          }
        >
          <TagDot
            color={props.group.option?.color ?? undefined}
            class="size-2.5"
          />
        </Show>
      </Show>
    </span>
  );
}

function LaneHeading(props: {
  group: BoardGroup;
  renderMentionValue?: (id: string, type: DatabaseEntityType) => JSX.Element;
}) {
  const person = () => {
    const lane = props.group.lane;
    const render = props.renderMentionValue;
    return lane.kind === 'user' && render ? { id: lane.id, render } : undefined;
  };
  return (
    <KanbanBoard.ColumnLabel title={props.group.label}>
      <Show when={person()} fallback={props.group.label}>
        {(shown) => shown().render(shown().id, 'USER')}
      </Show>
    </KanbanBoard.ColumnLabel>
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
    <KanbanBoard.Card
      id={props.row.rowId}
      canDrag={props.canEdit}
      pending={props.pending}
    >
      <div
        class="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] gap-x-2 p-3"
        data-card-grid
      >
        <KanbanBoard.CardHeader class="col-span-full grid-cols-subgrid p-0 last:pb-0">
          <Show
            when={props.canEdit}
            fallback={<span aria-hidden="true" class="size-6" />}
          >
            <KanbanHandle label={`Drag ${title()}`}>
              <Button
                size="icon-xs"
                label={`Drag ${title()}`}
                tooltipDisabled
                class="size-6 touch-none text-ink-muted"
                title="Drag to another group, or use the Move menu"
                tabindex={-1}
              >
                <GripIcon class="size-4" />
              </Button>
            </KanbanHandle>
          </Show>
          <Show
            when={props.renderCell && props.titleColumn}
            fallback={
              <button
                type="button"
                class="min-w-0 break-words text-left text-sm font-medium leading-6 text-ink hover:underline"
                onClick={() => props.onOpen(props.row.rowId)}
                aria-label={`Open ${title()}`}
              >
                <span role="heading" aria-level={3}>
                  {renderedTitle()}
                </span>
              </button>
            }
          >
            {(column) => (
              <div
                class="min-w-0 text-sm font-medium leading-6 text-ink [&_[data-cell-text-editor]]:min-h-6 [&_[data-cell-text-editor]]:break-words [&_[data-cell-text-editor]]:border-0 [&_[data-cell-text-editor]]:bg-transparent [&_[data-cell-text-editor]]:p-0 [&_[data-cell-text-editor]]:text-sm [&_[data-cell-text-editor]]:font-medium [&_[data-cell-text-editor]]:leading-6 [&_[data-cell-text-editor]]:ring-0 [&_[data-cell-text-editor][aria-invalid=true]]:ring-1 [&_[data-cell-text-editor][aria-invalid=true]]:ring-failure"
                data-kanban-no-drag
              >
                {props.renderCell?.(() => props.row, column)}
              </div>
            )}
          </Show>
          <KanbanBoard.CardActions>
            <Show when={props.renderCell}>
              <Button
                size="icon-xs"
                label={`Open ${title()}`}
                tooltipDisabled
                title="Open record details"
                onClick={() => props.onOpen(props.row.rowId)}
              >
                <OpenIcon class="size-3.5" />
              </Button>
            </Show>
            <Show when={props.canEdit}>
              <Dropdown>
                <Dropdown.Trigger
                  variant="ghost"
                  size="icon-xs"
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
            </Show>
          </KanbanBoard.CardActions>
        </KanbanBoard.CardHeader>
        <Show when={metadata().length}>
          <KanbanBoard.CardFields class="col-start-2 col-span-2 p-0 pt-2">
            <Key each={metadata()} by="id">
              {(column) => (
                <div
                  class="flex min-h-6 min-w-0 max-w-40 items-center gap-2 rounded pl-1.5 hover:bg-hover has-[[aria-invalid=true]]:ring-1 has-[[aria-invalid=true]]:ring-failure"
                  data-card-field
                  title={`${column().name}: ${formatCellValue(column(), rowValue(props.row, column().id))}`}
                  data-kanban-no-drag={props.renderCell ? '' : undefined}
                >
                  <PropertyIcon
                    type={column().dataType}
                    entityType={column().specificEntityType}
                    relation={!!column().relation}
                    class="size-3.5 shrink-0 text-ink-placeholder"
                  />
                  <div
                    class="min-w-0 flex-1 [&_[data-cell-text-editor]]:h-6 [&_[data-cell-text-editor]]:min-h-6 [&_[data-cell-text-editor]]:max-h-6 [&_[data-cell-text-editor]]:overflow-auto [&_[data-cell-text-editor]]:whitespace-pre [&_[data-cell-text-editor]]:[scrollbar-width:none] [&_[data-cell-text-editor]]:border-0 [&_[data-cell-text-editor]]:bg-transparent [&_[data-cell-text-editor]]:px-0 [&_[data-cell-text-editor]]:py-0.5 [&_[data-cell-text-editor]]:text-xs [&_[data-cell-text-editor]]:[font-weight:inherit] [&_[data-cell-text-editor]]:leading-5 [&_[data-cell-text-editor]]:ring-0"
                    classList={{
                      'font-medium': column().dataType === 'STRING',
                      // Reserve usable editor space even when the value is empty.
                      'min-w-16':
                        !!props.renderCell &&
                        (column().dataType === 'STRING' ||
                          column().dataType === 'NUMBER'),
                    }}
                    aria-label={column().name}
                  >
                    <Show
                      when={props.renderCell}
                      fallback={
                        <Show
                          when={isOptionColumn(column())}
                          fallback={
                            <span class="block truncate text-xs text-ink-muted">
                              {formatCellValue(
                                column(),
                                rowValue(props.row, column().id)
                              )}
                            </span>
                          }
                        >
                          <span class="flex min-w-0 flex-wrap gap-1">
                            <For
                              each={databaseCellValues(
                                rowValue(props.row, column().id),
                                column()
                              )}
                            >
                              {(value) => (
                                <SelectPill
                                  label={String(value)}
                                  column={column()}
                                />
                              )}
                            </For>
                          </span>
                        </Show>
                      }
                    >
                      {(render) =>
                        render()(() => props.row, column, {
                          preserveSize: true,
                        })
                      }
                    </Show>
                  </div>
                </div>
              )}
            </Key>
          </KanbanBoard.CardFields>
        </Show>
      </div>
    </KanbanBoard.Card>
  );
}

/** A card-shaped title field: Enter saves it, Escape or leaving it empty drops it. */
function NewBoardCard(props: {
  title: string;
  icon: JSX.Element;
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
    <div class="rounded-lg border border-edge-muted bg-surface-3 shadow-sm">
      <KanbanBoard.CardHeader>
        <span class="flex size-6 items-center justify-center">
          {props.icon}
        </span>
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
      </KanbanBoard.CardHeader>
    </div>
  );
}
