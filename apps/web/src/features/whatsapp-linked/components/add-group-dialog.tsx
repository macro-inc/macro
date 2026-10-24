import { ActionDialogShell, Button, Dialog, TextField } from '@ui';
import { createSignal, createUniqueId, Show } from 'solid-js';
import type { WhatsAppGroup } from '../core/group';

type AddGroupFormProps = {
  group: WhatsAppGroup;
  pending: boolean;
  error: string | undefined;
  onSubmit: (request: { name: string }) => void;
  onClose: () => void;
};

function AddGroupForm(props: AddGroupFormProps) {
  const [name, setName] = createSignal(props.group.name);
  const formId = createUniqueId();
  return (
    <ActionDialogShell>
      <form
        id={formId}
        class="contents"
        onSubmit={(event) => {
          event.preventDefault();
          if (!props.pending && name().trim())
            props.onSubmit({ name: name().trim() });
        }}
      >
        <ActionDialogShell.Body>
          <ActionDialogShell.Header>
            <ActionDialogShell.Title>
              Add “{props.group.name}” to Macro
            </ActionDialogShell.Title>
            <ActionDialogShell.Description>
              Read and reply to this WhatsApp group in Macro.
            </ActionDialogShell.Description>
          </ActionDialogShell.Header>
          <TextField value={name()} onChange={setName}>
            <TextField.Label>Group name</TextField.Label>
            <TextField.Input disabled={props.pending} />
          </TextField>
          <p class="text-sm leading-5 text-ink-muted">
            Only you have access at first. Use Share to invite others to read
            the group. Each person replies from their own WhatsApp.
          </p>
          <Show when={props.error}>
            {(error) => (
              <p role="alert" class="text-sm text-failure-ink">
                {error()}
              </p>
            )}
          </Show>
        </ActionDialogShell.Body>
      </form>
      <ActionDialogShell.Footer>
        <Button
          type="button"
          variant="ghost"
          depth={2}
          disabled={props.pending}
          onClick={props.onClose}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          form={formId}
          variant="strong"
          depth={2}
          disabled={props.pending || !name().trim()}
        >
          {props.pending ? 'Adding…' : 'Add group'}
        </Button>
      </ActionDialogShell.Footer>
    </ActionDialogShell>
  );
}

export function AddGroupDialog(
  props: Omit<AddGroupFormProps, 'group'> & { group: WhatsAppGroup | undefined }
) {
  return (
    <Dialog
      open={props.group !== undefined}
      onOpenChange={(open) => {
        if (!open && !props.pending) props.onClose();
      }}
      position="center"
      class="w-110 max-w-[calc(100vw-2rem)]"
    >
      <Show when={props.group} keyed>
        {(group) => (
          <AddGroupForm
            group={group}
            pending={props.pending}
            error={props.error}
            onSubmit={props.onSubmit}
            onClose={props.onClose}
          />
        )}
      </Show>
    </Dialog>
  );
}
