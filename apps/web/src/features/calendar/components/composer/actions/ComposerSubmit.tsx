import { t } from '@app/lib/i18n';
import SpinnerIcon from '@icon/system/regular/spinner.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { useCalendarComposer } from '../../../context/calendar-composer-context';

export function ComposerSubmit(
  props: { fullWidth?: boolean; f3?: boolean } = {}
) {
  const model = useCalendarComposer();
  const label = () =>
    model.isEdit() ? t('calendar.saveEvent') : t('calendar.createEvent');
  return (
    <Button
      type="submit"
      form={model.ids.form}
      variant="primary"
      size={props.fullWidth ? 'sheet' : props.f3 ? 'field' : undefined}
      fullWidth={props.fullWidth}
      aria-label={label()}
      disabled={model.formIsDisabled() || !model.canSave()}
    >
      <Show when={model.options.pending} fallback={label()}>
        <SpinnerIcon class="size-4 animate-spin" />
      </Show>
    </Button>
  );
}
