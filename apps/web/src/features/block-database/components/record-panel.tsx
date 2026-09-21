import { Dialog } from '@kobalte/core/dialog';
import ArrowDownIcon from '@phosphor/arrow-down.svg';
import ArrowUpIcon from '@phosphor/arrow-up.svg';
import EyeSlashIcon from '@phosphor/eye-slash.svg';
import RowsIcon from '@phosphor/rows.svg';
import TrashIcon from '@phosphor/trash-simple.svg';
import XIcon from '@phosphor/x.svg';
import { Key } from '@solid-primitives/keyed';
import { type Accessor, createSignal, type JSX, Show } from 'solid-js';
import type {
  GridCellControl,
  GridCellEditorOptions,
} from '../component/GridCell';
import type { DatabaseViewColumn } from '../core/database-view';
import {
  canEditCell,
  type DatabaseRow,
  rowTitle,
  titleColumn,
} from '../core/table';
import { PropertyIcon } from './property-icon';

type RecordPanelProps = {
  row: DatabaseRow;
  tableName: string;
  columns: DatabaseViewColumn[];
  canEdit: boolean;
  pending: boolean;
  outsideViewReason?: string;
  saveError?: string;
  onRetry: () => void;
  position: number;
  total: number;
  renderCell: (
    row: Accessor<DatabaseRow>,
    column: Accessor<DatabaseViewColumn>,
    options?: GridCellEditorOptions
  ) => JSX.Element;
  onClose: () => void;
  onNavigate: (delta: number) => void;
  onDelete: (rowId: string) => Promise<boolean>;
  returnFocus?: HTMLElement;
};

