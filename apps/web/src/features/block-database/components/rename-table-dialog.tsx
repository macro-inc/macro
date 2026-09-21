import { Button } from '@ui/components/Button';
import { Dialog } from '@ui/components/Dialog';
import { Panel } from '@ui/components/Panel';
import { createSignal, createUniqueId, Show } from 'solid-js';
import { isDatabaseNameTaken } from '../core/property-creation';

export function RenameTableDialog(props: {
  table: { id: string; name: string };
  otherNames: string[];
  onRename: (
    tableId: string,
    name: string,
    previousName: string
  ) => Promise<void>;
  onClose: () => void;
  returnFocus?: HTMLElement;
}) {
  const originalName = props.table.name;
  const [name, setName] = createSignal(originalName);
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal('');
  const inputId = createUniqueId();
  const errorId = createUniqueId();
  const duplicate = () => isDatabaseNameTaken(name(), props.otherNames);
  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (pending() || !name().trim() || duplicate()) return;
    setPending(true);
    setError('');
    try {
      if (name().trim() !== originalName)
        await props.onRename(props.table.id, name().trim(), originalName);
      props.onClose();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Could not rename this table. Try again.'
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
              <Dialog.Title class="text-lg font-semibold tracking-tight text-ink">
                Rename table
              </Dialog.Title>
              <Dialog.Description class="mt-1.5 text-sm text-ink-muted">
                Give this table a name that describes its records.
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
                readOnly={pending()}
                onFocus={(event) => event.currentTarget.select()}
                onInput={(event) => {
                  setName(event.currentTarget.value);
                  setError('');
                }}
                aria-invalid={duplicate()}
                aria-describedby={duplicate() || error() ? errorId : undefined}
                class="h-11 w-full rounded-lg border border-edge-muted bg-input px-3 text-base text-ink outline-none focus:border-ink/50 focus:ring-2 focus:ring-ink/15"
              />
            </div>
            <Show when={duplicate() || error()}>
              <p id={errorId} role="alert" class="text-sm text-failure">
                {duplicate()
                  ? 'A table with this name already exists. Try another name.'
                  : error()}
              </p>
            </Show>
            <div class="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={pending()}
                onClick={props.onClose}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="strong"
                disabled={pending() || !name().trim() || duplicate()}
              >
                {pending() ? 'Saving…' : 'Save name'}
              </Button>
            </div>
          </form>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
