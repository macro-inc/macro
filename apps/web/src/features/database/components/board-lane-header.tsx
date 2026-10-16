import { Popover } from '@kobalte/core/popover';
import DotsIcon from '@phosphor/dots-three.svg';
import PlusIcon from '@phosphor/plus.svg';
import TrashIcon from '@phosphor/trash.svg';
import { ColorSwatches } from '@property/tags/components/color-swatches';
import { Button } from '@ui/components/Button';
import { DeleteDialog } from '@ui/components/DeleteDialog';
import { Dropdown } from '@ui/components/Dropdown';
import { createSignal, createUniqueId, type JSX, Show } from 'solid-js';
import { KanbanBoard } from '../../../components/kanban/kanban-board';
import { toast } from '../../../lib/core/component/Toast/Toast';
import {
  type OptionEditing,
  useOptionEditing,
} from '../context/option-editing';
import { inferDatabaseNumber } from '../core/column-inference';
import type { DatabaseOption, DatabaseViewColumn } from '../core/database-view';
import { isDatabaseNameTaken } from '../core/property-creation';
import { databaseOpMessage } from '../core/write-failure';
import { createInlineRename } from './inline-rename';

type EditableOption = {
  column: DatabaseViewColumn;
  option: DatabaseOption;
  editing: OptionEditing;
};

/** Option edits live on the dot and name; lane actions share one menu. */
export function BoardLaneHeader(props: {
  column: DatabaseViewColumn;
  option: DatabaseOption | null;
  label: string;
  count: number;
  canEdit: boolean;
  icon: JSX.Element;
  children: JSX.Element;
  onHide?: () => void;
  onAdd?: () => void;
}) {
  const editing = useOptionEditing();
  const editable = (): EditableOption | undefined =>
    props.canEdit && props.column.writable && props.option && editing
      ? { column: props.column, option: props.option, editing }
      : undefined;
  return (
    <>
      <Show when={editable()} fallback={props.icon}>
        {(option) => <LaneColor option={option()}>{props.icon}</LaneColor>}
      </Show>
      <Show when={editable()} fallback={props.children}>
        {(option) => <LaneName option={option()} />}
      </Show>
      <KanbanBoard.ColumnCount
        count={props.count}
        aria-label={`${props.count} records`}
      />
      <span
        class="ml-auto flex shrink-0 items-center gap-0.5"
        data-kanban-no-drag
      >
        <Show when={props.onHide || editable()}>
          <LaneMenu
            label={props.label}
            option={editable()}
            onHide={props.onHide}
          />
        </Show>
        <Show when={props.onAdd}>
          <Button
            size="icon-xs"
            label={`Add record to ${props.label}`}
            tooltipDisabled
            title={`Add record to ${props.label}`}
            onClick={props.onAdd}
          >
            <PlusIcon class="size-3.5" />
          </Button>
        </Show>
      </span>
    </>
  );
}

function LaneName(props: { option: EditableOption }) {
  const errorId = createUniqueId();
  let input: HTMLInputElement | undefined;
  let trigger: HTMLButtonElement | undefined;
  const rename = createInlineRename({
    name: (current: EditableOption) => current.option.label,
    rename: (current, label) =>
      current.editing.update(current.column.id, current.option.id, { label }),
    failureMessage: (failure) => databaseOpMessage(failure, 'this group'),
    emptyName: { message: 'Enter a group name.', onBlur: 'cancel' },
    validate: (label, current) => {
      if (
        isDatabaseNameTaken(
          label,
          current.column.options
            .filter((entry) => entry.id !== current.option.id)
            .map((entry) => entry.label)
        )
      )
        return 'Another option already has this name.';
      if (
        current.column.dataType === 'SELECT_NUMBER' &&
        inferDatabaseNumber(label) === undefined
      )
        return 'Enter a number.';
    },
    input: () => input,
    restoreFocus: () => trigger?.focus(),
  });
  return (
    <div class="relative min-w-0" data-kanban-no-drag>
      {/* Keep the title in flow so the field starts at the same size. */}
      <KanbanBoard.ColumnLabel title={props.option.option.label}>
        <button
          ref={trigger}
          type="button"
          class="block max-w-full truncate rounded text-left outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ink/50"
          classList={{ invisible: !!rename.target() }}
          aria-hidden={rename.target() ? true : undefined}
          tabIndex={rename.target() ? -1 : 0}
          aria-label={`Rename ${props.option.option.label}`}
          onClick={() => rename.begin(props.option)}
        >
          {rename.target()
            ? rename.draft() || '\u00a0'
            : props.option.option.label}
        </button>
      </KanbanBoard.ColumnLabel>
      <Show when={rename.target()}>
        <input
          ref={input}
          value={rename.draft()}
          maxlength={200}
          aria-label="Group name"
          aria-invalid={!!rename.error()}
          aria-describedby={rename.error() ? errorId : undefined}
          readOnly={rename.pending()}
          class="absolute inset-0 h-full min-w-0 w-full rounded border-0 bg-input p-0 text-sm font-medium text-ink outline-none focus:ring-2 focus:ring-ink/50"
          onFocus={(event) => {
            const field = event.currentTarget;
            // Run after inline rename selects the name, which scrolls long inputs.
            queueMicrotask(() => {
              if (
                field.selectionStart === 0 &&
                field.selectionEnd === field.value.length
              )
                field.scrollLeft = 0;
            });
          }}
          onInput={(event) => rename.setDraft(event.currentTarget.value)}
          onBlur={() => void rename.save(false)}
          onKeyDown={(event) => {
            if (event.isComposing) return;
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              rename.cancel(true);
            } else if (event.key === 'Enter') {
              event.preventDefault();
              event.stopPropagation();
              void rename.save(true);
            }
          }}
        />
        <Show when={rename.error()}>
          <p
            id={errorId}
            role="alert"
            class="absolute top-full left-0 z-action-menu mt-1 w-56 rounded-md border border-edge-muted bg-panel p-2 text-xs text-failure-ink shadow-sm"
          >
            {rename.error()}
          </p>
        </Show>
      </Show>
    </div>
  );
}

