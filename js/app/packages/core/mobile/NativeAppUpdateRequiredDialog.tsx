import { Button, Dialog, Surface } from '@ui';

export function NativeAppUpdateRequiredDialog(props: {
  open: boolean;
  onClose: () => void;
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
      <Surface depth={2} active>
        <div class="flex flex-col gap-4 px-4 py-5">
          <div class="flex flex-col gap-2">
            <Dialog.Title class="text-lg font-semibold text-ink">
              {title}
            </Dialog.Title>
            <Dialog.Description class="text-sm leading-5 text-ink-extra-muted">
              {description}
            </Dialog.Description>
          </div>
          <div class="flex justify-end">
            <Dialog.CloseButton as={Button} variant="active" size="sm">
              OK
            </Dialog.CloseButton>
          </div>
        </div>
      </Surface>
    </Dialog>
  );
}
