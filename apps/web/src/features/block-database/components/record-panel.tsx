import ArrowDownIcon from '@phosphor/arrow-down.svg';
import ArrowUpIcon from '@phosphor/arrow-up.svg';
import EyeSlashIcon from '@phosphor/eye-slash.svg';
import RowsIcon from '@phosphor/rows.svg';
import TrashIcon from '@phosphor/trash-simple.svg';
import XIcon from '@phosphor/x.svg';
import { Key } from '@solid-primitives/keyed';
import { Button, buttonClasses } from '@ui/components/Button';
import { Dialog } from '@ui/components/Dialog';
import { type Accessor, type JSX, Show } from 'solid-js';
import type { DatabaseViewColumn } from '../core/database-view';
import type {
  GridCellControl,
  GridCellEditorOptions,
} from '../core/grid-cell-editor';
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
  onRequestDelete: () => void;
  returnFocus?: HTMLElement;
};

export function RecordPanel(props: RecordPanelProps) {
  let focusTitle: (() => void) | undefined;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      position="center"
      class="flex max-h-[min(42rem,85dvh)] w-[min(32rem,calc(100vw-2rem))] flex-col text-ink"
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
        <Button
          size="icon-sm"
          label="Previous record"
          tooltipDisabled
          disabled={props.position <= 0}
          onClick={() => props.onNavigate(-1)}
        >
          <ArrowUpIcon />
        </Button>
        <Button
          size="icon-sm"
          label="Next record"
          tooltipDisabled
          disabled={props.position < 0 || props.position >= props.total - 1}
          onClick={() => props.onNavigate(1)}
        >
          <ArrowDownIcon />
        </Button>
        <Dialog.CloseButton
          aria-label="Close record"
          class={buttonClasses({ size: 'icon-sm' })}
        >
          <XIcon />
        </Dialog.CloseButton>
      </div>
      <div class="min-h-0 overflow-auto px-5 py-4">
        <Dialog.Title class="sr-only">
          {rowTitle(props.row, props.columns)}
        </Dialog.Title>
        <Dialog.Description class="sr-only">Record details</Dialog.Description>
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
            <Button
              variant="ghost"
              size="xs"
              disabled={props.pending}
              class="hover:text-failure-ink"
              onClick={props.onRequestDelete}
            >
              <TrashIcon /> Delete record
            </Button>
          </div>
        </Show>
      </div>
      <Show when={props.saveError}>
        <div
          role="alert"
          class="flex items-center gap-3 border-t border-warning/20 bg-warning/5 px-5 py-3 text-xs text-ink-muted"
        >
          <span class="flex-1">{props.saveError}</span>
          <Button size="xs" disabled={props.pending} onClick={props.onRetry}>
            Retry
          </Button>
        </div>
      </Show>
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
        const titleField = title();
        const ordered = [
          ...(titleField ? [titleField] : []),
          ...fields(),
        ].filter(canEditCell);
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
