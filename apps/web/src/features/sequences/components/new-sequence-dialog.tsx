import { t } from '@app/lib/i18n';
import { ActionDialogShell, Button, Dialog, Input } from '@ui';
import { createSignal, Show } from 'solid-js';
import { SEQUENCE_LIMITS } from '../core/sequence';

export function NewSequenceDialog(props: {
  busy: boolean;
  error?: string;
  onClose: () => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = createSignal('');
  return (
    <Dialog
      open
      position="center"
      class="w-[min(480px,calc(100vw-16px))]"
      onOpenChange={(open) => {
        if (!open && !props.busy) props.onClose();
      }}
    >
      <ActionDialogShell>
        <form
          class="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (name().trim() && !props.busy) props.onCreate(name().trim());
          }}
        >
          <ActionDialogShell.Body>
            <ActionDialogShell.Header>
              <ActionDialogShell.Title>
                {t('sequences.newSequence')}
              </ActionDialogShell.Title>
              <ActionDialogShell.Description>
                {t('sequences.newSequenceHint')}
              </ActionDialogShell.Description>
            </ActionDialogShell.Header>
            <label class="block space-y-2 text-xs font-medium">
              {t('sequences.name')}
              <Input
                value={name()}
                required
                maxLength={SEQUENCE_LIMITS.name}
                onInput={(event) => setName(event.currentTarget.value)}
              />
            </label>
            <Show when={props.error}>
              {(error) => (
                <p class="text-xs text-failure" role="alert">
                  {error()}
                </p>
              )}
            </Show>
          </ActionDialogShell.Body>
          <ActionDialogShell.Footer>
            <Button
              type="button"
              variant="ghost"
              disabled={props.busy}
              onClick={() => props.onClose()}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={props.busy}
              disabled={!name().trim() || props.busy}
            >
              {t('sequences.create')}
            </Button>
          </ActionDialogShell.Footer>
        </form>
      </ActionDialogShell>
    </Dialog>
  );
}
