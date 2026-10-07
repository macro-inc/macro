import ClipboardText from '@phosphor/clipboard-text.svg';
import KanbanIcon from '@phosphor/kanban.svg';
import TableIcon from '@phosphor/table.svg';
import { Button } from '@ui/components/Button';
import { Dialog } from '@ui/components/Dialog';
import { Panel } from '@ui/components/Panel';
import { TextField } from '@ui/components/TextField';
import type { ResultAsync } from 'neverthrow';
import { createSignal, Show } from 'solid-js';
import { type BoardGrouping, STATUS_OPTIONS } from '../core/board-grouping';
import type { DatabaseViewColumn } from '../core/database-view';
import { boardGroupColumns } from '../core/views';
import {
  type DatabaseOpFailure,
  databaseOpMessage,
} from '../core/write-failure';
import { ViewSelect } from './view-select';

type NewViewLayout = 'table' | 'board';
type NewViewChoice = NewViewLayout | 'form';

/** A form over the current table, offered beside the views (RFC 02 §7). */
export type NewFormChoice = {
  initialName: string;
  /** Resolves a message saying why the form was refused, or undefined once made. */
  onCreate: (name: string) => Promise<string | undefined>;
};

import type { NewView } from '../core/view-creation';

export type { NewView } from '../core/view-creation';

/** The grouping choice that creates a Status column; column ids are UUIDs, so it names none. */
const NEW_STATUS_COLUMN = 'new-status-column';

/**
 * Creates a table or board view of the current table, named and, for a
 * board, grouped; given `form`, it also offers a form whose answers land as
 * the table's rows.
 */
