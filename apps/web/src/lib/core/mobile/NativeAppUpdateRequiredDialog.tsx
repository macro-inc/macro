import { Button, Dialog, Surface } from '@ui';
import { Show } from 'solid-js';

export function NativeAppUpdateRequiredDialog(props: {
  open: boolean;
  onClose: () => void;
  description?: string;
  onRestart?: () => void;
}) {
  const title = 'Update Macro App required';
  const description =
    'There is a new version of Macro App available. Please update your app. You may experience degraded service until the app is updated.';

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      class="w-[90%] max-w-120"
      position="center"
    >
      <Surface depth={2}>
        <div class="flex flex-col gap-4 px-4 py-5">
          <div class="flex flex-col gap-2">
            <Dialog.Title class="text-lg font-semibold text-ink">
              {title}
            </Dialog.Title>
            <Dialog.Description class="text-sm leading-5 text-ink-extra-muted">
              {props.description ?? description}
            </Dialog.Description>
          </div>
          <div class="flex justify-end gap-2">
            <Show when={props.onRestart}>
              <Button
                variant="accent"
                size="sm"
                onClick={() => props.onRestart?.()}
              >
                Restart to update
              </Button>
            </Show>
            <Dialog.CloseButton as={Button} variant="strong" size="sm">
              OK
            </Dialog.CloseButton>
          </div>
        </div>
      </Surface>
    </Dialog>
  );
}
