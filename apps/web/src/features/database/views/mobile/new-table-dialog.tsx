import { fireAndForget } from '@core/util/fireAndForget';
import { ActionDialogShell, Button, Dialog, TextField } from '@ui';
import { createSignal, Show } from 'solid-js';
import { tableCreateMessage } from '../../core/column-schema';
import { isDatabaseNameTaken } from '../../core/property-creation';
import type { CreateTable } from '../../core/table-creation';

/** Marks the name field, for the tap that opens the dialog to raise the keyboard. */
export const NEW_TABLE_NAME_ATTRIBUTE = 'data-new-table-name';

/**
 * Names and creates a table where there is no tab strip to type in; stays
 * open with the reason when creating fails.
 */
export function NewTableDialog(props: {
  existingNames: string[];
  onCreate: CreateTable;
  onOpenTable: (tableId: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [value, setValue] = createSignal('');
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal('');
  /** A table that was created but not loaded: the next try only loads it. */
  const [createdTableId, setCreatedTableId] = createSignal<string>();
  const name = () => value().trim();

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (pending() || !name()) return;

    if (!createdTableId() && isDatabaseNameTaken(name(), props.existingNames)) {
      setError('A table with this name already exists. Try another name.');
      return;
    }

    setPending(true);
    setError('');
    const created = await props.onCreate(name(), createdTableId());
    setPending(false);

    created.match(
      (table) => {
        if (!table.ready) {
          setCreatedTableId(table.tableId);
          setError(table.message);
          return;
        }

        props.onOpenChange(false);
        props.onOpenTable(table.tableId);
      },
      (errors) => setError(tableCreateMessage(errors))
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!pending()) props.onOpenChange(open);
      }}
      position="center"
      class="w-110"
      visibleScrim
    >
      <ActionDialogShell>
        <form
          class="flex min-h-0 flex-col"
          aria-busy={pending()}
          onSubmit={(event) => fireAndForget(submit(event), 'database')}
        >
          <ActionDialogShell.Body>
            <ActionDialogShell.Header>
              <ActionDialogShell.Title>New table</ActionDialogShell.Title>
            </ActionDialogShell.Header>
            <TextField
              value={value()}
              onChange={(next) => {
                setValue(next);
                setError('');
              }}
            >
              <TextField.Label>Name</TextField.Label>
              <TextField.Input
                {...{ [NEW_TABLE_NAME_ATTRIBUTE]: '' }}
                placeholder="Table name"
                maxLength={200}
                readOnly={pending() || !!createdTableId()}
              />
            </TextField>
            <Show when={error()}>
              <p role="alert" class="text-sm text-failure">
                {error()}
              </p>
            </Show>
          </ActionDialogShell.Body>
          <ActionDialogShell.Footer>
            <Button
              type="button"
              variant="ghost"
              disabled={pending()}
              onClick={() => props.onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={pending() || !name()}
            >
              {pending() ? 'Creating…' : 'Create table'}
            </Button>
          </ActionDialogShell.Footer>
        </form>
      </ActionDialogShell>
    </Dialog>
  );
}
