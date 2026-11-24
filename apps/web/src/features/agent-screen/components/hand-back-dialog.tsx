import { t } from '@app/lib/i18n';
import { Button } from '@ui/components/Button';
import { Dialog } from '@ui/components/Dialog';
import { TextField } from '@ui/components/TextField';
import { createSignal } from 'solid-js';

/** Hand back with an optional note for the agent. A drawer on phones. */
export function HandBackDialog(props: {
  open: boolean;
  agentName: string;
  onHandBack: (note: string | null) => void;
  onClose: () => void;
}) {
  const [note, setNote] = createSignal('');

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const text = note().trim();
    props.onHandBack(text ? text : null);
    setNote('');
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => !open && props.onClose()}
      class="w-[min(420px,94vw)]"
    >
      <form class="flex flex-col gap-3 p-4" onSubmit={submit}>
        <h2 class="text-sm font-semibold text-ink">
          {t('agentScreen.handBackTitle', { name: props.agentName })}
        </h2>
        <p class="text-sm text-ink-muted">
          {t('agentScreen.handBackDescription', { name: props.agentName })}
        </p>
        <TextField value={note()} onChange={setNote}>
          <TextField.Label class="sr-only">
            {t('agentScreen.handBackNotePlaceholder')}
          </TextField.Label>
          <TextField.TextArea
            autoResize
            rows={2}
            placeholder={t('agentScreen.handBackNotePlaceholder')}
          />
        </TextField>
        <div class="flex justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            type="button"
            onClick={props.onClose}
          >
            {t('agentScreen.cancel')}
          </Button>
          <Button size="sm" variant="primary" type="submit">
            {t('agentScreen.handBack')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
