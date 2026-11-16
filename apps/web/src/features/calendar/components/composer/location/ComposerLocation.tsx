import { t } from '@app/lib/i18n';
import { TextField } from '@ui';
import { useCalendarComposer } from '../../../context/calendar-composer-context';

export function ComposerLocation() {
  const model = useCalendarComposer();
  return (
    <TextField
      value={model.state().location}
      onChange={(location) => model.controller.setField('location', location)}
      disabled={model.fieldIsDisabled('location')}
      class="w-full"
    >
      <TextField.Input
        aria-label={t('calendar.location')}
        placeholder={t('calendar.addLocation')}
      />
    </TextField>
  );
}