export function NewViewDialog(props: {
  initialName: string;
  initialLayout?: NewViewLayout;
  columns: DatabaseViewColumn[];
  form?: NewFormChoice;
  onSubmit: (view: NewView) => ResultAsync<void, DatabaseOpFailure>;
  onClose: () => void;
  returnFocus?: HTMLElement;
  returnFocusFallback?: HTMLElement;
}) {
  let nameInput: HTMLInputElement | undefined;
  const [name, setName] = createSignal(props.initialName);
  const [layout, setLayout] = createSignal<NewViewChoice>(
    props.initialLayout ?? 'table'
  );
  const [formName, setFormName] = createSignal(props.form?.initialName ?? '');
  const groups = () => boardGroupColumns(props.columns);
  /** The columns a board can group by, or, when there are none, a Status column to create. */
  const groupChoices = () =>
    groups().length
      ? groups().map((column) => ({ value: column.id, label: column.name }))
      : [{ value: NEW_STATUS_COLUMN, label: 'Create a Status column' }];
  const [groupBy, setGroupBy] = createSignal(groupChoices()[0]?.value);
  const grouping = (): BoardGrouping | undefined => {
    const chosen = groupBy();
    if (chosen === NEW_STATUS_COLUMN) return { kind: 'new-status' };
    return groups().some((column) => column.id === chosen) && chosen
      ? { kind: 'column', columnId: chosen }
      : undefined;
  };
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal('');
  const request = (): NewView | undefined => {
    const trimmed = name().trim();
    if (!trimmed) return undefined;
    if (layout() === 'table') return { name: trimmed, layout: 'table' };
    const group = grouping();
    return group
      ? { name: trimmed, layout: 'board', groupBy: group }
      : undefined;
  };
  const incomplete = () =>
    layout() === 'form' ? !formName().trim() : !request();
  const submitForm = async (form: NewFormChoice) => {
    const trimmed = formName().trim();
    if (pending() || !trimmed) return;
    setPending(true);
    setError('');
    const refusal = await form.onCreate(trimmed);
    setPending(false);
    if (refusal) setError(refusal);
    else props.onClose();
  };
  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (layout() === 'form' && props.form) {
      await submitForm(props.form);
      return;
    }
    const view = request();
    if (pending() || !view) return;
    setPending(true);
    setError('');
    const created = await props.onSubmit(view);
    setPending(false);
    created.match(props.onClose, (failure) =>
      setError(databaseOpMessage(failure, 'this view'))
    );
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !pending() && props.onClose()}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        nameInput?.focus();
        nameInput?.select();
      }}
      onCloseAutoFocus={(event) => {
        const target = props.returnFocus?.isConnected
          ? props.returnFocus
          : props.returnFocusFallback;
        if (target?.isConnected) {
          event.preventDefault();
          target.focus();
        }
      }}
      class="w-100 max-w-[calc(100vw-2rem)]"
    >
      <Panel>
        <Panel.Body>
          <form class="flex flex-col gap-5 p-5" onSubmit={submit}>
            <div class="flex flex-col gap-1">
              <Dialog.Title class="text-base font-semibold text-ink">
                New view
              </Dialog.Title>
              <Dialog.Description class="text-sm text-ink-muted">
                A different way to see the same records, shared with everyone
                who can open this database.
              </Dialog.Description>
            </div>
            <div
              class="grid gap-2"
              classList={{
                'grid-cols-2': !props.form,
                'grid-cols-3': !!props.form,
              }}
              role="group"
              aria-label="View layout"
            >
              <button
                type="button"
                disabled={pending()}
                aria-pressed={layout() === 'table'}
                onClick={() => {
                  setLayout('table');
                  if (name() === 'Board view') setName('Table view');
                }}
                class="flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ink/50"
                classList={{
                  'border-edge bg-hover': layout() === 'table',
                  'border-edge-muted': layout() !== 'table',
                }}
              >
                <TableIcon class="mt-0.5 size-4 shrink-0 text-ink-muted" />
                <span class="flex flex-col gap-0.5">
                  <span class="font-medium text-ink">Table</span>
                  <span class="text-xs text-ink-muted">Rows and columns</span>
                </span>
              </button>
              <button
                type="button"
                disabled={pending()}
                aria-pressed={layout() === 'board'}
                onClick={() => {
                  setLayout('board');
                  if (name() === 'Table view') setName('Board view');
                }}
                class="flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ink/50"
                classList={{
                  'border-edge bg-hover': layout() === 'board',
                  'border-edge-muted': layout() !== 'board',
                }}
              >
                <KanbanIcon class="mt-0.5 size-4 shrink-0 text-ink-muted" />
                <span class="flex flex-col gap-0.5">
                  <span class="font-medium text-ink">Board</span>
                  <span class="text-xs text-ink-muted">
                    Cards grouped by a column
                  </span>
                </span>
              </button>
              <Show when={props.form}>
                <button
                  type="button"
                  disabled={pending()}
                  aria-pressed={layout() === 'form'}
                  onClick={() => setLayout('form')}
                  class="flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ink/50"
                  classList={{
                    'border-edge bg-hover': layout() === 'form',
                    'border-edge-muted': layout() !== 'form',
                  }}
                >
                  <ClipboardText class="mt-0.5 size-4 shrink-0 text-violet" />
                  <span class="flex flex-col gap-0.5">
                    <span class="font-medium text-ink">Form</span>
                    <span class="text-xs text-ink-muted">
                      Collect answers as new rows
                    </span>
                  </span>
                </button>
              </Show>
            </div>
            <Show when={layout() === 'form'}>
              <p class="text-xs text-ink-muted">
                A question for each column. Opens the form builder.
              </p>
            </Show>
            <Show when={layout() === 'board'}>
              <div class="flex items-center justify-between gap-3 text-sm">
                <span class="font-medium text-ink">Group by</span>
                <ViewSelect
                  label="Group board by"
                  value={groupBy()}
                  options={groupChoices()}
                  onChange={setGroupBy}
                  placeholder="Choose a column"
                />
              </div>
              <Show when={groupBy() === NEW_STATUS_COLUMN}>
                <p class="text-xs text-ink-muted">
                  No Select or Person column groups cards yet. A new Status
                  column starts with {STATUS_OPTIONS.join(', ')}.
                </p>
              </Show>
            </Show>
            <TextField
              value={layout() === 'form' ? formName() : name()}
              onChange={layout() === 'form' ? setFormName : setName}
              readOnly={pending()}
              required
            >
              <TextField.Label>
                {layout() === 'form' ? 'Form name' : 'View name'}
              </TextField.Label>
              <TextField.Input
                ref={nameInput}
                maxlength={100}
                onFocus={(event) => event.currentTarget.select()}
                placeholder="e.g. In progress"
              />
            </TextField>
            <Show when={error()}>
              <p role="alert" class="text-xs text-failure">
                {error()}
              </p>
            </Show>
            <div class="flex justify-end gap-2">
              <Button
                variant="ghost"
                disabled={pending()}
                onClick={props.onClose}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="cta"
                disabled={pending() || incomplete()}
              >
                {layout() === 'form' ? 'Create form' : 'Create view'}
              </Button>
            </div>
          </form>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
