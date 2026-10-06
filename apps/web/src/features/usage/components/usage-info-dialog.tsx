import XIcon from '@phosphor/x.svg';
import { Button, Dialog, Surface } from '@ui';

export function UsageInfoDialog(props: {
  open: boolean;
  onClose: () => void;
  onRestoreFocus?: () => void;
}) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => !open && props.onClose()}
      onCloseAutoFocus={
        props.onRestoreFocus
          ? (event) => {
              event.preventDefault();
              props.onRestoreFocus?.();
            }
          : undefined
      }
      position="center"
      class="w-120"
    >
      <Surface depth={2} class="rounded-xl p-6">
        <div class="flex items-start justify-between gap-4">
          <Dialog.Title class="text-xl font-semibold text-ink">
            Monthly limit
          </Dialog.Title>
          <Button
            size="icon-sm"
            variant="ghost"
            depth={3}
            label="Close usage explanation"
            onClick={props.onClose}
          >
            <XIcon class="size-4" />
          </Button>
        </div>
        <Dialog.Description class="mt-3 text-sm text-ink-muted">
          Your monthly usage includes AI agent chat usage and AI document
          editing.
        </Dialog.Description>
        <p class="mt-3 text-sm text-ink-muted">
          The percentage shows how much of your plan's included usage you've
          used in the current period. On paid plans, usage credits let you
          continue after you reach your monthly limit. On the Free plan,
          subscribe to a paid plan for more usage.
        </p>
      </Surface>
    </Dialog>
  );
}
