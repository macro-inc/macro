import { t } from '@app/lib/i18n';
import SpinnerIcon from '@icon/system/regular/spinner.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { useCalendarComposer } from '../../../context/calendar-composer-context';

export function ComposerSubmit() {
  const model = useCalendarComposer();
  const label = () =>
    model.isEdit() ? t('calendar.saveEvent') : t('calendar.createEvent');
  return (
    <Button
      type="submit"
      form={model.ids.form}
      variant="primary"
      aria-label={label()}
      disabled={model.formIsDisabled() || !model.controller.canSave()}
    >
      <Show when={model.options.pending} fallback={label()}>
        <SpinnerIcon class="size-4 animate-spin" />
      </Show>
    </Button>
  );
}
