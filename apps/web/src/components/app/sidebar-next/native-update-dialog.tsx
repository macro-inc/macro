import ArrowCircleUpIcon from '@phosphor/arrow-circle-up.svg';
import { Button, Dialog, Surface } from '@ui';

export default function NativeUpdateDialog(props: {
  preparing: boolean;
  onClose: () => void;
  onRestoreFocus: () => void;
  onRestart: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !props.preparing) props.onClose();
      }}
      onCloseAutoFocus={(event) => {
        // The sidebar button lives outside this lazily mounted dialog root.
        event.preventDefault();
        props.onRestoreFocus();
      }}
      position="center"
      animate
      class="w-100 max-w-[calc(100vw-16px)]"
    >
      <Surface depth={2}>
        <div class="flex flex-col gap-5 p-6" aria-busy={props.preparing}>
          <div class="flex flex-col gap-2">
            <ArrowCircleUpIcon
              class="mb-1 size-8 text-accent"
              aria-hidden="true"
            />
            <Dialog.Title class="text-lg font-semibold text-ink">
              Update Macro
            </Dialog.Title>
            <Dialog.Description class="text-sm leading-5 text-ink-muted">
              A new version of Macro is ready. Restart to install it, or keep
              working and it will update when you quit.
            </Dialog.Description>
          </div>
          <div class="flex justify-end gap-2">
            <Dialog.CloseButton
              as={Button}
              aria-label="Later"
              variant="strong"
              size="sm"
              disabled={props.preparing}
            >
              Later
            </Dialog.CloseButton>
            <Button
              variant="accent"
              size="sm"
              disabled={props.preparing}
              onClick={props.onRestart}
            >
              {props.preparing ? 'Preparing to restart…' : 'Restart and update'}
            </Button>
          </div>
        </div>
      </Surface>
    </Dialog>
  );
}
