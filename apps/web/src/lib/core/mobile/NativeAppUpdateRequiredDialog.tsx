import { getNativeMobilePlatform } from '@core/util/platform';
import { Button, Dialog, Surface } from '@ui';
import { createSignal, Show } from 'solid-js';
import { openNativeUpdateLink } from './native-update-link';

export function NativeAppUpdateRequiredDialog(props: {
  open: boolean;
  onClose: () => void;
  description?: string;
  onRestart?: () => void;
}) {
  const platform = getNativeMobilePlatform();
  const [linkFailed, setLinkFailed] = createSignal(false);
  const [opening, setOpening] = createSignal(false);
  async function openStore() {
    if (!platform || opening()) return;
    setOpening(true);
    setLinkFailed(!(await openNativeUpdateLink(platform)));
    setOpening(false);
  }
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
          <p class="text-sm text-ink-extra-muted">
            If the store is unavailable, close this dialog and try again later.
          </p>
          <Show when={linkFailed()}>
            <p role="alert" class="text-sm text-ink">
              Unable to open the store. Please try again later.
            </p>
          </Show>
          <div class="flex justify-end gap-2">
            <Show when={platform}>
              <Button
                variant="strong"
                size="sm"
                disabled={opening()}
                onClick={() => void openStore()}
              >
                Update app
              </Button>
            </Show>
            <Show when={props.onRestart}>
              <Button
                variant="accent"
                size="sm"
                onClick={() => props.onRestart?.()}
              >
                Restart to update
              </Button>
            </Show>
            <Button onClick={props.onClose} variant="strong" size="sm">
              OK
            </Button>
          </div>
        </div>
      </Surface>
    </Dialog>
  );
}