function LaneColor(props: { option: EditableOption; children: JSX.Element }) {
  const [error, setError] = createSignal('');
  return (
    <Popover
      placement="bottom-start"
      gutter={6}
      onOpenChange={() => setError('')}
    >
      <Popover.Trigger
        as={Button}
        size="icon-xs"
        label={`Change ${props.option.option.label} color`}
        tooltipDisabled
        data-kanban-no-drag
      >
        {props.children}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content class="menu-surface z-action-menu w-56 p-2.5 text-xs outline-none">
          <Popover.Title class="mb-2 font-medium">Group color</Popover.Title>
          <ColorSwatches
            size="sm"
            value={props.option.option.color}
            onChange={(color) =>
              void props.option.editing
                .update(props.option.column.id, props.option.option.id, {
                  color: color.color,
                })
                .mapErr((failure) =>
                  setError(databaseOpMessage(failure, 'this group'))
                )
            }
          />
          <Show when={props.option.column.sharedOutsideDatabase}>
            <p class="mt-2 text-ink-muted">
              Changes everywhere this property is used.
            </p>
          </Show>
          <Show when={error()}>
            <p role="alert" class="mt-2 text-failure-ink">
              {error()}
            </p>
          </Show>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}

function LaneMenu(props: {
  label: string;
  option?: EditableOption;
  onHide?: () => void;
}) {
  const [confirming, setConfirming] = createSignal(false);
  const [pending, setPending] = createSignal(false);
  let deleteRequested = false;
  function finishMenuClose() {
    if (!deleteRequested) return;
    deleteRequested = false;
    // Let the menu release its modal state and restore focus before the dialog opens.
    queueMicrotask(() => setConfirming(true));
  }
  async function remove() {
    const option = props.option;
    if (!option || pending()) return;
    setPending(true);
    const result = await option.editing.remove(
      option.column.id,
      option.option.id
    );
    setPending(false);
    result.match(
      () => setConfirming(false),
      (failure) => toast.failure(databaseOpMessage(failure, 'this group'))
    );
  }
  return (
    <>
      <Dropdown>
        <Dropdown.Trigger
          variant="ghost"
          size="icon-xs"
          aria-label={`${props.label} lane menu`}
        >
          <DotsIcon class="size-4" />
        </Dropdown.Trigger>
        <Dropdown.Content class="min-w-44" onCloseAutoFocus={finishMenuClose}>
          <Dropdown.Group>
            <Show when={props.onHide}>
              <Dropdown.Item onSelect={props.onHide}>Hide lane</Dropdown.Item>
            </Show>
            <Show when={props.option}>
              <Dropdown.Item
                class="text-failure-ink"
                onSelect={() => {
                  deleteRequested = true;
                }}
              >
                <TrashIcon class="size-3.5" />
                Delete group
              </Dropdown.Item>
            </Show>
          </Dropdown.Group>
        </Dropdown.Content>
      </Dropdown>
      <DeleteDialog
        open={confirming()}
        onOpenChange={setConfirming}
        pending={pending()}
        title={`Delete “${props.label}”?`}
        deleteLabel={pending() ? 'Deleting…' : 'Delete group'}
        onDelete={() => void remove()}
        body={
          <>
            <p>
              Cells using “{props.label}” will be cleared. Records will not be
              deleted.
            </p>
            <Show when={props.option?.column.sharedOutsideDatabase}>
              <p class="mt-2">
                This change affects everywhere this property is used.
              </p>
            </Show>
          </>
        }
      />
    </>
  );
}