export function RecordPanel(props: RecordPanelProps) {
  const [deleteRowId, setDeleteRowId] = createSignal<string>();
  let focusTitle: (() => void) | undefined;
  function navigate(delta: number) {
    setDeleteRowId(undefined);
    props.onNavigate(delta);
  }
  async function remove() {
    const rowId = deleteRowId();
    if (!props.canEdit || props.pending || rowId !== props.row.rowId) return;
    await props.onDelete(rowId);
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-modal bg-modal-overlay/30 backdrop-blur-[1px]" />
        <Dialog.Content
          class="portal-scope fixed top-1/2 left-1/2 z-modal flex max-h-[min(42rem,85dvh)] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-edge-muted bg-panel text-ink shadow-xl outline-none"
          onOpenAutoFocus={(event) => {
            // Keep keyboard editing in the record body, before the header controls.
            event.preventDefault();
            focusTitle?.();
          }}
          onEscapeKeyDown={(event) => {
            if (
              event.target instanceof HTMLElement &&
              event.target.closest('input:not([type="checkbox"]), textarea')
            )
              event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            // Records open from one of many row buttons rather than a Dialog.Trigger.
            if (props.returnFocus?.isConnected) {
              event.preventDefault();
              props.returnFocus.focus();
            }
          }}
        >
          <div class="flex h-11 shrink-0 items-center gap-2 border-b border-edge-muted px-4">
            <RowsIcon class="size-4 text-ink-muted" />
            <span class="min-w-0 flex-1 truncate text-xs text-ink-muted">
              {props.tableName}
            </span>
            <span class="text-[11px] text-ink-placeholder" role="status">
              {props.pending
                ? 'Saving…'
                : props.saveError
                  ? 'Change not saved'
                  : props.canEdit
                    ? 'Saved'
                    : 'View only'}
            </span>
            <Show when={props.position >= 0}>
              <span class="mr-1 text-[11px] tabular-nums text-ink-placeholder">
                {props.position + 1} of {props.total}
              </span>
            </Show>
            <button
              type="button"
              aria-label="Previous record"
              disabled={props.position <= 0}
              class="rounded p-1.5 text-ink-muted hover:bg-hover disabled:opacity-30"
              onClick={() => navigate(-1)}
            >
              <ArrowUpIcon class="size-3.5" />
            </button>
            <button
              type="button"
              aria-label="Next record"
              disabled={props.position < 0 || props.position >= props.total - 1}
              class="rounded p-1.5 text-ink-muted hover:bg-hover disabled:opacity-30"
              onClick={() => navigate(1)}
            >
              <ArrowDownIcon class="size-3.5" />
            </button>
            <Dialog.CloseButton
              aria-label="Close record"
              class="ml-1 rounded p-1.5 text-ink-muted hover:bg-hover"
            >
              <XIcon class="size-4" />
            </Dialog.CloseButton>
          </div>
          <div class="min-h-0 overflow-auto px-5 py-4">
            <Dialog.Title class="sr-only">
              {rowTitle(props.row, props.columns)}
            </Dialog.Title>
            <Dialog.Description class="sr-only">
              Record details
            </Dialog.Description>
            <Key each={[props.row]} by="rowId">
              {(row) => (
                <RecordFields
                  row={row()}
                  columns={props.columns}
                  canEdit={props.canEdit}
                  outsideViewReason={props.outsideViewReason}
                  renderCell={props.renderCell}
                  onFocusReady={(focus) => {
                    focusTitle = focus;
                  }}
                />
              )}
            </Key>
            <Show when={props.canEdit}>
              <div class="mt-3 flex min-h-8 items-center border-t border-edge-muted/60 pt-2">
                <Show
                  when={deleteRowId() === props.row.rowId}
                  fallback={
                    <button
                      type="button"
                      class="flex items-center gap-1.5 rounded px-1 py-1 text-xs text-ink-muted hover:text-failure-ink"
                      onClick={() => setDeleteRowId(props.row.rowId)}
                    >
                      <TrashIcon class="size-3.5" /> Delete record
                    </button>
                  }
                >
                  <span class="mr-auto text-xs text-ink-muted">
                    Delete this record?
                  </span>
                  <button
                    type="button"
                    disabled={props.pending}
                    class="rounded px-2 py-1 text-xs font-medium text-failure-ink disabled:opacity-50"
                    onClick={() => void remove()}
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    class="rounded px-2 py-1 text-xs text-ink-muted hover:bg-hover"
                    onClick={() => setDeleteRowId(undefined)}
                  >
                    Cancel
                  </button>
                </Show>
              </div>
            </Show>
          </div>
          <Show when={props.saveError}>
            <div
              role="alert"
              class="flex items-center gap-3 border-t border-warning/20 bg-warning/5 px-5 py-3 text-xs text-ink-muted"
            >
              <span class="flex-1">{props.saveError}</span>
              <button
                type="button"
                disabled={props.pending}
                class="rounded px-2 py-1 font-medium text-ink hover:bg-hover disabled:opacity-40"
                onClick={props.onRetry}
              >
                Retry
              </button>
            </div>
          </Show>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}

function RecordFields(
  props: Pick<
    RecordPanelProps,
    'row' | 'columns' | 'canEdit' | 'outsideViewReason' | 'renderCell'
  > & {
    onFocusReady: (focus: () => void) => void;
  }
) {
  const title = () => titleColumn(props.columns);
  const initialTitle = title();
  const initialEditColumnId =
    props.canEdit && initialTitle && canEditCell(initialTitle)
      ? initialTitle.id
      : undefined;
  const fields = () =>
    props.columns.filter((column) => column.id !== title()?.id);
  const controls = new Map<string, GridCellControl>();
  function registerTitleFocus(focus: () => void) {
    props.onFocusReady(focus);
    queueMicrotask(focus);
  }
  function options(
    column: Accessor<DatabaseViewColumn>
  ): GridCellEditorOptions {
    return {
      get initialEdit() {
        return column().id === initialEditColumnId;
      },
      onReady: (control) => {
        if (control) {
          controls.set(column().id, control);
          if (column().id === title()?.id) registerTitleFocus(control.focus);
        } else controls.delete(column().id);
      },
      onNavigate: (direction) => {
        if (!props.canEdit) return false;
        const ordered = [...(title() ? [title()!] : []), ...fields()].filter(
          canEditCell
        );
        const next =
          ordered[
            ordered.findIndex((field) => field.id === column().id) + direction
          ];
        const control = next && controls.get(next.id);
        if (!control) return false;
        control.edit();
        return true;
      },
    };
  }
  return (
    <>
      <Show
        when={title()}
        fallback={
          <h2
            ref={(element) => {
              registerTitleFocus(() => element.focus());
            }}
            tabindex={-1}
            class="text-lg font-semibold outline-none"
          >
            {rowTitle(props.row, props.columns)}
          </h2>
        }
      >
        <Key each={title() ? [title()!] : []} by="id">
          {(column) => (
            <div class="-mx-2.5 mb-3 [&_button]:text-lg [&_button]:font-semibold [&_input]:text-lg [&_input]:font-semibold">
              {props.renderCell(() => props.row, column, options(column))}
            </div>
          )}
        </Key>
      </Show>
      <Show when={props.outsideViewReason}>
        <div
          role="status"
          class="mb-3 flex items-start gap-2 rounded-md bg-hover/50 px-2.5 py-2 text-xs leading-5 text-ink-muted"
        >
          <EyeSlashIcon class="mt-0.5 size-3.5 shrink-0" />
          <span>{props.outsideViewReason}</span>
        </div>
      </Show>
      <div class="flex flex-col gap-0.5">
        <Key each={fields()} by="id">
          {(column) => (
            <div class="grid min-h-9 grid-cols-[minmax(5rem,0.75fr)_minmax(0,1.5fr)] items-start gap-2">
              <div
                class="flex min-w-0 items-center gap-2 pt-2.5 text-xs text-ink-muted"
                title={column().name}
              >
                <PropertyIcon
                  type={column().dataType}
                  relation={!!column().relation}
                  entityType={column().specificEntityType}
                />
                <span class="truncate">{column().name}</span>
              </div>
              <div class="min-w-0">
                {props.renderCell(() => props.row, column, options(column))}
              </div>
            </div>
          )}
        </Key>
      </div>
    </>
  );
}

export function DeleteRecordDialog(props: {
  name: string;
  pending: boolean;
  error?: string;
  onClose: () => void;
  onDelete: () => void;
  returnFocus?: HTMLElement;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !props.pending) props.onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-modal bg-modal-overlay/30" />
        <Dialog.Content
          class="portal-scope fixed top-1/2 left-1/2 z-modal w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-edge-muted bg-panel p-5 text-ink shadow-xl outline-none"
          onCloseAutoFocus={(event) => {
            if (props.returnFocus?.isConnected) {
              event.preventDefault();
              props.returnFocus.focus();
            }
          }}
        >
          <Dialog.Title class="text-base font-semibold">
            Delete record?
          </Dialog.Title>
          <Dialog.Description class="mt-2 break-words text-sm text-ink-muted">
            “{props.name}” will be deleted.
          </Dialog.Description>
          <Show when={props.error}>
            <p role="alert" class="mt-3 text-xs text-failure-ink">
              {props.error}
            </p>
          </Show>
          <div class="mt-5 flex justify-end gap-2">
            <button
              type="button"
              disabled={props.pending}
              class="rounded-md px-3 py-1.5 text-sm hover:bg-hover disabled:opacity-50"
              onClick={props.onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={props.pending}
              class="rounded-md bg-failure/10 px-3 py-1.5 text-sm font-medium text-failure-ink disabled:opacity-50"
              onClick={props.onDelete}
            >
              {props.pending ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}
