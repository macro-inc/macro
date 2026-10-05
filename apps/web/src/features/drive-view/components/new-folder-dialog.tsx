import FolderIcon from '@phosphor/folder.svg';
import { ActionDialogShell, Button, Dialog, TextField } from '@ui';
import { createSignal, Show } from 'solid-js';

export const DEFAULT_NEW_FOLDER_NAME = 'Untitled folder';

/** Names a folder before it is created inside `destination`. */
export function NewFolderDialog(props: {
  /** Name of the folder the new one is created in. */
  destination: string;
  onOpenChange(open: boolean): void;
  /** Resolves once the folder exists; rejects to keep the dialog open. */
  onCreate(name: string): Promise<void>;
}) {
  const [value, setValue] = createSignal(DEFAULT_NEW_FOLDER_NAME);
  const [pending, setPending] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  const name = () => value().trim();
  const canSubmit = () => !pending() && name().length > 0;

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (!canSubmit()) return;
    setPending(true);
    setFailed(false);
    try {
      await props.onCreate(name());
      props.onOpenChange(false);
    } catch (error) {
      console.error('Failed to create folder', error);
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
              <ActionDialogShell.Title>New folder</ActionDialogShell.Title>
              <ActionDialogShell.Description class="flex min-w-0 items-center gap-1.5">
                <span class="shrink-0">Inside</span>
                <FolderIcon aria-hidden="true" class="size-4 shrink-0" />
                <span class="min-w-0 truncate font-medium text-ink">
                  {props.destination}
                </span>
              </ActionDialogShell.Description>
            </ActionDialogShell.Header>
            <TextField value={value()} onChange={setValue}>
              <TextField.Label>Name</TextField.Label>
              <TextField.Input
                placeholder="Folder name"
                readOnly={pending()}
                onFocus={(event) => event.currentTarget.select()}
              />
            </TextField>
            <Show when={failed()}>
              <p role="alert" class="text-sm text-failure">
                Could not create the folder. Please try again.
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
              {pending() ? 'Creating…' : 'Create'}
            </Button>
          </ActionDialogShell.Footer>
        </form>
      </ActionDialogShell>
    </Dialog>
  );
}
