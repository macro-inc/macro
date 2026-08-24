import TrashIcon from '@phosphor/trash.svg';
import { Button, Dialog, Surface } from '@ui';

export function BotDeleteDialog(props: {
  open: boolean;
  botName?: string;
  /** What the thing being deleted is called, for surfaces that call a bot
   * something else (agents). Defaults to "bot". */
  noun?: string;
  /** Overrides the consequences line, which by default describes webhook bots
   * and does not apply to bots without webhook URLs. */
  description?: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => !open && !props.pending && props.onClose()}
      position="center"
      class="w-[90%] max-w-120"
    >
      <Surface depth={2} class="rounded-xl text-ink">
        <div class="border-b border-edge-muted px-5 py-3">
          <Dialog.Title class="text-sm font-semibold">
            Delete {props.botName ?? props.noun ?? 'bot'}?
          </Dialog.Title>
        </div>
        <div class="flex flex-col gap-4 p-5">
          <Dialog.Description class="text-sm leading-5 text-ink-muted">
            {props.description ??
              'This removes the bot from every channel and disables its webhook URLs. This action cannot be undone.'}
          </Dialog.Description>
          <div class="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={props.pending}
              onClick={props.onClose}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              size="sm"
              disabled={props.pending}
              onClick={props.onConfirm}
            >
              <TrashIcon />
              {props.pending ? 'Deleting…' : `Delete ${props.noun ?? 'bot'}`}
            </Button>
          </div>
        </div>
      </Surface>
    </Dialog>
  );
}
