import TableIcon from '@phosphor/table.svg';
import TextTIcon from '@phosphor/text-t.svg';
import { Button } from '@ui/components/Button';
import { Dialog } from '@ui/components/Dialog';
import { Panel } from '@ui/components/Panel';
import { createSignal, createUniqueId, Show } from 'solid-js';
import { isDatabaseNameTaken } from '../core/property-creation';
import type { CreateTable } from '../core/table-creation';

export function CreateTableDialog(props: {
  existingNames: string[];
  onCreate: CreateTable;
  onOpenTable: (tableId: string) => void;
  onClose: () => void;
  returnFocus?: HTMLElement;
}) {
  const [name, setName] = createSignal('');
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal('');
  const [createdTableId, setCreatedTableId] = createSignal<string>();
  const inputId = createUniqueId();
  const errorId = createUniqueId();
  const duplicate = () =>
    !createdTableId() &&
    name().trim() &&
    isDatabaseNameTaken(name(), props.existingNames);

  const openTable = (tableId: string) => {
    props.onOpenTable(tableId);
    props.onClose();
  };
  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (pending() || !name().trim() || duplicate()) return;
    setPending(true);
    setError('');
    try {
      const result = await props.onCreate(name().trim(), createdTableId());
      if (result.ready) openTable(result.tableId);
      else {
        setCreatedTableId(result.tableId);
        setError(result.message);
      }
    } catch {
      setError(
        'Could not create this table. Check your connection and try again.'
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !pending() && props.onClose()}
      onCloseAutoFocus={(event) => {
        if (props.returnFocus?.isConnected) {
          event.preventDefault();
          props.returnFocus.focus();
        }
      }}
      class="w-108 max-w-[calc(100vw-2rem)]"
    >
      <Panel>
        <Panel.Body>
          <form
            class="flex flex-col gap-5 p-6 [&_button:focus-visible]:ring-2 [&_button:focus-visible]:ring-ink/50"
            onSubmit={submit}
            aria-busy={pending()}
          >
            <div>
              <div class="mb-3 grid size-10 place-items-center rounded-lg bg-hover text-ink-muted">
                <TableIcon class="size-5" />
              </div>
              <Dialog.Title class="text-lg font-semibold tracking-tight text-ink">
                New table
              </Dialog.Title>
              <Dialog.Description class="mt-1.5 text-sm leading-relaxed text-ink-muted">
                What would you like to organize?
              </Dialog.Description>
            </div>
            <div>
              <label
                for={inputId}
                class="mb-2 block text-sm font-medium text-ink"
              >
                Table name
              </label>
              <input
                id={inputId}
                required
                maxlength={200}
                value={name()}
                readOnly={pending() || !!createdTableId()}
                onInput={(event) => {
                  setName(event.currentTarget.value);
                  setError('');
                }}
                placeholder="Projects, People, Events…"
                aria-invalid={!!duplicate()}
                aria-describedby={duplicate() || error() ? errorId : undefined}
                class="h-11 w-full rounded-lg border border-edge-muted bg-input px-3 text-base text-ink outline-none placeholder:text-ink-placeholder focus:border-ink/50 focus:ring-2 focus:ring-ink/15 disabled:opacity-60"
              />
              <Show when={duplicate()}>
                <p id={errorId} class="mt-2 text-xs text-failure">
                  A table with this name already exists. Try another name.
                </p>
              </Show>
            </div>
            <div class="rounded-lg border border-edge-muted bg-canvas-base">
              <div class="flex items-center gap-2 border-b border-edge-muted px-3 py-2 text-xs font-medium text-ink">
                <TextTIcon class="size-3.5 text-ink-muted" /> Name
              </div>
              <p class="px-3 py-3 text-xs leading-5 text-ink-muted">
                Starts with a Name column. Add more columns anytime.
              </p>
            </div>
            <Show when={error()}>
              <p id={errorId} role="alert" class="text-sm text-failure">
                {error()}
              </p>
            </Show>
            <div class="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={pending()}
                onClick={() => {
                  const tableId = createdTableId();
                  if (tableId) openTable(tableId);
                  else props.onClose();
                }}
              >
                {createdTableId() ? 'Open table' : 'Cancel'}
              </Button>
              <Button
                type="submit"
                variant="strong"
                disabled={pending() || !name().trim() || !!duplicate()}
              >
                {pending()
                  ? 'Creating…'
                  : createdTableId()
                    ? 'Retry setup'
                    : 'Create table'}
              </Button>
            </div>
          </form>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
