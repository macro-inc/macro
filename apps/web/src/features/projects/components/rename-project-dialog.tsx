import { ActionDialogShell, Button, Dialog, TextField } from '@ui';
import { createSignal, Show } from 'solid-js';

/** Renames one project; stays open with the error when the save fails. */
export function RenameProjectDialog(props: {
  name: string;
  onOpenChange(open: boolean): void;
  onRename(name: string): Promise<void>;
  onCloseAutoFocus?(event: Event): void;
}) {
  const [value, setValue] = createSignal(props.name);
  const [pending, setPending] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  const name = () => value().trim();
  const canSubmit = () =>
    !pending() && name().length > 0 && name() !== props.name.trim();

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (!canSubmit()) return;
    setPending(true);
    setFailed(false);
    try {
      await props.onRename(name());
      props.onOpenChange(false);
    } catch (error) {
      console.error('Failed to rename project', error);
      setFailed(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!pending()) props.onOpenChange(open);
      }}
      onCloseAutoFocus={props.onCloseAutoFocus}
      position="center"
      class="w-110"
      visibleScrim
    >
      <ActionDialogShell>
        <form
          class="flex min-h-0 flex-col"
          aria-busy={pending()}
          onSubmit={(event) => void submit(event)}
        >
          <ActionDialogShell.Body>
            <ActionDialogShell.Header>
              <ActionDialogShell.Title>Rename project</ActionDialogShell.Title>
            </ActionDialogShell.Header>
            <TextField value={value()} onChange={setValue}>
              <TextField.Label>Name</TextField.Label>
              <TextField.Input
                placeholder="Project name"
                readOnly={pending()}
                onFocus={(event) => event.currentTarget.select()}
              />
            </TextField>
            <Show when={failed()}>
              <p role="alert" class="text-sm text-failure">
                Could not rename project. Please try again.
              </p>
            </Show>
          </ActionDialogShell.Body>
          <ActionDialogShell.Footer>
            <Button
              type="button"
              variant="ghost"
              depth={2}
              disabled={pending()}
              onClick={() => props.onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="strong"
              depth={2}
              disabled={!canSubmit()}
            >
              {pending() ? 'Saving…' : 'Save name'}
            </Button>
          </ActionDialogShell.Footer>
        </form>
      </ActionDialogShell>
    </Dialog>
  );
}
